#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  assertExecutableBenchmarkConfig,
  expandMatrix,
  parseBenchmarkConfig,
  parseMatrix,
} from './config.mjs';
import { createConfinedOutputStore } from './confined-output-store.mjs';
import { acquireConfinedRunLock } from './confined-run-lock.mjs';
import { createPersistentAdapter } from './executor.mjs';
import {
  revalidateExecutionEnvironment as revalidateExecutionEnvironmentDefault,
  verifyExecutionEnvironment as verifyExecutionEnvironmentDefault,
  verifyPinnedPath,
} from './integrity.mjs';
import {
  createDryRunManifest,
  serializeManifest,
} from './manifest.mjs';
import {
  readCheckpointBytes,
  runBenchmarkManifest as runBenchmarkManifestDefault,
} from './runner.mjs';
import { spikeManifestSchema } from './schema.mjs';
import {
  acquireRunLock,
} from './storage.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(new URL('../../', import.meta.url).pathname);

function usage() {
  return `Usage:
  node tools/local-music-benchmark/cli.mjs --config <file> --output <dir> --dry-run
  node tools/local-music-benchmark/cli.mjs --config <file> --output <dir> --execute [--cell <duration>:<batch>]
  node tools/local-music-benchmark/cli.mjs --validate-manifest <file> # structural schema only
  node tools/local-music-benchmark/cli.mjs --validate-evidence <file> --config <trusted-execute-config> --output <run-output-dir>

Dry-run never resolves engine, adapter, toolchain, model, or weight paths.
`;
}

function parseArguments(argv) {
  const options = {
    config: null,
    output: null,
    dryRun: false,
    execute: false,
    cell: null,
    validateManifest: null,
    validateEvidence: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--config' || argument === '--output' || argument === '--cell') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === '--validate-manifest' || argument === '--validate-evidence') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      options[argument === '--validate-manifest' ? 'validateManifest' : 'validateEvidence'] = value;
      index += 1;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--execute') {
      options.execute = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function currentHarnessIdentity({
  includeRepositoryPath,
  gitPin = null,
}) {
  const gitExecutable = gitPin === null
    ? '/usr/bin/git'
    : (await verifyPinnedPath(gitPin, {
        executable: true,
        label: 'trusted config git executable',
      })).realpath;
  const gitEnvironment = {
    HOME: process.env.HOME ?? os.homedir(),
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/usr/bin:/bin',
    TZ: 'UTC',
    ...(typeof process.env.TMPDIR === 'string' ? { TMPDIR: process.env.TMPDIR } : {}),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
  };
  const { stdout } = await execFileAsync(gitExecutable, [
    '-c',
    'core.fsmonitor=false',
    '-C',
    repositoryRoot,
    'rev-parse',
    '--verify',
    'HEAD',
  ], {
    encoding: 'utf8',
    env: gitEnvironment,
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 10_000,
  });
  if (gitPin !== null) {
    await verifyPinnedPath(gitPin, {
      executable: true,
      label: 'trusted config git executable',
    });
  }
  return {
    harnessCommit: stdout.trim(),
    harnessRepositoryPath: includeRepositoryPath ? await realpath(repositoryRoot) : null,
  };
}

function parseCellFilter(value) {
  if (value === null) return null;
  const match = /^(150|180|184):(1|2|4)$/u.exec(value);
  if (!match) {
    throw new Error('--cell must be one of 150|180|184 followed by : and 1|2|4.');
  }
  return { durationSeconds: Number(match[1]), batchSizeRequested: Number(match[2]) };
}

function manifestName(cell) {
  return `d${cell.durationSeconds}-b${cell.batchSizeRequested}.json`;
}

function executionIdentityReceipt(verified) {
  return serializeManifest({
    identity: verified.identity,
    adapter: verified.adapter,
    environmentSha256: verified.environmentSha256,
  });
}

function assertExecutionIdentityUnchanged(expected, verified, message) {
  if (executionIdentityReceipt(verified) === expected) return verified;
  const error = new Error(message);
  error.code = 'execution_identity_changed';
  throw error;
}

async function loadConfiguration(configPath, { execute }) {
  const raw = await readJson(configPath);
  const configuredGit = raw?.toolchain?.git;
  if (execute && (configuredGit === null || configuredGit === undefined)) {
    const error = new Error('Trusted execute config requires a pinned git executable.');
    error.code = 'trusted_git_pin_required';
    throw error;
  }
  const config = parseBenchmarkConfig(
    raw,
    await currentHarnessIdentity({
      includeRepositoryPath: execute,
      gitPin: execute ? configuredGit : null,
    }),
  );
  const matrixPath = path.resolve(path.dirname(configPath), config.matrixFile);
  const matrix = parseMatrix(await readJson(matrixPath));
  return { config, matrix };
}

async function writeDryRun({ cells, config, matrix, outputStore }) {
  const lock = await acquireConfinedRunLock(outputStore, 'benchmark-run');
  const entries = [];
  const publishDryRunFile = async (relativePath, data) => {
    try {
      await outputStore.createExclusiveFile(relativePath, data);
    } catch (error) {
      if (error?.code !== 'benchmark_lock_exists') throw error;
      const existing = await outputStore.readFile(relativePath);
      if (existing === null || existing.bytes.toString('utf8') !== data) {
        const conflict = new Error(
          `Dry-run refuses to replace existing benchmark evidence: ${relativePath}`,
        );
        conflict.code = 'dry_run_evidence_conflict';
        throw conflict;
      }
    }
  };
  try {
    for (const cell of cells) {
      const manifest = createDryRunManifest({
        identity: {
          ...config.identity,
          engine: { ...config.identity.engine, clean: null },
          environment: [],
          environmentSha256: null,
        },
        adapter: config.adapter,
        cell,
        energyCollection: config.energyCollection,
        repetitions: matrix.repetitions,
        executionMode: 'dry-run',
      });
      const relativePath = `manifests/${manifestName(cell)}`;
      await publishDryRunFile(relativePath, serializeManifest(manifest));
      entries.push({ cell, path: relativePath, runId: manifest.runId });
    }
    const index = {
      schemaVersion: '1.0.0',
      benchmarkId: config.identity.benchmarkId,
      matrix,
      manifests: entries,
    };
    await publishDryRunFile(
      'benchmark-index.v1.json',
      serializeManifest(index),
    );
    return entries;
  } finally {
    outputStore.bindTerminalRelease(await lock.prepareTerminalRelease());
  }
}

async function executeCells({
  allCells,
  cellBoundaryObserver,
  cells,
  config,
  matrix,
  outputDirectory,
  outputStore,
  revalidateExecutionEnvironment,
  signal,
  verifyExecutionEnvironment,
  machineLockPath: machineLockPathOverride,
  machineLockOptions,
  runBenchmarkManifest,
}) {
  assertExecutableBenchmarkConfig(config);
  const sessionLock = await acquireConfinedRunLock(outputStore, 'benchmark-run');
  let retainSessionLock = false;
  try {
    await outputStore.ensureDirectory('cells');
  const initialVerified = await verifyExecutionEnvironment(config);
  if (typeof process.getuid !== 'function') {
    const error = new Error('A stable user identity is required for the machine-wide lock.');
    error.code = 'benchmark_user_identity_unavailable';
    throw error;
  }
  if (
    machineLockPathOverride !== null &&
    (typeof machineLockPathOverride !== 'string' ||
      !path.isAbsolute(machineLockPathOverride))
  ) {
    throw new TypeError('An injected machine lock path must be absolute.');
  }
  const machineLockPath = machineLockPathOverride ?? path.join(
    '/tmp',
    `lofiever-local-music-metal-${process.getuid()}`,
  );
  let metalLock = null;
  let metalCleanupGuardArmed = false;
  let retainMetalLock = false;
  const completed = [];
  const retainForCleanupFailure = async (error) => {
    if (
      error?.cleanupUnproven !== true ||
      metalLock === null ||
      !metalCleanupGuardArmed ||
      retainMetalLock
    ) return;
    retainMetalLock = true;
    try {
      await metalLock.markCleanupUnproven(error);
    } catch (sentinelError) {
      sentinelError.cleanupUnproven = true;
      sentinelError.details = {
        ...sentinelError.details,
        priorErrorCode: error.code ?? null,
      };
      throw sentinelError;
    }
  };
  try {
    metalLock = await acquireRunLock(machineLockPath, machineLockOptions);
    for (const cell of cells) {
      const verified = await verifyExecutionEnvironment(config);
      const initialIdentity = executionIdentityReceipt(initialVerified);
      const currentIdentity = executionIdentityReceipt(verified);
      if (currentIdentity !== initialIdentity) {
        const error = new Error('Execution identity changed after the machine lock was acquired.');
        error.code = 'execution_identity_changed';
        throw error;
      }
      const manifestPath = path.join(
        outputDirectory,
        'manifests',
        manifestName(cell),
      );
      const plannedManifest = createDryRunManifest({
        identity: verified.identity,
        adapter: verified.adapter,
        cell,
        energyCollection: verified.energyCollection,
        repetitions: matrix.repetitions,
        executionMode: 'execute',
      });
      const cellIndex = allCells.findIndex(
        (candidate) =>
          candidate.durationSeconds === cell.durationSeconds &&
          candidate.batchSizeRequested === cell.batchSizeRequested,
      );
      for (const predecessor of allCells.slice(0, cellIndex)) {
        const predecessorPlan = createDryRunManifest({
          identity: verified.identity,
          adapter: verified.adapter,
          cell: predecessor,
          energyCollection: verified.energyCollection,
          repetitions: matrix.repetitions,
          executionMode: 'execute',
        });
        let receipt;
        try {
          const predecessorFile = await outputStore.readFile(
            `manifests/${manifestName(predecessor)}`,
          );
          if (predecessorFile === null) {
            const missing = new Error('no such file');
            missing.code = 'ENOENT';
            throw missing;
          }
          receipt = await readCheckpointBytes(predecessorFile.bytes, {
            outputDirectory: outputStore.storageRoot,
            outputStore,
            plannedManifest: predecessorPlan,
          });
        } catch (error) {
          if (
            error?.code === 'ENOENT' ||
            error.details?.cause?.includes('ENOENT') ||
            error.details?.cause?.includes('no such file')
          ) {
            const sequenceError = new Error(
              `Cell ${cell.durationSeconds}:${cell.batchSizeRequested} requires green predecessor ${predecessor.durationSeconds}:${predecessor.batchSizeRequested}.`,
            );
            sequenceError.code = 'benchmark_cell_sequence';
            throw sequenceError;
          }
          throw error;
        }
        if (
          receipt.state !== 'completed' ||
          receipt.factors.batchSizeEffective !== receipt.factors.batchSizeRequested
        ) {
          const sequenceError = new Error(
            `Cell ${cell.durationSeconds}:${cell.batchSizeRequested} requires predecessor ${predecessor.durationSeconds}:${predecessor.batchSizeRequested} to complete at its requested effective batch.`,
          );
          sequenceError.code = 'benchmark_cell_sequence';
          throw sequenceError;
        }
      }
      await metalLock.armCleanupPending();
      metalCleanupGuardArmed = true;
      try {
        const executor = createPersistentAdapter({
          adapter: verified.adapter,
          cleanupGuards: [metalLock],
          identity: verified.identity,
          outputDirectory,
          outputStore,
          processEnvironment: verified.processEnvironment,
          preSpawnVerify: async () => {
            const beforeSpawn = await verifyExecutionEnvironment(config);
            assertExecutionIdentityUnchanged(
              currentIdentity,
              beforeSpawn,
              'Execution pins changed immediately before adapter spawn.',
            );
          },
        });
        const result = await runBenchmarkManifest({
          executor,
          manifestPath,
          outputDirectory,
          outputStore,
          runLock: sessionLock,
          plannedManifest,
          postCloseVerify: async ({ manifest }) => {
            const afterClose = await revalidateExecutionEnvironment(config, manifest);
            assertExecutionIdentityUnchanged(
              currentIdentity,
              afterClose,
              'Execution pins changed after persistent adapter shutdown.',
            );
          },
          processEnvironment: verified.processEnvironment,
          signal,
        });
        const batchSizeEffective = result.factors.batchSizeEffective;
        const gateError =
          result.state === 'completed' &&
          batchSizeEffective !== result.factors.batchSizeRequested
            ? {
                code: 'batch_effective_below_requested',
                durationSeconds: result.factors.durationSeconds,
                batchSizeRequested: result.factors.batchSizeRequested,
                batchSizeEffective,
              }
            : null;
        completed.push({
          cell,
          path: `manifests/${manifestName(cell)}`,
          state: result.state,
          error: gateError,
        });
        await cellBoundaryObserver?.({
          cell: structuredClone(cell),
          state: result.state,
        });
        if (result.state !== 'completed' || gateError !== null) break;
      } catch (error) {
        await retainForCleanupFailure(error);
        throw error;
      } finally {
        if (metalCleanupGuardArmed && !retainMetalLock) {
          await metalLock.clearCleanupPending({ processGroupAbsent: true });
          metalCleanupGuardArmed = false;
        }
      }
    }
  } catch (error) {
    if (error?.cleanupUnproven === true) retainSessionLock = true;
    await retainForCleanupFailure(error);
    throw error;
  } finally {
    if (metalLock !== null && !retainMetalLock) {
      if (metalCleanupGuardArmed) {
        await metalLock.clearCleanupPending({ processGroupAbsent: true });
      }
      await metalLock.release();
    }
  }
  return completed;
  } finally {
    if (!retainSessionLock) {
      outputStore.bindTerminalRelease(await sessionLock.prepareTerminalRelease());
    }
  }
}

async function validateOneManifest(filePath, io) {
  const validation = spikeManifestSchema.safeParse(await readJson(filePath));
  if (!validation.success) throw new Error(validation.error.message);
  io.stdout(
    `${JSON.stringify({ valid: true, validation: 'schema-only', file: filePath })}\n`,
  );
}

async function validateOneEvidence(
  filePath,
  outputDirectory,
  configPath,
  io,
  revalidateExecutionEnvironment,
  createOutputStore,
) {
  const outputStore = await createOutputStore(outputDirectory);
  const storageRoot = outputStore.storageRoot;
  let validationReceipt = null;
  try {
    const requestedOutputRoot = path.resolve(outputDirectory);
    const relativeManifestPath = path.relative(
      requestedOutputRoot,
      path.resolve(filePath),
    );
    if (
      relativeManifestPath === '' ||
      relativeManifestPath.startsWith(`..${path.sep}`) ||
      relativeManifestPath === '..' ||
      path.isAbsolute(relativeManifestPath)
    ) {
      const error = new Error(
        '--validate-evidence manifest must be confined to the pinned output directory.',
      );
      error.code = 'evidence_manifest_outside_output';
      throw error;
    }
    const confinedManifestPath = relativeManifestPath.split(path.sep).join('/');
    const initialManifest = await outputStore.readFile(confinedManifestPath);
    if (initialManifest === null) {
      const error = new Error('Evidence manifest is missing from the pinned output root.');
      error.code = 'confined_file_missing';
      throw error;
    }
    const preview = await readCheckpointBytes(initialManifest.bytes);
    outputStore.verifyCurrent();
    if (
      preview.executionMode !== 'execute' ||
      !['completed', 'completed_with_errors'].includes(preview.state)
    ) {
      const error = new Error(
        'Filesystem evidence validation requires a terminal execute manifest.',
      );
      error.code = 'evidence_manifest_not_terminal';
      error.details = {
        executionMode: preview.executionMode,
        state: preview.state,
      };
      throw error;
    }
    const { config, matrix } = await loadConfiguration(configPath, { execute: true });
    assertExecutableBenchmarkConfig(config);
    const cell = {
      durationSeconds: preview.factors.durationSeconds,
      batchSizeRequested: preview.factors.batchSizeRequested,
    };
    if (
      preview.factors.repetitions !== matrix.repetitions ||
      !expandMatrix(matrix).some(
        (candidate) =>
          candidate.durationSeconds === cell.durationSeconds &&
          candidate.batchSizeRequested === cell.batchSizeRequested,
      )
    ) {
      const error = new Error(
        'Evidence factors do not belong to the trusted benchmark matrix.',
      );
      error.code = 'evidence_matrix_mismatch';
      throw error;
    }

    const verified = await revalidateExecutionEnvironment(config, preview);
    const plannedManifest = createDryRunManifest({
      identity: verified.identity,
      adapter: verified.adapter,
      cell,
      repetitions: matrix.repetitions,
      energyCollection: config.energyCollection,
      executionMode: 'execute',
    });
    let manifest;
    try {
      const evidenceManifest = await outputStore.readFile(confinedManifestPath);
      if (
        evidenceManifest === null ||
        serializeManifest(evidenceManifest.receipt) !==
          serializeManifest(initialManifest.receipt) ||
        !evidenceManifest.bytes.equals(initialManifest.bytes)
      ) {
        const changed = new Error(
          'Manifest changed before filesystem evidence validation.',
        );
        changed.code = 'checkpoint_integrity_failed';
        throw changed;
      }
      manifest = await readCheckpointBytes(evidenceManifest.bytes, {
        outputDirectory: storageRoot,
        outputStore,
        plannedManifest,
      });
    } catch (cause) {
      if (
        cause?.code === 'checkpoint_integrity_failed' ||
        /^(?:confined|private_directory)/u.test(cause?.code ?? '')
      ) {
        throw cause;
      }
      const error = new Error(
        `Manifest filesystem evidence is incomplete or changed: ${cause?.message ?? String(cause)}`,
      );
      error.code = 'checkpoint_integrity_failed';
      throw error;
    }
    if (
      manifest.state !== preview.state ||
      manifest.executionMode !== preview.executionMode
    ) {
      const error = new Error(
        'Manifest state changed during filesystem evidence validation.',
      );
      error.code = 'checkpoint_integrity_failed';
      error.details = {
        preview: { executionMode: preview.executionMode, state: preview.state },
        actual: { executionMode: manifest.executionMode, state: manifest.state },
      };
      throw error;
    }
    await revalidateExecutionEnvironment(config, manifest);
    const finalManifest = await outputStore.readFile(confinedManifestPath);
    if (
      finalManifest === null ||
      serializeManifest(finalManifest.receipt) !==
        serializeManifest(initialManifest.receipt) ||
      !finalManifest.bytes.equals(initialManifest.bytes)
    ) {
      const error = new Error(
        'Manifest changed after filesystem evidence validation.',
      );
      error.code = 'checkpoint_integrity_failed';
      throw error;
    }
    const finalPreview = await readCheckpointBytes(finalManifest.bytes);
    if (serializeManifest(finalPreview) !== serializeManifest(manifest)) {
      const error = new Error(
        'Manifest changed after filesystem evidence validation.',
      );
      error.code = 'checkpoint_integrity_failed';
      throw error;
    }
    outputStore.verifyCurrent();
    validationReceipt = {
      valid: true,
      validation: 'filesystem-evidence',
      state: finalPreview.state,
      file: filePath,
      manifestSha256: finalManifest.receipt.sha256,
    };
  } finally {
    await outputStore.close();
  }
  io.stdout(`${JSON.stringify(validationReceipt)}\n`);
}

export async function runCli(
  argv,
  {
    io = {
      stdout: (value) => process.stdout.write(value),
      stderr: (value) => process.stderr.write(value),
    },
    verifyExecutionEnvironment = verifyExecutionEnvironmentDefault,
    revalidateExecutionEnvironment = revalidateExecutionEnvironmentDefault,
    createOutputStore = createConfinedOutputStore,
    cellBoundaryObserver = null,
    machineLockPath = null,
    machineLockOptions = {},
    runBenchmarkManifest = runBenchmarkManifestDefault,
    signal: externalSignal = null,
  } = {},
) {
  const options = parseArguments(argv);
  if (typeof createOutputStore !== 'function') {
    throw new TypeError('Confined output store factory must be a function.');
  }
  if (cellBoundaryObserver !== null && typeof cellBoundaryObserver !== 'function') {
    throw new TypeError('Cell boundary observer must be a function when provided.');
  }
  if (options.help) {
    io.stdout(usage());
    return { mode: 'help' };
  }
  if (options.validateManifest) {
    if (options.validateEvidence) {
      throw new Error('Choose exactly one manifest validation mode.');
    }
    await validateOneManifest(path.resolve(options.validateManifest), io);
    return { mode: 'validate-schema' };
  }
  if (options.validateEvidence) {
    if (!options.config) throw new Error('--validate-evidence requires --config.');
    if (!options.output) throw new Error('--validate-evidence requires --output.');
    await validateOneEvidence(
      path.resolve(options.validateEvidence),
      path.resolve(options.output),
      path.resolve(options.config),
      io,
      revalidateExecutionEnvironment,
      createOutputStore,
    );
    return { mode: 'validate-evidence' };
  }
  if (!options.config || !options.output || options.dryRun === options.execute) {
    throw new Error(`Exactly one of --dry-run or --execute is required.\n${usage()}`);
  }
  const configPath = path.resolve(options.config);
  const outputDirectory = path.resolve(options.output);
  const { config, matrix } = await loadConfiguration(configPath, { execute: options.execute });
  const filter = parseCellFilter(options.cell);
  const allCells = expandMatrix(matrix);
  const cells = allCells.filter(
    (cell) =>
      filter === null ||
      (cell.durationSeconds === filter.durationSeconds &&
        cell.batchSizeRequested === filter.batchSizeRequested),
  );
  const controller = externalSignal === null ? new AbortController() : null;
  const executionSignal = externalSignal ?? controller.signal;
  const abort = () => controller.abort();
  if (options.execute && controller !== null) {
    process.once('SIGINT', abort);
    process.once('SIGTERM', abort);
  }
  let outputStore = null;
  let receipt = null;
  let primaryError = null;
  let closeError = null;
  try {
    outputStore = await createOutputStore(outputDirectory);
    const result = options.dryRun
      ? await writeDryRun({ cells, config, matrix, outputStore })
      : await executeCells({
          allCells,
          cellBoundaryObserver,
          cells,
          config,
          matrix,
          outputDirectory,
          outputStore,
          revalidateExecutionEnvironment,
          signal: executionSignal,
          verifyExecutionEnvironment,
          machineLockPath,
          machineLockOptions,
          runBenchmarkManifest,
        });
    receipt = {
      mode: options.dryRun ? 'dry-run' : 'execute',
      cells: result.length,
      outputDirectory,
      states: options.dryRun
        ? { planned: result.length }
        : Object.fromEntries(
            [...new Set(result.map((entry) => entry.state))]
              .sort()
              .map((state) => [
                state,
                result.filter((entry) => entry.state === state).length,
              ]),
          ),
      errors: options.dryRun
        ? []
        : result.filter((entry) => entry.error !== null).map((entry) => entry.error),
    };
    receipt.ok =
      options.dryRun ||
      (receipt.errors.length === 0 &&
        result.every((entry) => entry.state === 'completed'));
    if (!receipt.ok) {
      const error = new Error('Benchmark execution completed with one or more cell errors.');
      error.code = 'benchmark_execution_errors';
      error.receipt = receipt;
      throw error;
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await outputStore?.close();
    } catch (error) {
      closeError = error;
      if (primaryError === null) {
        primaryError = error;
      } else {
        primaryError.details = {
          ...primaryError.details,
          outputStoreCloseErrorCode: error?.code ?? null,
        };
      }
    }
    if (controller !== null) {
      process.removeListener('SIGINT', abort);
      process.removeListener('SIGTERM', abort);
    }
  }
  if (primaryError !== null) {
    if (receipt?.ok === false && closeError === null) {
      io.stdout(`${JSON.stringify(receipt)}\n`);
    }
    throw primaryError;
  }
  io.stdout(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

const invokedUrl =
  process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedUrl === import.meta.url) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: error?.code ?? 'benchmark_cli_failed',
          message: error?.message ?? String(error),
        },
      })}\n`,
    );
    process.exitCode = 1;
  });
}
