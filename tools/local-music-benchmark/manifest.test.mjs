import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertManifestIntegrity,
  createDryRunManifest,
  serializeManifest,
  validateManifest,
} from './manifest.mjs';

const identity = {
  benchmarkId: 'fixture-no-model',
  host: {
    machine: 'fixture-mac',
    chip: null,
    memoryBytes: null,
    osVersion: null,
  },
  engine: {
    name: 'ace-step-1.5',
    repositoryPath: null,
    repoCommit: '14c0211d5a0653b0f63e27686f4c3f151b4d8629',
    clean: null,
  },
  model: {
    id: 'dry-run-no-model',
    revision: 'not-installed',
    weights: null,
    lm: {
      id: 'acestep-5Hz-lm-0.6B',
      revision: 'not-installed',
      weights: null,
    },
  },
  runtime: {
    device: 'mps',
    lmBackend: 'mlx',
    vaeChunk: null,
    harnessCommit: '473babf21658793629c1ce5f250b931b1072d802',
    harnessRepositoryPath: null,
    harnessClean: null,
    runDirectory: null,
    serverCommit: null,
  },
  toolchain: {
    git: null,
    node: null,
    python: null,
    uv: null,
    ffmpeg: null,
    ffprobe: null,
  },
  environment: [],
  environmentSha256: null,
};

const adapter = {
  kind: 'persistent-jsonl-v1',
  workingDirectory: null,
  executable: null,
  script: null,
  requestTimeoutSeconds: 900,
  terminateGraceSeconds: 5,
  maxOutputBytes: 1048576,
};

function makeManifest() {
  return createDryRunManifest({
    identity,
    adapter,
    cell: { durationSeconds: 180, batchSizeRequested: 2 },
    repetitions: 3,
  });
}

test('builds a deterministic, schema-valid dry-run manifest without fake effective pins', () => {
  const first = makeManifest();
  const second = makeManifest();
  const validation = validateManifest(first);

  assert.equal(validation.success, true, JSON.stringify(validation.error?.issues));
  assert.equal(serializeManifest(first), serializeManifest(second));
  assert.equal(first.warmup.commandReceipt.executed, false);
  assert.deepEqual(first.warmup.commandReceipt.command, [
    '$PINNED_PYTHON',
    '-P',
    '$PINNED_ADAPTER_SCRIPT',
    '--protocol',
    'lofiever-benchmark-jsonl-v1',
  ]);
  assert.equal(first.model.weights, null);
  assert.equal(first.model.lm.weights, null);
  assert.equal(first.toolchain.python, null);
  assert.equal(first.unavailableIdentity.modelWeights, 'dry_run');
  assert.equal(first.unavailableIdentity.harnessRepository, 'dry_run');
  assert.equal(first.unavailableIdentity.lmWeights, 'dry_run');
  assert.equal(first.unavailableIdentity.toolchain, 'dry_run');

  for (const record of [first.warmup, ...first.repetitions]) {
    assert.equal(record.attempt, 0);
    assert.equal(record.wallTimeSeconds, null);
    assert.equal(record.rtf, null);
    assert.equal(record.peakMemoryBytes, null);
    assert.equal(record.energyWh, null);
    assert.equal(record.batchSizeEffective, null);
    assert.deepEqual(record.candidates, []);
    assert.equal(record.error, null);
  }
});

test('rejects internally inconsistent summaries, indices, and command receipts', () => {
  const badSummary = makeManifest();
  badSummary.summary.completedRepetitions = 1;
  assert.equal(validateManifest(badSummary).success, false);

  const duplicateIndex = makeManifest();
  duplicateIndex.repetitions[1].index = 1;
  assert.equal(validateManifest(duplicateIndex).success, false);

  const changedCommand = makeManifest();
  changedCommand.repetitions[0].commandReceipt.command[0] = '/bin/sh';
  assert.equal(validateManifest(changedCommand).success, false);
});

test('rederives configuration, run, summary, and receipt hashes instead of trusting stored fields', () => {
  const manifest = makeManifest();
  assert.doesNotThrow(() => assertManifestIntegrity(manifest));

  for (const mutate of [
    (copy) => {
      copy.configurationSha256 = `sha256:${'0'.repeat(64)}`;
    },
    (copy) => {
      copy.runId = '0'.repeat(64);
    },
    (copy) => {
      copy.warmup.commandReceipt.commandSha256 = `sha256:${'0'.repeat(64)}`;
    },
  ]) {
    const tampered = structuredClone(manifest);
    mutate(tampered);
    assert.throws(() => assertManifestIntegrity(tampered), {
      code: 'manifest_integrity_failed',
    });
  }
});

test('keeps the finalized energy availability reason auditable but outside immutable configuration identity', () => {
  const manifest = makeManifest();
  const configurationSha256 = manifest.configurationSha256;
  const runId = manifest.runId;

  manifest.energyCollection.unavailableReason = 'recomputed_runtime_reason';

  assert.doesNotThrow(() => assertManifestIntegrity(manifest));
  assert.equal(manifest.configurationSha256, configurationSha256);
  assert.equal(manifest.runId, runId);
});
