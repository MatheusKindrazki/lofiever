import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateManifest } from './manifest.mjs';
import {
  candidateDurationsWithinTolerance,
  createExecutorResultJsonSchema,
  createManifestJsonSchema,
  executorResultSchema,
} from './schema.mjs';

const schemaUrl = new URL('./schemas/local-music-spike-manifest.v1.schema.json', import.meta.url);
const fixtureUrl = new URL('./fixtures/dry-run-manifest.v1.json', import.meta.url);
const executorSchemaUrl = new URL('./schemas/executor-result.v1.schema.json', import.meta.url);
const ciUrl = new URL('../../.github/workflows/ci.yml', import.meta.url);

test('candidate duration tolerance is pairwise against the requested cell', () => {
  const withinTolerance = (measuredDurationSeconds, adapterDeclaredDurationSeconds) =>
    candidateDurationsWithinTolerance({
      measuredDurationSeconds,
      adapterDeclaredDurationSeconds,
      requestedDurationSeconds: 180,
    });

  assert.equal(withinTolerance(181, 182), false);
  assert.equal(withinTolerance(181, 181), true);
  assert.equal(withinTolerance(179, 179), true);
  assert.equal(withinTolerance(181.000001, 180), false);
  assert.equal(withinTolerance(180, 178.999999), false);
});

test('keeps the reusable JSON Schema generated from the runtime contract', async () => {
  const committedSchema = JSON.parse(await readFile(schemaUrl, 'utf8'));

  assert.deepEqual(committedSchema, createManifestJsonSchema());
});

test('publishes the executor sidecar boundary as reusable JSON Schema', async () => {
  const committedSchema = JSON.parse(await readFile(executorSchemaUrl, 'utf8'));

  assert.deepEqual(committedSchema, createExecutorResultJsonSchema());
});

test('labels JSON Schemas as structural and points callers to evidence validation', () => {
  for (const schema of [createManifestJsonSchema(), createExecutorResultJsonSchema()]) {
    assert.equal(schema['x-lofiever-validation-scope'], 'structural-schema-only');
    assert.match(schema.$comment, /--validate-evidence/u);
  }
});

test('execute JSON Schema requires VAE chunk, adapter, uv, and ffprobe closure receipts', () => {
  const executeCondition = createManifestJsonSchema().allOf[0];
  assert.equal(executeCondition.if.properties.executionMode.const, 'execute');
  assert.equal(
    executeCondition.then.properties.adapter.properties.dynamicLinker.type,
    'object',
  );
  assert.deepEqual(
    executeCondition.then.properties.runtime.properties.vaeChunk,
    { type: 'integer', minimum: 1 },
  );
  assert.deepEqual(executeCondition.then.properties.runtime.properties.device, {
    const: 'mps',
  });
  assert.deepEqual(executeCondition.then.properties.runtime.properties.lmBackend, {
    const: 'mlx',
  });
  assert.equal(
    createManifestJsonSchema().properties.engine.properties.repoCommit.const,
    '14c0211d5a0653b0f63e27686f4c3f151b4d8629',
  );
  assert.deepEqual(executeCondition.then.properties.host.properties.memoryBytes, {
    type: 'integer',
    minimum: 1,
  });
  assert.deepEqual(
    executeCondition.then.properties.toolchain.properties.ffprobe.required,
    ['dynamicLinker'],
  );
  assert.equal(
    executeCondition.then.properties.adapter.properties.dynamicLinker.allOf[0]
      .then.properties.format.const,
    'mach-o',
  );
  assert.deepEqual(
    executeCondition.then.properties.toolchain.properties.uv.required,
    ['dynamicLinker'],
  );
  assert.equal(
    executeCondition.then.properties.unavailableIdentity.properties.adapter.type,
    'null',
  );
  const energyCondition = createManifestJsonSchema().allOf[1];
  assert.equal(
    energyCondition.if.properties.energyCollection.properties.source.const,
    'executor',
  );
  assert.equal(
    energyCondition.then.properties.energyCollection.properties.requested.const,
    true,
  );
  assert.equal(
    energyCondition.else.properties.energyCollection.properties.requested.const,
    false,
  );
});

test('CI runs the complete Node 20 benchmark contract as a blocking job', async () => {
  const workflow = await readFile(ciUrl, 'utf8');
  const job = workflow.split(/\n  local-music-benchmark:\n/u)[1];
  assert.ok(job, 'missing local-music-benchmark job');
  assert.match(job, /node-version: ['"]20['"]/u);
  assert.match(job, /node --check/u);
  assert.match(job, /node --test tools\/local-music-benchmark\/\*\.test\.mjs/u);
  assert.doesNotMatch(job.split(/\n  [a-z][a-z-]+:\n/u)[0], /continue-on-error:\s*true/u);
});

test('validates the committed dry-run fixture without replacing unavailable metrics with zero', async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  const validation = validateManifest(fixture);

  assert.equal(validation.success, true, JSON.stringify(validation.error?.issues));
  for (const record of [fixture.warmup, ...fixture.repetitions]) {
    assert.equal(record.wallTimeSeconds, null);
    assert.equal(record.rtf, null);
    assert.equal(record.peakMemoryBytes, null);
    assert.equal(record.energyWh, null);
  }
});

test('sidecar metrics require exactly one of a value or an unavailable reason', () => {
  const result = {
    schemaVersion: '1.0.0',
    identity: {
      runId: '1'.repeat(64),
      configurationSha256: `sha256:${'2'.repeat(64)}`,
      durationSeconds: 180,
      batchSizeRequested: 1,
      phase: 'repetition',
      index: 1,
      attempt: 1,
      commandSha256: `sha256:${'3'.repeat(64)}`,
      requestSha256: `sha256:${'4'.repeat(64)}`,
    },
    status: 'success',
    metrics: { peakMemoryBytes: 1024, energyWh: null },
    metricUnavailableReason: { energyWh: 'not_reported_by_executor' },
    candidates: [
      {
        index: 1,
        durationSeconds: 180,
        wallTimeSeconds: 1,
        outputFile: 'cells/d180-b1/repetition-1/attempt-1/artifacts/candidate-1.wav',
      },
    ],
    error: null,
  };

  assert.equal(executorResultSchema.safeParse(result).success, true);
  for (const mutate of [
    (copy) => {
      copy.metricUnavailableReason.peakMemoryBytes = 'contradicts_value';
    },
    (copy) => {
      delete copy.metricUnavailableReason.energyWh;
    },
  ]) {
    const invalid = structuredClone(result);
    mutate(invalid);
    assert.equal(executorResultSchema.safeParse(invalid).success, false);
  }
});

test('sidecar allocation and interruption errors are internally coherent', () => {
  const failure = {
    schemaVersion: '1.0.0',
    identity: {
      runId: '1'.repeat(64),
      configurationSha256: `sha256:${'2'.repeat(64)}`,
      durationSeconds: 180,
      batchSizeRequested: 1,
      phase: 'warmup',
      index: 0,
      attempt: 1,
      commandSha256: `sha256:${'3'.repeat(64)}`,
      requestSha256: `sha256:${'4'.repeat(64)}`,
    },
    status: 'failure',
    metrics: { peakMemoryBytes: null, energyWh: null },
    metricUnavailableReason: {
      peakMemoryBytes: 'allocation_failure',
      energyWh: 'allocation_failure',
    },
    candidates: [],
    error: {
      code: 'allocation_failure',
      category: 'allocation',
      message: 'fixture OOM',
      retryable: false,
      allocationFailure: true,
      detailsSha256: null,
    },
  };

  assert.equal(executorResultSchema.safeParse(failure).success, true);
  for (const mutate of [
    (copy) => {
      copy.error.category = 'executor';
    },
    (copy) => {
      copy.error.allocationFailure = false;
    },
    (copy) => {
      copy.error.retryable = true;
    },
  ]) {
    const invalid = structuredClone(failure);
    mutate(invalid);
    assert.equal(executorResultSchema.safeParse(invalid).success, false);
  }
});
