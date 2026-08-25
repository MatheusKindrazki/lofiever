import { spawn } from 'node:child_process';
import path from 'node:path';

import {
  assertMachOExecutableClosure,
  revalidateExecutableClosure,
} from './dynamic-linker.mjs';
import { createConfinedOutputStore } from './confined-output-store.mjs';
import { acquireConfinedRunLock } from './confined-run-lock.mjs';
import {
  assertProcessEnvironmentReceipt,
  assertSafeChildEnvironment,
  verifyPinnedPath,
} from './integrity.mjs';
import { MAX_ADAPTER_OUTPUT_BYTES, MAX_ARTIFACT_BYTES } from './limits.mjs';

import {
  assertManifestIntegrity,
  createAttemptReceipt,
  createSidecarIdentity,
  deriveAttemptReceiptSha256,
  deriveConfiguration,
  deriveRequestSha256,
  recordPaths,
  serializeManifest,
  sha256Receipt,
  validateManifest,
} from './manifest.mjs';
import {
  candidateDurationsWithinTolerance,
  deriveSummary,
  executorResultSchema,
} from './schema.mjs';
import {
  openConfinedFile,
  openPrivateDirectory,
  readFileNoFollow,
  renameFileDurable,
} from './storage.mjs';

export class BenchmarkCheckpointError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BenchmarkCheckpointError';
    this.code = 'checkpoint_integrity_failed';
    this.details = details;
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function sameValue(left, right) {
  return serializeManifest(left) === serializeManifest(right);
}

async function probeAudioDuration(audioBytes, ffprobe, processEnvironment = {}) {
  if (!Buffer.isBuffer(audioBytes) || audioBytes.length < 1 || audioBytes.length > MAX_ARTIFACT_BYTES) {
    throw new BenchmarkCheckpointError('Candidate bytes exceed the bounded ffprobe input contract.');
  }
  const probePin = deepFreeze(structuredClone(ffprobe));
  const probeEnvironment = Object.freeze({ ...processEnvironment });
  assertSafeChildEnvironment(probeEnvironment, 'ffprobe');
  const verifiedProbe = await verifyPinnedPath(probePin, {
    executable: true,
    label: 'ffprobe executable',
  });
  const closure = await revalidateExecutableClosure(verifiedProbe);
  assertMachOExecutableClosure(closure, {
    code: 'ffprobe_not_macho',
    label: 'ffprobe',
  });
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const maxStdoutBytes = 4 * 1024 * 1024;
  const maxStderrBytes = 64 * 1024;
  const child = spawn(
    verifiedProbe.realpath,
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_frames',
      '-show_entries',
      'format=duration:stream=index,codec_type,sample_rate:frame=stream_index,nb_samples',
      '-of',
      'json',
      'pipe:0',
    ],
    {
      env: probeEnvironment,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
  timer.unref();
  const stdinReceipt = new Promise((resolve) => {
    child.stdin.once('finish', () => resolve({ finished: true, error: null }));
    child.stdin.once('error', (error) => resolve({ finished: false, error }));
  });
  child.stdin.end(audioBytes);
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes <= maxStdoutBytes) stdout.push(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= maxStderrBytes) stderr.push(chunk);
  });
  const processReceipt = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  const [result, input] = await Promise.all([processReceipt, stdinReceipt])
    .finally(() => clearTimeout(timer));
  if (!input.finished || input.error !== null) {
    throw new BenchmarkCheckpointError(
      'Pinned ffprobe did not consume the complete bounded candidate snapshot.',
      { cause: input.error?.code ?? null },
    );
  }
  if (stdoutBytes > maxStdoutBytes || stderrBytes > maxStderrBytes) {
    throw new BenchmarkCheckpointError('ffprobe exceeded its bounded output limit.');
  }
  if (result.exitCode !== 0) {
    throw new BenchmarkCheckpointError('Pinned ffprobe could not measure candidate duration.', {
      exitCode: result.exitCode,
      signal: result.signal,
      stderrSha256: sha256Receipt(Buffer.concat(stderr)),
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(stdout).toString('utf8'));
  } catch {
    throw new BenchmarkCheckpointError('Pinned ffprobe returned invalid duration JSON.');
  }
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const frames = Array.isArray(parsed?.frames) ? parsed.frames : [];
  const stream = streams.length === 1 ? streams[0] : null;
  const sampleRate = Number(stream?.sample_rate);
  const streamIndex = Number(stream?.index);
  const frameSamples = frames.map((frame) => Number(frame?.nb_samples));
  if (
    stream?.codec_type !== 'audio' ||
    !Number.isInteger(streamIndex) ||
    streamIndex < 0 ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 1 ||
    frameSamples.length < 1 ||
    frameSamples.some((samples, index) =>
      !Number.isInteger(samples) ||
      samples < 1 ||
      Number(frames[index]?.stream_index) !== streamIndex)
  ) {
    throw new BenchmarkCheckpointError('Pinned ffprobe did not return a positive duration.', {
      stdoutSha256: sha256Receipt(Buffer.concat(stdout)),
    });
  }
  const totalSamples = frameSamples.reduce((sum, samples) => sum + samples, 0);
  const durationSeconds = totalSamples / sampleRate;
  const formatDuration = Number(parsed?.format?.duration);
  if (
    !Number.isSafeInteger(totalSamples) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    (Number.isFinite(formatDuration) &&
      formatDuration > 0 &&
      Math.abs(formatDuration - durationSeconds) > 0.001)
  ) {
    throw new BenchmarkCheckpointError('Pinned ffprobe returned inconsistent sample evidence.', {
      stdoutSha256: sha256Receipt(Buffer.concat(stdout)),
    });
  }
  return durationSeconds;
}

export async function inspectArtifact(
  outputRoot,
  relativePath,
  { ffprobe, outputStore = null, processEnvironment = {} } = {},
) {
  if (
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).includes('..') ||
    relativePath.includes('\0')
  ) {
    throw new BenchmarkCheckpointError(
      `Artifact path is not confined: ${relativePath}`,
    );
  }
  const ownsRoot = typeof outputRoot === 'string';
  const storageRoot = ownsRoot ? await openPrivateDirectory(outputRoot) : outputRoot;
  let confinedFile = null;
  try {
    storageRoot.verifyCurrent();
    let artifactBytes;
    let artifactReceipt;
    if (outputStore !== null) {
      const snapshot = await outputStore.readFile(relativePath, {
        maxBytes: MAX_ARTIFACT_BYTES,
      });
      if (snapshot === null) {
        throw new BenchmarkCheckpointError(`Candidate artifact is missing: ${relativePath}`);
      }
      artifactBytes = snapshot.bytes;
      artifactReceipt = snapshot.receipt;
    } else {
      confinedFile = await openConfinedFile(storageRoot, relativePath, {
        maxBytes: MAX_ARTIFACT_BYTES,
      });
      artifactBytes = await confinedFile.readBytes();
      artifactReceipt = {
        bytes: confinedFile.bytes,
        device: confinedFile.device,
        inode: confinedFile.inode,
        sha256: confinedFile.sha256,
      };
    }
    const artifactSha256 = sha256Receipt(artifactBytes);
    if (
      artifactReceipt.bytes !== artifactBytes.length ||
      artifactReceipt.sha256 !== artifactSha256
    ) {
      throw new BenchmarkCheckpointError('Candidate artifact snapshot receipt is inconsistent.');
    }
    const durationSeconds =
      ffprobe === undefined || ffprobe === null
        ? undefined
        : await probeAudioDuration(artifactBytes, ffprobe, processEnvironment);
    if (outputStore !== null) {
      const finalSnapshot = await outputStore.readFile(relativePath, {
        maxBytes: MAX_ARTIFACT_BYTES,
      });
      if (
        finalSnapshot === null ||
        !sameValue(finalSnapshot.receipt, artifactReceipt) ||
        !finalSnapshot.bytes.equals(artifactBytes)
      ) {
        throw new BenchmarkCheckpointError(
          `Candidate artifact changed after duration probing: ${relativePath}`,
        );
      }
    } else {
      await confinedFile.verifyCurrent();
    }
    storageRoot.verifyCurrent();
    return {
      relativePath: relativePath.split(path.sep).join('/'),
      sha256: artifactSha256,
      bytes: artifactBytes.length,
      device: artifactReceipt.device,
      inode: artifactReceipt.inode,
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
    };
  } finally {
    await confinedFile?.close();
    if (ownsRoot) await storageRoot.close();
  }
}

async function verifyArtifactReceipt(outputRoot, receipt, options) {
  const inspected = await inspectArtifact(outputRoot, receipt.relativePath, options);
  const { durationSeconds, ...actual } = inspected;
  if (!sameValue(actual, receipt)) {
    throw new BenchmarkCheckpointError(
      `Artifact receipt changed: ${receipt.relativePath}`,
      { expected: receipt, actual },
    );
  }
  return durationSeconds;
}

function resolveOutputPath(outputRoot, relativePath) {
  return typeof outputRoot === 'string'
    ? path.join(outputRoot, relativePath)
    : outputRoot.resolve(relativePath);
}

async function readConfinedOutputBytes(outputRoot, relativePath, outputStore = null) {
  if (outputStore !== null) {
    const result = await outputStore.readFile(relativePath, {
      maxBytes: MAX_ADAPTER_OUTPUT_BYTES,
    });
    if (result === null) {
      const missing = new Error(`Missing confined output file: ${relativePath}`);
      missing.code = 'ENOENT';
      throw missing;
    }
    return result.bytes;
  }
  const ownsRoot = typeof outputRoot === 'string';
  const storageRoot = ownsRoot ? await openPrivateDirectory(outputRoot) : outputRoot;
  let confinedFile = null;
  try {
    confinedFile = await openConfinedFile(storageRoot, relativePath, {
      maxBytes: MAX_ADAPTER_OUTPUT_BYTES,
    });
    return await confinedFile.readBytes();
  } finally {
    await confinedFile?.close();
    if (ownsRoot) await storageRoot.close();
  }
}

async function assertSidecarMatchesRecord(
  outputRoot,
  manifest,
  record,
  outputStore = null,
) {
  const receipt = record.commandReceipt.sidecar;
  if (receipt === null) {
    if (record.status === 'completed') {
      throw new BenchmarkCheckpointError(
        'A completed record requires its consumed executor sidecar.',
      );
    }
    return;
  }
  const paths = recordPaths({
    cell: {
      durationSeconds: manifest.factors.durationSeconds,
      batchSizeRequested: manifest.factors.batchSizeRequested,
    },
    phase: record.phase,
    index: record.index,
    attempt: record.attempt,
  });
  if (receipt.relativePath !== paths.consumedResultJsonPath) {
    throw new BenchmarkCheckpointError('Consumed sidecar path does not match this attempt.');
  }
  const raw = await readConfinedOutputBytes(
    outputRoot,
    receipt.relativePath,
    outputStore,
  );
  if (sha256Receipt(raw) !== receipt.sha256 || raw.length !== receipt.bytes) {
    throw new BenchmarkCheckpointError('Consumed sidecar receipt does not match its bytes.');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new BenchmarkCheckpointError('Consumed sidecar is not valid JSON.');
  }
  const validation = executorResultSchema.safeParse(parsed);
  if (!validation.success) {
    throw new BenchmarkCheckpointError('Consumed sidecar no longer satisfies its schema.');
  }
  const expectedCandidates = record.candidates.map((candidate) => ({
    index: candidate.index,
    durationSeconds: candidate.adapterDeclaredDurationSeconds,
    wallTimeSeconds: candidate.wallTimeSeconds,
    outputFile: candidate.artifact.relativePath,
  }));
  const expectedStatus = record.status === 'completed' ? 'success' : 'failure';
  const expectedMetricReasons = Object.fromEntries(
    ['peakMemoryBytes', 'energyWh']
      .filter((name) => record.metricUnavailableReason[name] !== null)
      .map((name) => [name, record.metricUnavailableReason[name]]),
  );
  if (
    !sameValue(validation.data.identity, createSidecarIdentity(manifest, record)) ||
    validation.data.status !== expectedStatus ||
    !sameValue(validation.data.metrics, {
      peakMemoryBytes: record.peakMemoryBytes,
      energyWh: record.energyWh,
    }) ||
    !sameValue(validation.data.metricUnavailableReason, expectedMetricReasons) ||
    !sameValue(validation.data.candidates, expectedCandidates) ||
    !sameValue(validation.data.error, record.error)
  ) {
    throw new BenchmarkCheckpointError(
      'Consumed sidecar evidence disagrees with request, candidates, metrics, or error.',
    );
  }
}

function records(manifest) {
  return [manifest.warmup, ...manifest.repetitions];
}

function refreshDerived(manifest) {
  const effectiveBatches = manifest.repetitions
    .filter((record) => record.status === 'completed')
    .map((record) => record.batchSizeEffective);
  const uniqueEffective = [...new Set(effectiveBatches)];
  manifest.factors.batchSizeEffective =
    uniqueEffective.length === 1 ? uniqueEffective[0] : null;
  manifest.summary = deriveSummary(manifest);
  if (manifest.energyCollection.source === 'none') {
    manifest.energyCollection.unavailableReason = 'not_requested';
  } else if (['completed', 'completed_with_errors'].includes(manifest.state)) {
    manifest.energyCollection.unavailableReason =
      manifest.summary.energyUnavailableReason;
  } else {
    manifest.energyCollection.unavailableReason = 'not_reported_yet';
  }
}

async function checkpoint(
  outputStore,
  manifestRelativePath,
  manifest,
  expectedReceipt,
) {
  refreshDerived(manifest);
  const validation = validateManifest(manifest);
  if (!validation.success) {
    throw new BenchmarkCheckpointError('Refusing to write an invalid benchmark checkpoint.', {
      cause: validation.error?.message,
      issues: validation.error?.issues,
    });
  }
  const bytes = serializeManifest(manifest);
  return expectedReceipt === null
    ? outputStore.createExclusiveFile(manifestRelativePath, bytes)
    : outputStore.replaceFile(manifestRelativePath, expectedReceipt, bytes);
}

async function assertTerminalEvidence({
  manifest,
  outputDirectory,
  outputStore = null,
  plannedManifest,
}) {
  refreshDerived(manifest);
  const validation = validateManifest(manifest);
  if (!validation.success) {
    throw new BenchmarkCheckpointError(
      'Terminal benchmark evidence does not satisfy manifest invariants.',
      {
        cause: validation.error?.message,
        issues: validation.error?.issues,
      },
    );
  }
  await assertCheckpointIntegrity({
    checkpoint: validation.data,
    outputDirectory,
    outputStore,
    plannedManifest,
  });
}

export async function assertCheckpointIntegrity({
  checkpoint: candidate,
  outputDirectory,
  outputStore = null,
  plannedManifest,
}) {
  try {
    assertManifestIntegrity(candidate);
  } catch (error) {
    throw new BenchmarkCheckpointError('Checkpoint manifest integrity failed.', {
      cause: error?.message ?? String(error),
    });
  }
  try {
    assertManifestIntegrity(plannedManifest);
  } catch (error) {
    throw new BenchmarkCheckpointError('Current configuration did not produce a valid plan.', {
      cause: error?.message ?? String(error),
    });
  }
  if (
    candidate.configurationSha256 !== plannedManifest.configurationSha256 ||
    candidate.runId !== plannedManifest.runId ||
    !sameValue(deriveConfiguration(candidate), deriveConfiguration(plannedManifest))
  ) {
    throw new BenchmarkCheckpointError(
      'Checkpoint does not match the current validated configuration.',
    );
  }
  const plannedRecords = records(plannedManifest);
  const candidateRecords = records(candidate);
  if (candidateRecords.length !== plannedRecords.length) {
    throw new BenchmarkCheckpointError('Checkpoint record set changed.');
  }
  for (let index = 0; index < candidateRecords.length; index += 1) {
    const actual = candidateRecords[index];
    const expected = plannedRecords[index];
    if (
      actual.phase !== expected.phase ||
      actual.index !== expected.index ||
      actual.batchSizeRequested !== expected.batchSizeRequested ||
      actual.commandReceipt.commandSha256 !== expected.commandReceipt.commandSha256
    ) {
      throw new BenchmarkCheckpointError('Checkpoint record identity changed.', {
        phase: actual.phase,
        index: actual.index,
      });
    }
    for (const candidate of actual.candidates) {
      const measuredDuration = await verifyArtifactReceipt(
        outputDirectory,
        candidate.artifact,
        { ffprobe: plannedManifest.toolchain.ffprobe, outputStore },
      );
      if (Math.abs(measuredDuration - candidate.durationSeconds) > 1e-9) {
        throw new BenchmarkCheckpointError(
          `Candidate duration receipt changed: ${candidate.artifact.relativePath}`,
        );
      }
      if (
        !candidateDurationsWithinTolerance({
          measuredDurationSeconds: measuredDuration,
          adapterDeclaredDurationSeconds: candidate.adapterDeclaredDurationSeconds,
          requestedDurationSeconds: plannedManifest.factors.durationSeconds,
        })
      ) {
        throw new BenchmarkCheckpointError(
          `Candidate duration is outside the requested tolerance: ${candidate.artifact.relativePath}`,
        );
      }
    }
    if (actual.commandReceipt.sidecar !== null) {
      await verifyArtifactReceipt(outputDirectory, actual.commandReceipt.sidecar, {
        outputStore,
      });
    }
    await assertSidecarMatchesRecord(outputDirectory, candidate, actual, outputStore);
  }
  return candidate;
}

export async function readCheckpointBytes(
  bytes,
  { outputDirectory, outputStore = null, plannedManifest = null } = {},
) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    if (error?.code === 'checkpoint_integrity_failed') throw error;
    throw new BenchmarkCheckpointError('Checkpoint cannot be read as bounded JSON.', {
      cause: error?.message ?? String(error),
    });
  }
  const validation = validateManifest(parsed);
  if (!validation.success) {
    throw new BenchmarkCheckpointError('Checkpoint does not satisfy manifest invariants.', {
      cause: validation.error?.message,
      issues: validation.error?.issues,
    });
  }
  if (outputDirectory) {
    await assertCheckpointIntegrity({
      checkpoint: validation.data,
      outputDirectory,
      outputStore,
      plannedManifest: plannedManifest ?? validation.data,
    });
  }
  return validation.data;
}

export async function readCheckpoint(
  manifestPath,
  options = {},
) {
  let bytes;
  try {
    bytes = await readFileNoFollow(manifestPath, { maxBytes: 32 * 1024 * 1024 });
  } catch (error) {
    if (error?.code === 'checkpoint_integrity_failed') throw error;
    throw new BenchmarkCheckpointError('Checkpoint cannot be read as bounded JSON.', {
      cause: error?.message ?? String(error),
    });
  }
  return readCheckpointBytes(bytes, options);
}

function emptyHash() {
  return sha256Receipt(Buffer.alloc(0));
}

function beginAttempt(manifest, record) {
  const previousAttemptReceiptSha256 =
    record.attemptReceipts.at(-1)?.attemptReceiptSha256 ?? null;
  record.attempt += 1;
  record.status = 'running';
  record.error = null;
  record.candidates = [];
  record.wallTimeSeconds = null;
  record.rtf = null;
  record.peakMemoryBytes = null;
  record.energyWh = null;
  record.batchSizeEffective = null;
  record.audioDurationSeconds = null;
  record.metricUnavailableReason = {
    wallTimeSeconds: 'running',
    rtf: 'running',
    peakMemoryBytes: 'running',
    energyWh: 'running',
    batchSizeEffective: 'running',
    audioDurationSeconds: 'running',
  };
  record.commandReceipt = {
    ...record.commandReceipt,
    requestSha256: deriveRequestSha256(manifest, record),
    executed: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    signal: null,
    stdoutSha256: null,
    stderrSha256: null,
    stdoutBytes: null,
    stderrBytes: null,
    sidecar: null,
    previousAttemptReceiptSha256,
    attemptReceiptSha256: null,
  };
}

function normalizedFailure(error) {
  if (
    error !== null &&
    typeof error === 'object' &&
    typeof error.code === 'string' &&
    typeof error.category === 'string' &&
    typeof error.message === 'string' &&
    typeof error.retryable === 'boolean' &&
    typeof error.allocationFailure === 'boolean'
  ) {
    return error;
  }
  return {
    code: 'executor_unhandled_failure',
    category: 'executor',
    message: error?.message ?? String(error),
    retryable: false,
    allocationFailure: false,
    detailsSha256: error?.message ? sha256Receipt(String(error.message)) : null,
  };
}

function receiptFromResult(record, result) {
  const stdout = Buffer.from(result.stdout ?? Buffer.alloc(0));
  const stderr = Buffer.from(result.stderr ?? Buffer.alloc(0));
  record.commandReceipt = {
    ...record.commandReceipt,
    executed: true,
    startedAt: result.startedAt ?? record.commandReceipt.startedAt,
    finishedAt: result.finishedAt ?? new Date().toISOString(),
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    stdoutSha256: sha256Receipt(stdout),
    stderrSha256: sha256Receipt(stderr),
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    sidecar: result.sidecar ?? null,
  };
}

function failedResultFromException(error, record) {
  return {
    status: 'failure',
    startedAt: record.commandReceipt.startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: null,
    signal: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    wallTimeSeconds: null,
    metrics: { peakMemoryBytes: null, energyWh: null },
    metricUnavailableReason: {
      peakMemoryBytes: 'execution_failed',
      energyWh: 'execution_failed',
    },
    candidates: [],
    sidecar: null,
    error: normalizedFailure(error),
  };
}

function failedResultFromPostStartValidation(error, record, evidence) {
  return {
    ...failedResultFromException(error, record),
    startedAt: evidence.startedAt ?? record.commandReceipt.startedAt,
    finishedAt: evidence.finishedAt ?? new Date().toISOString(),
    exitCode: evidence.exitCode ?? null,
    signal: evidence.signal ?? null,
    stdout: Buffer.from(evidence.stdout ?? Buffer.alloc(0)),
    stderr: Buffer.from(evidence.stderr ?? Buffer.alloc(0)),
    wallTimeSeconds:
      Number.isFinite(evidence.wallTimeSeconds) && evidence.wallTimeSeconds > 0
        ? evidence.wallTimeSeconds
        : null,
  };
}

function invalidGenerationResult(message) {
  return {
    code: 'invalid_generation_result',
    category: 'validation',
    message,
    retryable: false,
    allocationFailure: false,
    detailsSha256: null,
  };
}

async function applyResult({
  manifest,
  outputDirectory,
  outputStore = null,
  processEnvironment,
  record,
  result,
}) {
  receiptFromResult(record, result);
  if (result.sidecar !== null && result.sidecar !== undefined) {
    await verifyArtifactReceipt(outputDirectory, result.sidecar, { outputStore });
  }
  let error = result.status === 'failure' ? normalizedFailure(result.error) : null;
  let candidates = [];
  if (error === null) {
    const returned = Array.isArray(result.candidates) ? result.candidates : [];
    const indices = returned.map((candidate) => candidate.index);
    const files = returned.map((candidate) => candidate.outputFile);
    const paths = recordPaths({
      cell: {
        durationSeconds: manifest.factors.durationSeconds,
        batchSizeRequested: manifest.factors.batchSizeRequested,
      },
      phase: record.phase,
      index: record.index,
      attempt: record.attempt,
    });
    const artifactPrefix = `${paths.artifactDirectory}/`;
    if (
      result.status !== 'success' ||
      result.error !== null ||
      result.sidecar === null ||
      returned.length < 1 ||
      returned.length > record.batchSizeRequested ||
      indices.some((index, offset) => index !== offset + 1) ||
      new Set(files).size !== files.length ||
      files.some((file) => !file.startsWith(artifactPrefix))
    ) {
      error = invalidGenerationResult(
        'Successful generation requires a sidecar and one unique candidate per effective batch.',
      );
    } else {
      try {
        for (const candidate of returned) {
          const inspected = await inspectArtifact(outputDirectory, candidate.outputFile, {
            ffprobe: manifest.toolchain.ffprobe,
            outputStore,
            processEnvironment,
          });
          const { durationSeconds, ...artifact } = inspected;
          if (
            !candidateDurationsWithinTolerance({
              measuredDurationSeconds: durationSeconds,
              adapterDeclaredDurationSeconds: candidate.durationSeconds,
              requestedDurationSeconds: manifest.factors.durationSeconds,
            })
          ) {
            throw new BenchmarkCheckpointError(
              `Candidate duration is outside the ${manifest.factors.durationSeconds}s cell tolerance.`,
            );
          }
          candidates.push({
            index: candidate.index,
            durationSeconds,
            adapterDeclaredDurationSeconds: candidate.durationSeconds,
            wallTimeSeconds: candidate.wallTimeSeconds,
            artifact,
          });
        }
        if (
          new Set(
            candidates.map(
              (candidate) => `${candidate.artifact.device}:${candidate.artifact.inode}`,
            ),
          ).size !== candidates.length ||
          new Set(candidates.map((candidate) => candidate.artifact.sha256)).size !==
            candidates.length
        ) {
          throw new BenchmarkCheckpointError(
            'Candidate artifacts must have unique file identities and digests.',
          );
        }
      } catch (artifactError) {
        error = invalidGenerationResult(
          `Candidate artifact could not be verified: ${artifactError.message}`,
        );
        candidates = [];
      }
      if (error === null) {
        const priorEffectiveBatches = records(manifest)
          .filter((candidateRecord) =>
            candidateRecord !== record && candidateRecord.status === 'completed')
          .map((candidateRecord) => candidateRecord.batchSizeEffective);
        if (
          priorEffectiveBatches.length > 0 &&
          priorEffectiveBatches.some((batch) => batch !== candidates.length)
        ) {
          error = {
            code: 'batch_effective_diverged',
            category: 'validation',
            message: 'Effective batch changed within one benchmark cell.',
            retryable: false,
            allocationFailure: false,
            detailsSha256: null,
          };
          candidates = [];
        }
      }
    }
  }
  const wallTimeSeconds =
    Number.isFinite(result.wallTimeSeconds) && result.wallTimeSeconds > 0
      ? result.wallTimeSeconds
      : null;
  if (error === null && wallTimeSeconds === null) {
    error = invalidGenerationResult(
      'Successful generation requires a positive monotonic wall-time measurement.',
    );
    candidates = [];
  }
  record.wallTimeSeconds = wallTimeSeconds;
  record.peakMemoryBytes = result.metrics?.peakMemoryBytes ?? null;
  record.energyWh = result.metrics?.energyWh ?? null;
  record.error = error;
  record.candidates = candidates;
  if (error === null) {
    const totalDuration = candidates.reduce(
      (total, candidate) => total + candidate.durationSeconds,
      0,
    );
    record.status = 'completed';
    record.batchSizeEffective = candidates.length;
    record.audioDurationSeconds = totalDuration;
    record.rtf = wallTimeSeconds / totalDuration;
  } else {
    record.status = error.category === 'interrupted' && error.retryable
      ? 'interrupted'
      : 'failed';
    record.batchSizeEffective = null;
    record.audioDurationSeconds = null;
    record.rtf = null;
    record.candidates = [];
  }
  record.metricUnavailableReason = {
    wallTimeSeconds:
      wallTimeSeconds === null ? 'monotonic_measurement_unavailable' : null,
    rtf: record.rtf === null ? 'execution_failed' : null,
    peakMemoryBytes:
      record.peakMemoryBytes === null
        ? result.metricUnavailableReason?.peakMemoryBytes ?? 'not_reported_by_executor'
        : null,
    energyWh:
      record.energyWh === null
        ? result.metricUnavailableReason?.energyWh ?? 'not_reported_by_executor'
        : null,
    batchSizeEffective:
      record.batchSizeEffective === null ? 'execution_failed' : null,
    audioDurationSeconds:
      record.audioDurationSeconds === null ? 'execution_failed' : null,
  };
  if (
    error !== null &&
    result.status === 'success' &&
    record.commandReceipt.sidecar !== null
  ) {
    const sidecarRelativePath = record.commandReceipt.sidecar.relativePath;
    if (outputStore === null) {
      const sidecarPath = resolveOutputPath(outputDirectory, sidecarRelativePath);
      await renameFileDurable(
        sidecarPath,
        `${sidecarPath}.quarantine-runner-validation-${record.commandReceipt.sidecar.sha256.slice(-12)}`,
      );
    } else {
      await outputStore.renameFile(
        sidecarRelativePath,
        `${sidecarRelativePath}.quarantine-runner-validation-${record.commandReceipt.sidecar.sha256.slice(-12)}`,
      );
    }
    record.commandReceipt.sidecar = null;
  }
  await assertSidecarMatchesRecord(outputDirectory, manifest, record, outputStore);
  record.commandReceipt.attemptReceiptSha256 = deriveAttemptReceiptSha256(
    manifest,
    record,
  );
  record.attemptReceipts.push(createAttemptReceipt(manifest, record));
}

function skipRecord(record, code, message, category = 'executor') {
  if (!['planned', 'interrupted'].includes(record.status)) return;
  record.status = 'skipped';
  record.error = {
    code,
    category,
    message,
    retryable: false,
    allocationFailure: false,
    detailsSha256: null,
  };
  record.metricUnavailableReason = {
    wallTimeSeconds: 'skipped',
    rtf: 'skipped',
    peakMemoryBytes: 'skipped',
    energyWh: 'skipped',
    batchSizeEffective: 'skipped',
    audioDurationSeconds: 'skipped',
  };
}

function skipRemaining(manifest, code, message) {
  for (const record of manifest.repetitions) skipRecord(record, code, message);
}

function finalizeAbandonedRunning(manifest) {
  let changed = false;
  let abandonedSeen = false;
  for (const record of records(manifest)) {
    if (record.status !== 'running') {
      if (abandonedSeen && record.status === 'planned') {
        skipRecord(
          record,
          'skipped_after_abandoned_attempt',
          'Record was skipped because an earlier running attempt was abandoned.',
          'executor',
        );
      }
      continue;
    }
    abandonedSeen = true;
    record.status = 'failed';
    record.error = {
      code: 'execution_abandoned',
      category: 'executor',
      message: 'A previous process ended without an explicit retryable interruption receipt.',
      retryable: false,
      allocationFailure: false,
      detailsSha256: null,
    };
    record.commandReceipt.finishedAt = new Date().toISOString();
    record.commandReceipt.stdoutSha256 = emptyHash();
    record.commandReceipt.stderrSha256 = emptyHash();
    record.commandReceipt.stdoutBytes = 0;
    record.commandReceipt.stderrBytes = 0;
    record.metricUnavailableReason = {
      wallTimeSeconds: 'execution_abandoned',
      rtf: 'execution_abandoned',
      peakMemoryBytes: 'execution_abandoned',
      energyWh: 'execution_abandoned',
      batchSizeEffective: 'execution_abandoned',
      audioDurationSeconds: 'execution_abandoned',
    };
    record.commandReceipt.attemptReceiptSha256 = deriveAttemptReceiptSha256(
      manifest,
      record,
    );
    record.attemptReceipts.push(createAttemptReceipt(manifest, record));
    changed = true;
  }
  return changed;
}

function eligible(record) {
  return (
    record.status === 'planned' ||
    (record.status === 'interrupted' && record.error?.retryable === true)
  );
}

function finalState(manifest) {
  return records(manifest).every((record) => record.status === 'completed')
    ? 'completed'
    : 'completed_with_errors';
}

export async function runBenchmarkManifest({
  executor,
  manifestPath,
  outputDirectory,
  outputStore: providedOutputStore = null,
  runLock: providedRunLock = null,
  plannedManifest,
  postCloseVerify,
  processEnvironment = {},
  signal,
}) {
  if (typeof postCloseVerify !== 'function') {
    const error = new Error(
      'The public benchmark runner requires a post-close provenance verifier.',
    );
    error.code = 'post_close_verifier_required';
    throw error;
  }
  if ((providedOutputStore === null) !== (providedRunLock === null)) {
    const error = new Error(
      'A provided confined output store and its session lock must be supplied together.',
    );
    error.code = 'confined_output_lock_pair_required';
    throw error;
  }
  plannedManifest = deepFreeze(structuredClone(plannedManifest));
  assertManifestIntegrity(plannedManifest);
  const verifiedProcessEnvironment = Object.freeze({ ...processEnvironment });
  assertProcessEnvironmentReceipt(
    verifiedProcessEnvironment,
    plannedManifest.environment,
    plannedManifest.environmentSha256,
  );
  const ownsOutputStore = providedOutputStore === null;
  const outputStore = providedOutputStore ?? await createConfinedOutputStore(outputDirectory);
  const storageRoot = outputStore.storageRoot;
  const ownsRunLock = providedRunLock === null;
  let lock = providedRunLock;
  let cleanupGuardArmed = false;
  let retainLock = false;
  let executorUsed = false;
  const retainForCleanupFailure = async (error) => {
    if (
      error?.cleanupUnproven !== true ||
      lock === null ||
      retainLock
    ) return;
    retainLock = true;
    try {
      await lock.markCleanupUnproven(error);
    } catch (sentinelError) {
      sentinelError.cleanupUnproven = true;
      sentinelError.details = {
        ...sentinelError.details,
        priorErrorCode: error.code ?? null,
      };
      throw sentinelError;
    }
  };
  const closeExecutor = async () => {
    if (!executorUsed) return;
    try {
      await executor.close();
    } catch (error) {
      await retainForCleanupFailure(error);
      throw error;
    } finally {
      executorUsed = false;
    }
  };
  try {
    const manifestRelativePath = path.relative(
      path.resolve(outputDirectory),
      path.resolve(manifestPath),
    );
    const safeManifestPath = storageRoot.resolve(manifestRelativePath);
    const confinedManifestPath = outputStore.relativePath(safeManifestPath);
    if (lock === null) lock = await acquireConfinedRunLock(outputStore, 'benchmark-run');
    await lock.armCleanupPending();
    cleanupGuardArmed = true;
    if (typeof executor?.registerCleanupGuard !== 'function') {
      const error = new Error(
        'The benchmark executor must register the pre-armed cleanup guard.',
      );
      error.code = 'executor_cleanup_guard_registration_required';
      throw error;
    }
    executor.registerCleanupGuard(lock);
    const checkpointFile = await outputStore.readFile(confinedManifestPath);
    let checkpointReceipt = checkpointFile?.receipt ?? null;
    const manifest = checkpointFile === null
      ? structuredClone(plannedManifest)
      : await readCheckpointBytes(checkpointFile.bytes, {
          outputDirectory: storageRoot,
          outputStore,
          plannedManifest,
        });
    if (['completed', 'completed_with_errors'].includes(manifest.state)) {
      await assertTerminalEvidence({
        manifest,
        outputDirectory: storageRoot,
        outputStore,
        plannedManifest,
      });
      await postCloseVerify({
        manifest: structuredClone(manifest),
        plannedManifest,
      });
      return manifest;
    }
    if (finalizeAbandonedRunning(manifest)) {
      manifest.state = 'completed_with_errors';
      if (manifest.warmup.status === 'failed') {
        skipRemaining(
          manifest,
          'warmup_failed',
          'Repetitions were skipped because warmup did not finish safely.',
        );
      }
      await assertTerminalEvidence({
        manifest,
        outputDirectory: storageRoot,
        outputStore,
        plannedManifest,
      });
      await postCloseVerify({
        manifest: structuredClone(manifest),
        plannedManifest,
      });
      checkpointReceipt = await checkpoint(
        outputStore,
        confinedManifestPath,
        manifest,
        checkpointReceipt,
      );
      return manifest;
    }

    const sequence = [manifest.warmup, ...manifest.repetitions];
    for (const record of sequence) {
      if (!eligible(record)) continue;
      beginAttempt(manifest, record);
      manifest.executionMode = 'execute';
      manifest.state = 'running';
      checkpointReceipt = await checkpoint(
        outputStore,
        confinedManifestPath,
        manifest,
        checkpointReceipt,
      );
      executorUsed = true;
      let result;
      try {
        result = await executor.execute({
          manifest: structuredClone(manifest),
          outputDirectory,
          record: structuredClone(record),
          signal,
          storageRoot,
          outputStore,
        });
      } catch (error) {
        result = failedResultFromException(error, record);
      }
      try {
        await applyResult({
          manifest,
          outputDirectory: storageRoot,
          outputStore,
          processEnvironment: verifiedProcessEnvironment,
          record,
          result,
        });
      } catch (error) {
        if (result.sidecar?.relativePath) {
          const sidecarPath = result.sidecar.relativePath;
          await outputStore.renameFile(
            sidecarPath,
            `${sidecarPath}.quarantine-runner-apply-${result.sidecar.sha256.slice(-12)}`,
          ).catch((renameError) => {
            if (renameError?.code !== 'ENOENT') throw renameError;
          });
        }
        result = failedResultFromPostStartValidation(
          invalidGenerationResult(`Post-start evidence validation failed: ${error.message}`),
          record,
          result,
        );
        await applyResult({
          manifest,
          outputDirectory: storageRoot,
          outputStore,
          processEnvironment: verifiedProcessEnvironment,
          record,
          result,
        });
      }
      if (record.status === 'interrupted') {
        manifest.state = 'interrupted';
        checkpointReceipt = await checkpoint(
          outputStore,
          confinedManifestPath,
          manifest,
          checkpointReceipt,
        );
        const interruption = new Error(record.error.message);
        interruption.name = 'AbortError';
        interruption.code = record.error.code;
        throw interruption;
      }
      if (record.error?.allocationFailure) {
        skipRemaining(
          manifest,
          'skipped_after_allocation_failure',
          'Remaining repetitions were skipped after an allocation failure.',
        );
      } else if (record === manifest.warmup && record.status === 'failed') {
        skipRemaining(
          manifest,
          'warmup_failed',
          'Repetitions were skipped because warmup did not finish safely.',
        );
      }
      manifest.state =
        record.error?.allocationFailure ||
        (record === manifest.warmup && record.status === 'failed')
          ? 'completed_with_errors'
          : sequence.some(eligible)
            ? 'running'
            : finalState(manifest);
      if (result.fatalPreflight === true) {
        await closeExecutor();
        await assertTerminalEvidence({
          manifest,
          outputDirectory: storageRoot,
          outputStore,
          plannedManifest,
        });
        await postCloseVerify({
          manifest: structuredClone(manifest),
          plannedManifest,
        });
        checkpointReceipt = await checkpoint(
          outputStore,
          confinedManifestPath,
          manifest,
          checkpointReceipt,
        );
        const fatal = new Error(record.error.message);
        fatal.code = record.error.code;
        throw fatal;
      }
      if (manifest.state === 'completed_with_errors') {
        break;
      }
      if (!['completed', 'completed_with_errors'].includes(manifest.state)) {
        checkpointReceipt = await checkpoint(
          outputStore,
          confinedManifestPath,
          manifest,
          checkpointReceipt,
        );
      }
    }

    await closeExecutor();
    manifest.state = finalState(manifest);
    await assertTerminalEvidence({
      manifest,
      outputDirectory: storageRoot,
      outputStore,
      plannedManifest,
    });
    await postCloseVerify({
      manifest: structuredClone(manifest),
      plannedManifest,
    });
    checkpointReceipt = await checkpoint(
      outputStore,
      confinedManifestPath,
      manifest,
      checkpointReceipt,
    );
    return manifest;
  } catch (error) {
    await retainForCleanupFailure(error);
    throw error;
  } finally {
    try {
      await closeExecutor();
    } finally {
      try {
        if (lock !== null && !retainLock) {
          storageRoot.verifyCurrent();
          if (cleanupGuardArmed) {
            await lock.clearCleanupPending({ processGroupAbsent: true });
          }
          if (ownsRunLock) {
            outputStore.bindTerminalRelease(await lock.prepareTerminalRelease());
          }
        }
      } finally {
        if (ownsOutputStore) await outputStore.close();
      }
    }
  }
}
