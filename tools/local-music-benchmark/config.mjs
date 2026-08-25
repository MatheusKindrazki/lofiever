import { z } from 'zod';

import { MAX_ADAPTER_OUTPUT_BYTES } from './limits.mjs';

const CANONICAL_DURATIONS_SECONDS = Object.freeze([150, 180, 184]);
const CANONICAL_BATCH_SIZES = Object.freeze([1, 2, 4]);
export const PINNED_ENGINE_COMMIT = '14c0211d5a0653b0f63e27686f4c3f151b4d8629';

const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const immutableRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const nullablePositiveInteger = z.number().int().positive().nullable();
const pinnedPathSchema = z
  .object({
    path: z.string().min(1),
    realpath: z.string().min(1),
    sha256: sha256Schema,
  })
  .strict();

const pinnedToolSchema = pinnedPathSchema
  .extend({
    version: z.string().min(1),
  })
  .strict();

const persistentAdapterSchema = z
  .object({
    kind: z.literal('persistent-jsonl-v1'),
    workingDirectory: z.string().min(1).nullable(),
    executable: pinnedPathSchema.nullable(),
    script: pinnedPathSchema.nullable(),
    requestTimeoutSeconds: z.number().positive().finite().max(86_400),
    terminateGraceSeconds: z.number().positive().max(60),
    maxOutputBytes: z.number().int().positive().max(MAX_ADAPTER_OUTPUT_BYTES),
  })
  .strict();

const benchmarkConfigSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    benchmarkId: z.string().min(1),
    matrixFile: z.string().min(1),
    host: z
      .object({
        machine: z.string().min(1),
        chip: z.string().min(1).nullable(),
        memoryBytes: nullablePositiveInteger,
        osVersion: z.string().min(1).nullable(),
      })
      .strict(),
    engine: z
      .object({
        name: z.string().min(1),
        repositoryPath: z.string().min(1).nullable(),
        repoCommit: gitCommitSchema,
      })
      .strict(),
    model: z
      .object({
        id: z.string().min(1),
        revision: z.string().min(1),
        weights: pinnedPathSchema.nullable(),
        lm: z
          .object({
            id: z.string().min(1),
            revision: z.string().min(1),
            weights: pinnedPathSchema.nullable(),
          })
          .strict(),
      })
      .strict(),
    runtime: z
      .object({
        device: z.string().min(1),
        lmBackend: z.string().min(1),
        vaeChunk: nullablePositiveInteger,
        serverCommit: gitCommitSchema.nullable(),
        runDirectory: z.string().min(1).nullable(),
      })
      .strict(),
    adapter: persistentAdapterSchema,
    toolchain: z
      .object({
        git: pinnedToolSchema.nullable(),
        node: pinnedToolSchema.nullable(),
        python: pinnedToolSchema.nullable(),
        uv: pinnedToolSchema.nullable(),
        ffmpeg: pinnedToolSchema.nullable(),
        ffprobe: pinnedToolSchema.nullable(),
      })
      .strict(),
    energyCollection: z
      .object({ source: z.enum(['none', 'executor']) })
      .strict(),
  })
  .strict();

export class BenchmarkConfigError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'BenchmarkConfigError';
    this.code = 'invalid_benchmark_config';
    this.issues = issues;
  }
}

function sameNumbers(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function parseMatrix(input) {
  const issues = [];

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new BenchmarkConfigError('Benchmark matrix must be a JSON object.', [
      { path: '$', code: 'invalid_type', expected: 'object' },
    ]);
  }

  if (input.schemaVersion !== '1.0.0') {
    issues.push({ path: '$.schemaVersion', code: 'unsupported_schema_version' });
  }
  if (!sameNumbers(input.durationSeconds, CANONICAL_DURATIONS_SECONDS)) {
    issues.push({
      path: '$.durationSeconds',
      code: 'non_canonical_matrix',
      expected: [...CANONICAL_DURATIONS_SECONDS],
    });
  }
  if (!sameNumbers(input.batchSize, CANONICAL_BATCH_SIZES)) {
    issues.push({
      path: '$.batchSize',
      code: 'non_canonical_matrix',
      expected: [...CANONICAL_BATCH_SIZES],
    });
  }
  if (input.warmup !== 1) {
    issues.push({ path: '$.warmup', code: 'must_equal', expected: 1 });
  }
  if (!Number.isInteger(input.repetitions) || input.repetitions < 3) {
    issues.push({ path: '$.repetitions', code: 'minimum', minimum: 3 });
  }

  if (issues.length > 0) {
    throw new BenchmarkConfigError('Benchmark matrix is invalid.', issues);
  }

  return Object.freeze({
    schemaVersion: '1.0.0',
    durationSeconds: CANONICAL_DURATIONS_SECONDS,
    batchSize: CANONICAL_BATCH_SIZES,
    warmup: 1,
    repetitions: input.repetitions,
  });
}

export function expandMatrix(matrixInput) {
  const matrix = parseMatrix(matrixInput);
  return matrix.batchSize.flatMap((batchSizeRequested) =>
    matrix.durationSeconds.map((durationSeconds) => ({
      durationSeconds,
      batchSizeRequested,
    })),
  );
}

export const canonicalMatrix = Object.freeze({
  schemaVersion: '1.0.0',
  durationSeconds: CANONICAL_DURATIONS_SECONDS,
  batchSize: CANONICAL_BATCH_SIZES,
  warmup: 1,
  repetitions: 3,
});

export function parseBenchmarkConfig(
  input,
  { harnessCommit, harnessRepositoryPath = null },
) {
  const parsed = benchmarkConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new BenchmarkConfigError('Benchmark configuration is invalid.', parsed.error.issues);
  }
  if (!gitCommitSchema.safeParse(harnessCommit).success) {
    throw new BenchmarkConfigError('Harness commit must be a full Git commit SHA.', [
      { path: '$.runtime.harnessCommit', code: 'invalid_git_commit' },
    ]);
  }
  if (parsed.data.engine.repoCommit !== PINNED_ENGINE_COMMIT) {
    throw new BenchmarkConfigError('Engine commit does not match the RFC pin.', [
      {
        path: '$.engine.repoCommit',
        code: 'unexpected_engine_commit',
        expected: PINNED_ENGINE_COMMIT,
      },
    ]);
  }

  return {
    matrixFile: parsed.data.matrixFile,
    energyCollection: parsed.data.energyCollection,
    adapter: parsed.data.adapter,
    identity: {
      benchmarkId: parsed.data.benchmarkId,
      host: parsed.data.host,
      engine: parsed.data.engine,
      model: parsed.data.model,
      runtime: {
        ...parsed.data.runtime,
        harnessCommit,
        harnessRepositoryPath,
        harnessClean: null,
      },
      toolchain: parsed.data.toolchain,
    },
  };
}

export function assertExecutableBenchmarkConfig(config) {
  const issues = [];
  for (const field of ['chip', 'memoryBytes', 'osVersion']) {
    if (config.identity.host[field] === null) {
      issues.push({ path: `$.host.${field}`, code: 'required_for_execution' });
    }
  }
  if (config.identity.model.id === 'dry-run-no-model') {
    issues.push({ path: '$.model.id', code: 'dry_run_placeholder' });
  }
  if (!immutableRevisionSchema.safeParse(config.identity.model.revision).success) {
    issues.push({ path: '$.model.revision', code: 'immutable_revision_required' });
  }
  if (config.identity.engine.repositoryPath === null) {
    issues.push({ path: '$.engine.repositoryPath', code: 'required_for_execution' });
  }
  if (config.identity.model.weights === null) {
    issues.push({ path: '$.model.weights', code: 'required_for_execution' });
  }
  if (!immutableRevisionSchema.safeParse(config.identity.model.lm.revision).success) {
    issues.push({ path: '$.model.lm.revision', code: 'immutable_revision_required' });
  }
  if (config.identity.model.lm.weights === null) {
    issues.push({ path: '$.model.lm.weights', code: 'required_for_execution' });
  }
  if (config.identity.runtime.device !== 'mps') {
    issues.push({ path: '$.runtime.device', code: 'must_equal', expected: 'mps' });
  }
  if (config.identity.runtime.lmBackend !== 'mlx') {
    issues.push({ path: '$.runtime.lmBackend', code: 'must_equal', expected: 'mlx' });
  }
  if (config.identity.runtime.vaeChunk === null) {
    issues.push({ path: '$.runtime.vaeChunk', code: 'required_for_execution' });
  }
  if (config.adapter.workingDirectory === null) {
    issues.push({ path: '$.adapter.workingDirectory', code: 'required_for_execution' });
  }
  if (config.adapter.executable === null) {
    issues.push({ path: '$.adapter.executable', code: 'required_for_execution' });
  }
  if (config.adapter.script === null) {
    issues.push({ path: '$.adapter.script', code: 'required_for_execution' });
  }
  if (config.identity.runtime.runDirectory === null) {
    issues.push({ path: '$.runtime.runDirectory', code: 'required_for_execution' });
  }
  if (config.identity.runtime.harnessRepositoryPath === null) {
    issues.push({ path: '$.runtime.harnessRepositoryPath', code: 'required_for_execution' });
  }
  for (const tool of ['git', 'node', 'python', 'uv', 'ffmpeg', 'ffprobe']) {
    if (config.identity.toolchain[tool] === null) {
      issues.push({ path: `$.toolchain.${tool}`, code: 'required_for_execution' });
    }
  }
  if (issues.length > 0) {
    throw new BenchmarkConfigError('Execution requires pinned, installed model identity.', issues);
  }
  return config;
}
