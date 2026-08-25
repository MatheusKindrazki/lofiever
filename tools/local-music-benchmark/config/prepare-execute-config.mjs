#!/usr/bin/env node

import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';

import {
  assertExecutableBenchmarkConfig,
  parseBenchmarkConfig,
  PINNED_ENGINE_COMMIT,
} from '../config.mjs';
import {
  assertMachOExecutableClosure,
  assertRelocatablePythonClosure,
  captureExecutableClosure,
  revalidateExecutableClosure,
} from '../dynamic-linker.mjs';
import {
  digestPath,
  observeHostIdentity as observeHostIdentityDefault,
} from '../integrity.mjs';
import { serializeManifest } from '../manifest.mjs';
import { MAX_ADAPTER_OUTPUT_BYTES } from '../limits.mjs';
import { writeFileAtomicDurable } from '../storage.mjs';
import {
  environmentForPinnedManagedPython,
  managedPythonFindArguments,
} from '../uv-managed-python.mjs';

const execFileAsync = promisify(execFile);
const matrixPath = new URL('./lofiever-spike-matrix.v1.json', import.meta.url).pathname;

const requiredEnvironment = [
  'LOFIEVER_BENCHMARK_ID',
  'LOFIEVER_ENGINE_REPOSITORY',
  'LOFIEVER_MODEL_ID',
  'LOFIEVER_MODEL_REVISION',
  'LOFIEVER_MODEL_WEIGHTS',
  'LOFIEVER_LM_ID',
  'LOFIEVER_LM_REVISION',
  'LOFIEVER_LM_WEIGHTS',
  'LOFIEVER_VAE_CHUNK',
  'LOFIEVER_RUN_DIRECTORY',
  'LOFIEVER_ADAPTER_SCRIPT',
  'LOFIEVER_GIT',
  'LOFIEVER_PYTHON',
  'LOFIEVER_UV',
  'LOFIEVER_FFMPEG',
  'LOFIEVER_FFPROBE',
];

function outputArgument(argv) {
  if (argv.length !== 2 || argv[0] !== '--output' || argv[1].length === 0) {
    throw new Error('Usage: prepare-execute-config.mjs --output <private-config.json>');
  }
  return path.resolve(argv[1]);
}

function required(name, environment) {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function optionalNonEmpty(name, environment, fallback) {
  if (environment[name] === undefined) return fallback;
  const value = environment[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string when provided.`);
  }
  return value;
}

function requiredLiteral(name, environment, fallback, expected) {
  const value = optionalNonEmpty(name, environment, fallback);
  if (value !== expected) {
    throw new Error(`${name} must be exactly ${expected}.`);
  }
  return value;
}

function sanitizedChildEnvironment(environment) {
  const unsafeName = Object.keys(environment).find((name) =>
    /^(?:DYLD_|LD_PRELOAD$|LD_LIBRARY_PATH$)/u.test(name));
  if (unsafeName !== undefined) {
    throw new Error(`Unsafe dynamic-loader environment is not accepted: ${unsafeName}.`);
  }
  return Object.fromEntries(
    ['HOME', 'TMPDIR', 'LANG', 'LC_ALL']
      .filter((name) => typeof environment[name] === 'string')
      .map((name) => [name, environment[name]]),
  );
}

function optionalPositiveNumber(
  name,
  environment,
  fallback,
  { integer = false, maximum = Number.POSITIVE_INFINITY } = {},
) {
  if (environment[name] === undefined) return fallback;
  const raw = environment[name];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`${name} must be a positive number when provided.`);
  }
  const decimalPattern = integer
    ? /^[1-9]\d*$/u
    : /^(?:0\.\d+|[1-9]\d*(?:\.\d+)?)$/u;
  if (!decimalPattern.test(raw)) {
    throw new Error(`${name} must use strict positive decimal syntax.`);
  }
  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`${name} must be a valid positive${integer ? ' integer' : ''}.`);
  }
  return value;
}

function optionalCommit(name, environment) {
  if (environment[name] === undefined) return null;
  const value = environment[name];
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(`${name} must be a full immutable Git commit SHA.`);
  }
  return value;
}

function requiredCommit(name, environment) {
  const value = required(name, environment);
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error(`${name} must be a full immutable 40-hex revision.`);
  }
  return value;
}

function energySource(environment) {
  const value = environment.LOFIEVER_ENERGY_SOURCE ?? 'none';
  if (!['none', 'executor'].includes(value)) {
    throw new Error('LOFIEVER_ENERGY_SOURCE must be none or executor.');
  }
  return value;
}

function assertSupportedPython(tool) {
  const match = /^Python\s+(\d+)\.(\d+)\.(\d+)(?:\s|$)/u.exec(tool.version);
  if (
    match === null ||
    Number(match[1]) !== 3 ||
    Number(match[2]) < 11 ||
    Number(match[2]) >= 13
  ) {
    throw new Error('LOFIEVER_PYTHON must report Python >=3.11 and <3.13.');
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

async function assertUvManagedPython(uv, python, version, closure, environment) {
  if (process.platform !== 'darwin') return;
  await revalidateExecutableClosure({ ...uv, dynamicLinker: closure });
  const { stdout } = await execFileAsync(
    uv.realpath,
    managedPythonFindArguments(version),
    {
      encoding: 'utf8',
      env: environmentForPinnedManagedPython(environment, python.realpath),
      maxBuffer: 64 * 1024,
      timeout: 10_000,
    },
  );
  const managedPython = await realpath(stdout.trim());
  if (managedPython !== python.realpath) {
    throw new Error(
      'LOFIEVER_PYTHON must resolve to the pinned uv-managed standalone runtime.',
    );
  }
}

async function pathPin(inputPath) {
  const canonicalPath = await realpath(inputPath);
  return {
    path: inputPath,
    realpath: canonicalPath,
    sha256: await digestPath(canonicalPath),
  };
}

async function toolPin(name, inputPath, environment) {
  const pin = await pathPin(inputPath);
  const args = ['ffmpeg', 'ffprobe'].includes(name) ? ['-version'] : ['--version'];
  const { stdout, stderr } = await execFileAsync(pin.realpath, args, {
    encoding: 'utf8',
    env: environment,
    maxBuffer: 64 * 1024,
    timeout: 10_000,
  });
  const version = `${stdout ?? ''}\n${stderr ?? ''}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!version) throw new Error(`Could not read the ${name} version.`);
  return { ...pin, version };
}

async function nativeToolPin(name, inputPath, environment, { code, label }) {
  const preflightPin = await pathPin(inputPath);
  const dynamicLinker = await captureExecutableClosure(preflightPin);
  assertMachOExecutableClosure(dynamicLinker, { code, label });
  return {
    tool: await toolPin(name, inputPath, environment),
    dynamicLinker,
  };
}

export async function prepareExecuteConfig({
  argv = process.argv.slice(2),
  environment = process.env,
  observeHostIdentity = observeHostIdentityDefault,
  stdout = (value) => process.stdout.write(value),
} = {}) {
  const outputPath = outputArgument(argv);
  for (const name of requiredEnvironment) required(name, environment);
  const childEnvironment = sanitizedChildEnvironment(environment);
  const pythonPath = required('LOFIEVER_PYTHON', environment);
  if (!path.isAbsolute(pythonPath)) {
    throw new Error('LOFIEVER_PYTHON must be an explicit absolute Python 3.11/3.12 path.');
  }
  const benchmarkId = required('LOFIEVER_BENCHMARK_ID', environment);
  const modelId = required('LOFIEVER_MODEL_ID', environment);
  const modelRevision = requiredCommit('LOFIEVER_MODEL_REVISION', environment);
  const lmId = required('LOFIEVER_LM_ID', environment);
  const lmRevision = requiredCommit('LOFIEVER_LM_REVISION', environment);
  const vaeChunk = optionalPositiveNumber('LOFIEVER_VAE_CHUNK', environment, null, {
    integer: true,
  });
  const device = requiredLiteral('LOFIEVER_DEVICE', environment, 'mps', 'mps');
  const lmBackend = requiredLiteral('LOFIEVER_LM_BACKEND', environment, 'mlx', 'mlx');
  const serverCommit = optionalCommit('LOFIEVER_SERVER_COMMIT', environment);
  const requestTimeoutSeconds = optionalPositiveNumber(
    'LOFIEVER_REQUEST_TIMEOUT_SECONDS',
    environment,
    900,
    { maximum: 86_400 },
  );
  const terminateGraceSeconds = optionalPositiveNumber(
    'LOFIEVER_TERMINATE_GRACE_SECONDS',
    environment,
    5,
    { maximum: 60 },
  );
  const maxOutputBytes = optionalPositiveNumber(
    'LOFIEVER_MAX_OUTPUT_BYTES',
    environment,
    1048576,
    { integer: true, maximum: MAX_ADAPTER_OUTPUT_BYTES },
  );
  const configuredEnergySource = energySource(environment);

  const engineRepository = await realpath(required('LOFIEVER_ENGINE_REPOSITORY', environment));
  const runDirectory = await realpath(required('LOFIEVER_RUN_DIRECTORY', environment));
  const [
    git,
    node,
    pythonVerification,
    uvVerification,
    ffmpeg,
    ffprobeVerification,
    modelWeights,
    lmWeights,
    adapterScript,
  ] =
    await Promise.all([
      toolPin('git', required('LOFIEVER_GIT', environment), childEnvironment),
      toolPin('node', process.execPath, childEnvironment),
      nativeToolPin('python', pythonPath, childEnvironment, {
        code: 'python_runtime_not_macho',
        label: 'Python runtime',
      }),
      nativeToolPin('uv', required('LOFIEVER_UV', environment), childEnvironment, {
        code: 'uv_not_macho',
        label: 'uv',
      }),
      toolPin('ffmpeg', required('LOFIEVER_FFMPEG', environment), childEnvironment),
      nativeToolPin('ffprobe', required('LOFIEVER_FFPROBE', environment), childEnvironment, {
        code: 'ffprobe_not_macho',
        label: 'ffprobe',
      }),
      pathPin(required('LOFIEVER_MODEL_WEIGHTS', environment)),
      pathPin(required('LOFIEVER_LM_WEIGHTS', environment)),
      pathPin(required('LOFIEVER_ADAPTER_SCRIPT', environment)),
    ]);
  const python = pythonVerification.tool;
  const uv = uvVerification.tool;
  const ffprobe = ffprobeVerification.tool;
  const pythonMajorMinor = assertSupportedPython(python);
  const { version: _pythonVersion, ...pythonExecutable } = python;
  const pythonClosure = pythonVerification.dynamicLinker;
  assertRelocatablePythonClosure(pythonClosure);
  await assertUvManagedPython(
    uv,
    pythonExecutable,
    pythonMajorMinor,
    uvVerification.dynamicLinker,
    childEnvironment,
  );
  await revalidateExecutableClosure({
    ...ffprobe,
    dynamicLinker: ffprobeVerification.dynamicLinker,
  });
  const config = {
    schemaVersion: '1.0.0',
    benchmarkId,
    matrixFile: await realpath(matrixPath),
    host: await observeHostIdentity(),
    engine: {
      name: 'ace-step-1.5',
      repositoryPath: engineRepository,
      repoCommit: PINNED_ENGINE_COMMIT,
    },
    model: {
      id: modelId,
      revision: modelRevision,
      weights: modelWeights,
      lm: {
        id: lmId,
        revision: lmRevision,
        weights: lmWeights,
      },
    },
    runtime: {
      device,
      lmBackend,
      vaeChunk,
      serverCommit,
      runDirectory,
    },
    adapter: {
      kind: 'persistent-jsonl-v1',
      workingDirectory: engineRepository,
      executable: pythonExecutable,
      script: adapterScript,
      requestTimeoutSeconds,
      terminateGraceSeconds,
      maxOutputBytes,
    },
    toolchain: { git, node, python, uv, ffmpeg, ffprobe },
    energyCollection: {
      source: configuredEnergySource,
    },
  };
  assertExecutableBenchmarkConfig(
    parseBenchmarkConfig(config, {
      harnessCommit: '0'.repeat(40),
      harnessRepositoryPath: engineRepository,
    }),
  );
  await writeFileAtomicDurable(outputPath, serializeManifest(config));
  stdout(
    `${JSON.stringify({
      prepared: true,
      output: outputPath,
      matrixFile: config.matrixFile,
      modelInvoked: false,
    })}\n`,
  );
  return config;
}

const invokedUrl =
  process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedUrl === import.meta.url) {
  prepareExecuteConfig().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code: error?.code ?? 'prepare_execute_config_failed',
          message: error?.message ?? String(error),
        },
      })}\n`,
    );
    process.exitCode = 1;
  });
}
