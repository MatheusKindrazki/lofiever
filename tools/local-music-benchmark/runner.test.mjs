import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

async function canonicalTemp(templatePath) {
  return realpath(await mkdtemp(templatePath));
}

import { captureExecutableClosure } from './dynamic-linker.mjs';
import { acquireConfinedRunLock } from './confined-run-lock.mjs';
import { createConfinedOutputStore } from './confined-output-store.mjs';
import { digestPath } from './integrity.mjs';
import { MAX_ARTIFACT_BYTES } from './limits.mjs';
import {
  createDryRunManifest,
  createSidecarIdentity,
  deriveAttemptReceiptSha256,
  deriveConfiguration,
  deriveRequestIdentity,
  recordPaths,
  serializeManifest,
  sha256Receipt,
  validateManifest,
} from './manifest.mjs';
import {
  assertCheckpointIntegrity,
  inspectArtifact,
  readCheckpoint,
  runBenchmarkManifest as runBenchmarkManifestPublic,
} from './runner.mjs';
import { deriveSummary, spikeManifestSchema } from './schema.mjs';
import { acquireRunLock } from './storage.mjs';

const execFileAsync = promisify(execFile);

const pin = {
  path: '/fixture/pin',
  realpath: '/fixture/pin',
  sha256: `sha256:${'1'.repeat(64)}`,
};

const probeRoot = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-fake-ffprobe-'));
const fakeProbePath = path.join(probeRoot, 'ffprobe');
const probeContents = `#!/bin/sh
last=""
for value in "$@"; do last="$value"; done
[ "$last" = "pipe:0" ] || exit 91
[ -z "$LOFIEVER_FFPROBE_MARKER" ] || printf spawned > "$LOFIEVER_FFPROBE_MARKER"
temporary=$(/usr/bin/mktemp -t lofiever-ffprobe)
trap '/bin/rm -f "$temporary"' EXIT
/bin/cat > "$temporary"
set -- $(/usr/bin/od -An -tu4 -j24 -N20 "$temporary")
sample_rate="$1"
byte_rate="$2"
data_bytes="$5"
/usr/bin/awk -v data_bytes="$data_bytes" -v byte_rate="$byte_rate" -v sample_rate="$sample_rate" 'BEGIN { samples = data_bytes * sample_rate / byte_rate; printf "{\\"streams\\":[{\\"index\\":0,\\"codec_type\\":\\"audio\\",\\"sample_rate\\":\\"%d\\"}],\\"frames\\":[{\\"stream_index\\":0,\\"nb_samples\\":\\"%d\\"}],\\"format\\":{\\"duration\\":\\"%.6f\\"}}\\n", sample_rate, samples, data_bytes / byte_rate }'
`;
await writeFile(fakeProbePath, probeContents);
await chmod(fakeProbePath, 0o755);
const probePath = process.platform === 'darwin'
  ? (process.env.LOFIEVER_TEST_FFPROBE ?? '/opt/homebrew/bin/ffprobe')
  : fakeProbePath;
const probeBytes = await readFile(probePath);
const ffprobeExecutablePin = {
  path: probePath,
  realpath: await realpath(probePath),
  sha256: sha256Receipt(probeBytes),
  version: 'ffprobe fixture',
};
const ffprobeClosure = await captureExecutableClosure(ffprobeExecutablePin);
const ffprobePin = { ...ffprobeExecutablePin, dynamicLinker: ffprobeClosure };

let hostileProbePromise = null;
async function compiledTestProbe() {
  hostileProbePromise ??= (async () => {
    const root = await canonicalTemp(
      path.join(os.tmpdir(), 'lofiever-compiled-probe-'),
    );
    const sourcePath = path.join(root, 'probe.c');
    const executablePath = path.join(root, 'probe');
    await writeFile(sourcePath, `
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
int main(void) {
  const char *marker = getenv("LOFIEVER_FFPROBE_MARKER");
  if (marker != NULL) {
    int fd = open(marker, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd >= 0) { (void)write(fd, "spawned", 7); close(fd); }
  }
  char buffer[65536];
  if (getenv("LOFIEVER_SHORT_READ") != NULL) {
    (void)read(STDIN_FILENO, buffer, 44);
  } else {
    while (read(STDIN_FILENO, buffer, sizeof(buffer)) > 0) {}
  }
  (void)printf("{\\"streams\\":[{\\"index\\":0,\\"codec_type\\":\\"audio\\",\\"sample_rate\\":\\"48000\\"}],\\"frames\\":[{\\"stream_index\\":0,\\"nb_samples\\":\\"8832000\\"}],\\"format\\":{\\"duration\\":\\"184.000000\\"}}\\n");
  return 0;
}
`);
    await execFileAsync(process.platform === 'darwin' ? '/usr/bin/clang' : 'cc', [
      sourcePath,
      '-O2',
      '-o',
      executablePath,
    ]);
    const real = await realpath(executablePath);
    const base = {
      path: real,
      realpath: real,
      sha256: await digestPath(real),
      version: 'compiled fixture probe v1',
    };
    return { ...base, dynamicLinker: await captureExecutableClosure(base) };
  })();
  return hostileProbePromise;
}

function runBenchmarkManifest(options) {
  return runBenchmarkManifestPublic({ postCloseVerify: async () => {}, ...options });
}

function fixtureClosure(fixturePin) {
  const darwinMachO = ffprobeClosure.platform === 'darwin';
  const root = {
    ...fixturePin,
    device: '1',
    inode: '1',
  };
  const payload = {
    schemaVersion: 'macho-closure-v1',
    format: darwinMachO ? 'mach-o' : 'not-mach-o',
    platform: ffprobeClosure.platform,
    architecture: ffprobeClosure.architecture,
    osBuild: ffprobeClosure.osBuild,
    root,
    images: darwinMachO
      ? [{
        ...root,
        sliceArchitecture: ffprobeClosure.images[0].sliceArchitecture,
        rpaths: [],
        dependencies: [],
      }]
      : [],
    systemLoadPaths: [],
  };
  return {
    ...payload,
    closureSha256: sha256Receipt(serializeManifest(payload)),
  };
}

function wavFixture(candidateIndex, durationSeconds = 180) {
  const sampleRate = 8;
  const samples = Math.round(sampleRate * durationSeconds);
  const dataBytes = samples * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(dataBytes, 40);
  for (let offset = 44; offset < bytes.length; offset += 2) {
    bytes.writeInt16LE(candidateIndex, offset);
  }
  return bytes;
}

function wav24StereoFixture(durationSeconds = 184) {
  const sampleRate = 48_000;
  const blockAlign = 6;
  const dataBytes = durationSeconds * sampleRate * blockAlign;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * blockAlign, 28);
  bytes.writeUInt16LE(blockAlign, 32);
  bytes.writeUInt16LE(24, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}

function plannedManifest({
  batchSizeRequested = 2,
  energySource = 'executor',
  ffprobe = ffprobePin,
} = {}) {
  const environment = [];
  return createDryRunManifest({
    identity: {
      benchmarkId: 'fixture-runner',
      host: {
        machine: 'fixture-mac',
        chip: 'fixture-chip',
        memoryBytes: 1024,
        osVersion: 'fixture-os (fixture-build)',
      },
      engine: {
        name: 'ace-step-1.5',
        repositoryPath: '/fixture/engine',
        repoCommit: '14c0211d5a0653b0f63e27686f4c3f151b4d8629',
        clean: true,
      },
      model: {
        id: 'fixture-model',
        revision: '1'.repeat(40),
        weights: pin,
        lm: { id: 'fixture-lm', revision: '2'.repeat(40), weights: pin },
      },
      runtime: {
        device: 'mps',
        lmBackend: 'mlx',
        vaeChunk: 8,
        harnessCommit: '473babf21658793629c1ce5f250b931b1072d802',
        harnessRepositoryPath: '/fixture/harness',
        harnessClean: true,
        runDirectory: '/fixture/run',
        runDirectoryIdentity: {
          realpath: '/fixture/run',
          device: '1',
          inode: '2',
          parent: { realpath: '/fixture', device: '1', inode: '1' },
        },
        serverCommit: null,
      },
      toolchain: {
        git: { ...pin, version: 'git fixture' },
        node: { ...pin, version: 'Node fixture' },
        python: { ...pin, version: 'Python fixture' },
        uv: {
          ...pin,
          version: 'uv fixture',
          dynamicLinker: fixtureClosure(pin),
        },
        ffmpeg: { ...pin, version: 'ffmpeg fixture' },
        ffprobe,
      },
      environment,
      environmentSha256: sha256Receipt(serializeManifest(environment)),
    },
    adapter: {
      kind: 'persistent-jsonl-v1',
      workingDirectory: '/fixture/engine',
      executable: pin,
      script: pin,
      dynamicLinker: fixtureClosure(pin),
      requestTimeoutSeconds: 60,
      terminateGraceSeconds: 1,
      maxOutputBytes: 1024 * 1024,
    },
    cell: { durationSeconds: 180, batchSizeRequested },
    repetitions: 3,
    energyCollection: { source: energySource },
    executionMode: 'execute',
  });
}

function makeExecutor(handler) {
  const calls = [];
  let closeCount = 0;
  let cleanupGuard = null;
  return {
    calls,
    get closeCount() {
      return closeCount;
    },
    registerCleanupGuard(guard) {
      assert.equal(cleanupGuard, null);
      cleanupGuard = guard;
    },
    async execute(context) {
      calls.push(`${context.record.phase}:${context.record.index}:${context.record.attempt}`);
      return handler(context);
    },
    async close() {
      closeCount += 1;
    },
  };
}

test('requires a post-close provenance verifier at the public runner boundary', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-verifier-'));
  const executor = makeExecutor(() => assert.fail('executor must not start'));
  await assert.rejects(
    runBenchmarkManifestPublic({
      plannedManifest: plannedManifest({ batchSizeRequested: 1 }),
      manifestPath: path.join(outputDirectory, 'manifest.json'),
      outputDirectory,
      executor,
    }),
    { code: 'post_close_verifier_required' },
  );
  assert.deepEqual(executor.calls, []);
});

test('execute and resume refuse a manifests symlink before any executor workload', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-manifest-symlink-'));
  const outputDirectory = path.join(root, 'output');
  const outsideDirectory = path.join(root, 'outside');
  const outsideSentinel = path.join(outsideDirectory, 'sentinel.txt');
  await mkdir(outputDirectory, { mode: 0o700 });
  await mkdir(outsideDirectory, { mode: 0o700 });
  await writeFile(outsideSentinel, 'outside sentinel\n');
  await symlink(outsideDirectory, path.join(outputDirectory, 'manifests'));
  const executor = makeExecutor(() => assert.fail('executor must not start'));

  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: plannedManifest({ batchSizeRequested: 1 }),
      manifestPath: path.join(outputDirectory, 'manifests', 'd180-b1.json'),
      outputDirectory,
      executor,
    }),
    (error) => {
      assert.match(error.code, /confined|manifest_store/u);
      return true;
    },
  );
  assert.deepEqual(executor.calls, []);
  assert.equal(await readFile(outsideSentinel, 'utf8'), 'outside sentinel\n');
  assert.deepEqual(await readdir(outsideDirectory), ['sentinel.txt']);
});

test('checkpoint CAS never overwrites a manifest replaced after resume observation', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-checkpoint-cas-'));
  const manifestRelativePath = 'manifests/d180-b1.json';
  const manifestPath = path.join(outputDirectory, manifestRelativePath);
  const plan = plannedManifest({ batchSizeRequested: 1 });
  await mkdir(path.dirname(manifestPath), { mode: 0o700 });
  await writeFile(manifestPath, serializeManifest(plan), { mode: 0o600 });
  const hostileBytes = Buffer.from('hostile replacement must survive\n');
  let manifestReads = 0;
  let replaced = false;
  const outputStore = await createConfinedOutputStore(outputDirectory, {
    lifecycleObserver: async (event) => {
      if (event.type !== 'read-complete' || event.path !== manifestRelativePath) return;
      manifestReads += 1;
      if (manifestReads === 2) {
        await writeFile(manifestPath, hostileBytes);
        replaced = true;
      }
    },
  });
  const runLock = await acquireConfinedRunLock(outputStore);
  const executor = makeExecutor(() => {
    throw new Error('executor must not start after checkpoint replacement');
  });
  try {
    await assert.rejects(
      runBenchmarkManifest({
        plannedManifest: plan,
        manifestPath,
        outputDirectory,
        outputStore,
        runLock,
        executor,
      }),
      { code: 'benchmark_lock_identity_changed' },
    );
    assert.equal(replaced, true);
    assert.deepEqual(executor.calls, []);
    assert.deepEqual(await readFile(manifestPath), hostileBytes);
  } finally {
    outputStore.bindTerminalRelease(await runLock.prepareTerminalRelease());
    await outputStore.close();
  }
});

test('pre-run checkpoint failures close the owned helper and session lock promptly', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-preflight-close-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  await writeFile(manifestPath, 'not a benchmark manifest\n', { mode: 0o600 });
  const beforeDescriptors = (await readdir('/dev/fd')).length;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const executor = makeExecutor(() => assert.fail('executor must not start'));
    const startedAt = Date.now();
    await assert.rejects(
      runBenchmarkManifest({
        plannedManifest: plannedManifest({ batchSizeRequested: 1 }),
        manifestPath,
        outputDirectory,
        executor,
      }),
      { code: 'checkpoint_integrity_failed' },
    );
    assert.ok(Date.now() - startedAt < 5_000, 'pre-run failure must close promptly');
    assert.deepEqual(executor.calls, []);
    await assert.rejects(stat(path.join(outputDirectory, 'benchmark-run.lock')), {
      code: 'ENOENT',
    });
  }

  assert.equal((await readdir('/dev/fd')).length, beforeDescriptors);
});

async function successResult({
  manifest,
  outputDirectory,
  record,
  batchSizeEffective = manifest.factors.batchSizeRequested,
  measuredDurationSeconds = manifest.factors.durationSeconds,
  adapterDeclaredDurationSeconds = manifest.factors.durationSeconds,
}) {
  const paths = recordPaths({
    cell: {
      durationSeconds: manifest.factors.durationSeconds,
      batchSizeRequested: manifest.factors.batchSizeRequested,
    },
    phase: record.phase,
    index: record.index,
    attempt: record.attempt,
  });
  const candidates = [];
  for (let index = 1; index <= batchSizeEffective; index += 1) {
    const relativePath = `${paths.artifactDirectory}/candidate-${index}.wav`;
    const absolutePath = path.join(outputDirectory, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, wavFixture(index, measuredDurationSeconds));
    candidates.push({
      index,
      durationSeconds: adapterDeclaredDurationSeconds,
      wallTimeSeconds: 0.5 * index,
      outputFile: relativePath,
    });
  }
  const sidecarPath = path.join(outputDirectory, paths.consumedResultJsonPath);
  await mkdir(path.dirname(sidecarPath), { recursive: true });
  const sidecarBytes = Buffer.from(
    serializeManifest({
      schemaVersion: '1.0.0',
      identity: createSidecarIdentity(manifest, record),
      status: 'success',
      metrics: { peakMemoryBytes: 1024, energyWh: 0.25 },
      metricUnavailableReason: {},
      candidates,
      error: null,
    }),
  );
  await writeFile(sidecarPath, sidecarBytes);
  const sidecarStats = await stat(sidecarPath);
  return {
    status: 'success',
    startedAt: '2026-08-24T10:00:00.000Z',
    finishedAt: '2026-08-24T10:06:00.000Z',
    exitCode: null,
    signal: null,
    stdout: Buffer.from('fixture stdout'),
    stderr: Buffer.alloc(0),
    wallTimeSeconds: 360,
    metrics: { peakMemoryBytes: 1024, energyWh: 0.25 },
    metricUnavailableReason: {},
    candidates,
    sidecar: {
      relativePath: paths.consumedResultJsonPath,
      sha256: sha256Receipt(sidecarBytes),
      bytes: sidecarBytes.length,
      device: String(sidecarStats.dev),
      inode: String(sidecarStats.ino),
    },
    error: null,
  };
}

test('pre-arms the output cleanup guard before any executor workload', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-cleanup-guard-'));
  const sentinelPath = path.join(
    outputDirectory,
    'benchmark-run.lock.cleanup-unproven',
  );
  const executor = makeExecutor(async (context) => {
    const guard = JSON.parse(await readFile(sentinelPath, 'utf8'));
    assert.equal(guard.state, 'cleanup-pending');
    assert.equal(guard.processGroupId, null);
    return successResult({ ...context, outputDirectory });
  });
  const result = await runBenchmarkManifest({
    plannedManifest: plannedManifest({ batchSizeRequested: 1 }),
    manifestPath: path.join(outputDirectory, 'manifest.json'),
    outputDirectory,
    executor,
  });
  assert.equal(result.state, 'completed');
  await assert.rejects(readFile(sentinelPath), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(outputDirectory, 'benchmark-run.lock')), {
    code: 'ENOENT',
  });
});

test('rejects a forged ffprobe closure before any artifact probe spawn', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-ffprobe-closure-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const marker = path.join(outputDirectory, 'ffprobe-spawned');
  const forgedClosure = structuredClone(ffprobeClosure);
  forgedClosure.closureSha256 = `sha256:${'0'.repeat(64)}`;
  const planned = plannedManifest({
    ffprobe: { ...ffprobePin, dynamicLinker: forgedClosure },
  });
  const executor = makeExecutor((context) =>
    successResult({ ...context, outputDirectory }),
  );

  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor,
      processEnvironment: { LOFIEVER_FFPROBE_MARKER: marker },
    }),
    { code: 'manifest_integrity_failed' },
  );
  assert.deepEqual(executor.calls, []);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

test(
  'rejects a non-Mach-O ffprobe wrapper before the public runner can spawn it',
  { skip: process.platform !== 'darwin' },
  async () => {
    const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-ffprobe-wrapper-'));
    const manifestPath = path.join(outputDirectory, 'manifest.json');
    const marker = path.join(outputDirectory, 'ffprobe-spawned');
    const wrapperPath = path.join(outputDirectory, 'ffprobe');
    await writeFile(
      wrapperPath,
      `#!/bin/sh\nprintf spawned > ${JSON.stringify(marker)}\nprintf '{"format":{"duration":"0.250000"}}\\n'\n`,
    );
    await chmod(wrapperPath, 0o700);
    const wrapperBytes = await readFile(wrapperPath);
    const wrapperPin = {
      path: wrapperPath,
      realpath: await realpath(wrapperPath),
      sha256: sha256Receipt(wrapperBytes),
      version: 'hostile wrapper',
    };
    wrapperPin.dynamicLinker = await captureExecutableClosure(wrapperPin);
    const planned = plannedManifest();
    planned.toolchain.ffprobe = wrapperPin;
    planned.configurationSha256 = sha256Receipt(
      serializeManifest(deriveConfiguration(planned)),
    );
    planned.runId = createHash('sha256')
      .update(planned.configurationSha256)
      .digest('hex');
    const executor = makeExecutor((context) =>
      successResult({ ...context, outputDirectory }),
    );

    await assert.rejects(
      runBenchmarkManifest({
        plannedManifest: planned,
        manifestPath,
        outputDirectory,
        executor,
      }),
      { code: 'manifest_integrity_failed' },
    );
    assert.deepEqual(executor.calls, []);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  },
);

test('artifact Buffer pipeline supports the RFC WAV bound and rejects oversized input pre-probe', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-artifact-bound-'));
  const artifacts = path.join(root, 'cells', 'd184-b1', 'warmup-0', 'attempt-1', 'artifacts');
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const relativePath = 'cells/d184-b1/warmup-0/attempt-1/artifacts/candidate-1.wav';
  const largeWav = wav24StereoFixture(184);
  assert.ok(largeWav.length > 32 * 1024 * 1024);
  assert.ok(largeWav.length <= MAX_ARTIFACT_BYTES);
  await writeFile(path.join(root, relativePath), largeWav);
  const store = await createConfinedOutputStore(root);
  try {
    const inspected = await inspectArtifact(store.storageRoot, relativePath, {
      ffprobe: ffprobePin,
      outputStore: store,
    });
    assert.equal(inspected.bytes, largeWav.length);
    assert.equal(inspected.durationSeconds, 184);
    assert.equal(inspected.sha256, sha256Receipt(largeWav));
  } finally {
    await store.close();
  }

  const oversizedRoot = await canonicalTemp(
    path.join(os.tmpdir(), 'lofiever-artifact-oversized-'),
  );
  const oversizedRelative = 'cells/d184-b1/warmup-0/attempt-1/artifacts/oversized.wav';
  const oversizedPath = path.join(oversizedRoot, oversizedRelative);
  await mkdir(path.dirname(oversizedPath), { recursive: true, mode: 0o700 });
  const oversizedHandle = await open(oversizedPath, 'w', 0o600);
  await oversizedHandle.truncate(MAX_ARTIFACT_BYTES + 1);
  await oversizedHandle.close();
  const marker = path.join(oversizedRoot, 'probe-spawned');
  const oversizedStore = await createConfinedOutputStore(oversizedRoot);
  try {
    await assert.rejects(
      inspectArtifact(oversizedStore.storageRoot, oversizedRelative, {
        ffprobe: await compiledTestProbe(),
        outputStore: oversizedStore,
        processEnvironment: { LOFIEVER_FFPROBE_MARKER: marker },
      }),
      (error) => {
        assert.match(error.code, /manifest_store|confined/u);
        return true;
      },
    );
    await assert.rejects(stat(marker), { code: 'ENOENT' });
  } finally {
    await oversizedStore.close().catch(() => {});
  }
});

test('artifact probing rejects a short reader and post-snapshot mutations', async (t) => {
  await t.test('ffprobe must accept the entire Buffer before exit zero', async () => {
    const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-probe-short-read-'));
    const relativePath = 'cells/d184-b1/warmup-0/attempt-1/artifacts/candidate-1.wav';
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
    await writeFile(absolutePath, Buffer.alloc(4 * 1024 * 1024, 1));
    const marker = path.join(root, 'probe-spawned');
    const store = await createConfinedOutputStore(root);
    try {
      await assert.rejects(
        inspectArtifact(store.storageRoot, relativePath, {
          ffprobe: await compiledTestProbe(),
          outputStore: store,
          processEnvironment: {
            LOFIEVER_FFPROBE_MARKER: marker,
            LOFIEVER_SHORT_READ: '1',
          },
        }),
        /complete bounded candidate snapshot/u,
      );
      assert.equal(await readFile(marker, 'utf8'), 'spawned');
    } finally {
      await store.close();
    }
  });

  for (const mode of ['directory-swap', 'same-inode-rewrite']) {
    await t.test(mode, async () => {
      const root = await canonicalTemp(path.join(os.tmpdir(), `lofiever-artifact-${mode}-`));
      const relativePath = 'cells/d184-b1/warmup-0/attempt-1/artifacts/candidate-1.wav';
      const absolutePath = path.join(root, relativePath);
      const artifactDirectory = path.dirname(absolutePath);
      const originalBytes = wavFixture(1, 184);
      await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
      await writeFile(absolutePath, originalBytes);
      const marker = path.join(root, 'probe-spawned');
      const outside = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-artifact-outside-'));
      const outsideSentinel = path.join(outside, 'sentinel.txt');
      await writeFile(outsideSentinel, 'outside sentinel\n');
      let reads = 0;
      let swapped = false;
      let mutationTriggered = false;
      const movedDirectory = `${artifactDirectory}-original`;
      const store = await createConfinedOutputStore(root, {
        lifecycleObserver: async (event) => {
          if (event.type !== 'read-complete' || event.path !== relativePath) return;
          reads += 1;
          if (mode === 'directory-swap' && reads === 2) {
            await rename(artifactDirectory, movedDirectory);
            await symlink(outside, artifactDirectory);
            swapped = true;
            mutationTriggered = true;
          } else if (mode === 'same-inode-rewrite' && reads === 3) {
            const before = await stat(absolutePath);
            const changed = Buffer.from(originalBytes);
            changed[changed.length - 1] ^= 0xff;
            await writeFile(absolutePath, changed);
            assert.equal((await stat(absolutePath)).ino, before.ino);
            mutationTriggered = true;
          }
        },
      });
      try {
        await assert.rejects(
          inspectArtifact(store.storageRoot, relativePath, {
            ffprobe: await compiledTestProbe(),
            outputStore: store,
            processEnvironment: { LOFIEVER_FFPROBE_MARKER: marker },
          }),
        );
        assert.equal(mutationTriggered, true);
        assert.ok(reads >= (mode === 'directory-swap' ? 2 : 3));
        assert.equal(await readFile(marker, 'utf8'), 'spawned');
        assert.equal(await readFile(outsideSentinel, 'utf8'), 'outside sentinel\n');
        assert.deepEqual(await readdir(outside), ['sentinel.txt']);
      } finally {
        if (swapped) {
          await unlink(artifactDirectory);
          await rename(movedDirectory, artifactDirectory);
        }
        await store.close().catch(() => {});
      }
    });
  }
});

test('missing artifact parents are read-only and never spawn ffprobe', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-artifact-missing-'));
  const marker = path.join(root, 'probe-spawned');
  const before = await readdir(root);
  const store = await createConfinedOutputStore(root);
  try {
    await assert.rejects(
      inspectArtifact(
        store.storageRoot,
        'cells/d184-b1/warmup-0/attempt-1/artifacts/missing.wav',
        {
          ffprobe: await compiledTestProbe(),
          outputStore: store,
          processEnvironment: { LOFIEVER_FFPROBE_MARKER: marker },
        },
      ),
    );
    assert.deepEqual(await readdir(root), before);
    await assert.rejects(stat(marker), { code: 'ENOENT' });
  } finally {
    await store.close().catch(() => {});
  }
});

test('rejects dynamic-loader environment injection before the public runner uses its executor', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-env-'));
  const executor = makeExecutor((context) =>
    successResult({ ...context, outputDirectory }),
  );
  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: plannedManifest(),
      manifestPath: path.join(outputDirectory, 'manifest.json'),
      outputDirectory,
      executor,
      processEnvironment: { DYLD_LIBRARY_PATH: '/tmp/evil' },
    }),
    { code: 'unsafe_process_environment' },
  );
  assert.deepEqual(executor.calls, []);
});

test('execute manifests require adapter, uv, and ffprobe closure receipts', () => {
  for (const removeClosure of [
    (manifest) => {
      manifest.factors.durationSeconds = 0.25;
    },
    (manifest) => {
      manifest.factors.batchSizeRequested = 3;
    },
    (manifest) => {
      manifest.runtime.device = 'cpu';
    },
    (manifest) => {
      manifest.runtime.lmBackend = 'torch';
    },
    (manifest) => {
      manifest.engine.repoCommit = 'f'.repeat(40);
    },
    (manifest) => {
      manifest.host.chip = null;
    },
    (manifest) => {
      manifest.runtime.vaeChunk = null;
    },
    (manifest) => {
      manifest.energyCollection.requested = false;
    },
    (manifest) => {
      manifest.unavailableIdentity.adapter = 'forged_unavailable';
    },
    (manifest) => {
      manifest.adapter.dynamicLinker = null;
    },
    (manifest) => {
      delete manifest.toolchain.uv.dynamicLinker;
    },
    (manifest) => {
      delete manifest.toolchain.ffprobe.dynamicLinker;
    },
  ]) {
    const manifest = plannedManifest();
    removeClosure(manifest);
    assert.equal(spikeManifestSchema.safeParse(manifest).success, false);
  }
  const nonMachO = plannedManifest();
  nonMachO.adapter.dynamicLinker = {
    ...nonMachO.adapter.dynamicLinker,
    format: 'not-mach-o',
    images: [],
  };
  assert.equal(spikeManifestSchema.safeParse(nonMachO).success, false);
});

test('records actual candidate durations/artifacts and computes RTF from their total duration', async (t) => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  const executor = makeExecutor((context) =>
    successResult({ ...context, outputDirectory }),
  );
  let postCloseChecks = 0;

  const completed = await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor,
    postCloseVerify: async () => {
      postCloseChecks += 1;
    },
  });

  assert.deepEqual(executor.calls, [
    'warmup:0:1',
    'repetition:1:1',
    'repetition:2:1',
    'repetition:3:1',
  ]);
  assert.equal(executor.closeCount, 1);
  assert.equal(postCloseChecks, 1);
  assert.equal(completed.state, 'completed');
  assert.equal(completed.summary.completedRepetitions, 3);
  assert.equal(completed.summary.energyWhTotal, 0.75);
  assert.equal(completed.energyCollection.unavailableReason, null);
  for (const record of [completed.warmup, ...completed.repetitions]) {
    assert.equal(record.batchSizeEffective, 2);
    assert.equal(record.candidates.length, 2);
    assert.equal(record.audioDurationSeconds, 360);
    assert.equal(record.rtf, 1);
    assert.deepEqual(
      record.candidates.map((candidate) => candidate.adapterDeclaredDurationSeconds),
      [180, 180],
    );
    assert.match(record.candidates[0].artifact.sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(record.commandReceipt.executed, true);
    assert.notEqual(record.commandReceipt.sidecar, null);
    assert.match(
      record.commandReceipt.attemptReceiptSha256,
      /^sha256:[a-f0-9]{64}$/,
    );
  }
  assert.equal(validateManifest(completed).success, true);
  assert.deepEqual(await readCheckpoint(manifestPath, { outputDirectory }), completed);

  const terminalBytes = await readFile(manifestPath);
  for (const [label, relativePath] of [
    ['artifact', completed.warmup.candidates[0].artifact.relativePath],
    ['sidecar', completed.warmup.commandReceipt.sidecar.relativePath],
  ]) {
    await t.test(`resume rejects a terminal checkpoint with a missing ${label}`, async () => {
      const absolutePath = path.join(outputDirectory, relativePath);
      const heldPath = `${absolutePath}.held-missing`;
      await rename(absolutePath, heldPath);
      const forbiddenExecutor = makeExecutor(() => assert.fail('resume must not spawn'));
      try {
        await assert.rejects(
          runBenchmarkManifest({
            plannedManifest: planned,
            manifestPath,
            outputDirectory,
            executor: forbiddenExecutor,
          }),
          { code: 'checkpoint_integrity_failed' },
        );
        assert.deepEqual(forbiddenExecutor.calls, []);
        assert.deepEqual(await readFile(manifestPath), terminalBytes);
      } finally {
        await rename(heldPath, absolutePath);
      }
    });
  }
});

test('rejects a candidate whose ffprobe duration is truncated far below the requested cell', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-truncated-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const executor = makeExecutor((context) =>
    successResult({
      ...context,
      outputDirectory,
      measuredDurationSeconds: 0.25,
      adapterDeclaredDurationSeconds: 180,
    }),
  );

  const result = await runBenchmarkManifest({
    plannedManifest: plannedManifest({ batchSizeRequested: 1 }),
    manifestPath,
    outputDirectory,
    executor,
  });

  assert.equal(result.state, 'completed_with_errors');
  assert.equal(result.warmup.status, 'failed');
  assert.equal(result.warmup.error.code, 'invalid_generation_result');
  assert.match(result.warmup.error.message, /duration/u);
  assert.deepEqual(executor.calls, ['warmup:0:1']);
});

test('rejects transitive duration drift outside the requested cell boundary', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-duration-triangle-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const executor = makeExecutor((context) =>
    successResult({
      ...context,
      outputDirectory,
      measuredDurationSeconds: 181,
      adapterDeclaredDurationSeconds: 182,
    }),
  );

  const result = await runBenchmarkManifest({
    plannedManifest: plannedManifest({ batchSizeRequested: 1 }),
    manifestPath,
    outputDirectory,
    executor,
  });

  assert.equal(result.state, 'completed_with_errors');
  assert.equal(result.warmup.status, 'failed');
  assert.equal(result.warmup.error.code, 'invalid_generation_result');
  assert.match(result.warmup.error.message, /duration/u);
  assert.deepEqual(executor.calls, ['warmup:0:1']);
});

test('does not checkpoint a terminal receipt before executor close validates the last response', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-close-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  const executor = makeExecutor((context) =>
    successResult({ ...context, outputDirectory }),
  );
  executor.close = async () => {
    const error = new Error(
      'Persistent adapter emitted trailing output before shutdown.',
    );
    error.code = 'unexpected_adapter_output';
    throw error;
  };

  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor,
    }),
    { code: 'unexpected_adapter_output' },
  );
  const checkpoint = await readCheckpoint(manifestPath, {
    outputDirectory,
    plannedManifest: planned,
  });
  assert.equal(checkpoint.state, 'running');
  assert.equal(checkpoint.repetitions.at(-1).status, 'running');
  const nextLock = await acquireRunLock(path.join(outputDirectory, 'benchmark-run'));
  await nextLock.release();
});

test('revalidates artifact and sidecar receipts after close before a terminal checkpoint', async (t) => {
  for (const mutation of ['artifact', 'sidecar']) {
    await t.test(mutation, async () => {
      const outputDirectory = await canonicalTemp(
        path.join(os.tmpdir(), `lofiever-runner-post-close-${mutation}-`),
      );
      const manifestPath = path.join(outputDirectory, 'manifest.json');
      const planned = plannedManifest({ batchSizeRequested: 1 });
      let lastResult = null;
      const executor = makeExecutor(async (context) => {
        lastResult = await successResult({ ...context, outputDirectory });
        return lastResult;
      });
      executor.close = async () => {
        const relativePath = mutation === 'artifact'
          ? lastResult.candidates[0].outputFile
          : lastResult.sidecar.relativePath;
        await writeFile(path.join(outputDirectory, relativePath), 'mutated-after-close');
      };

      await assert.rejects(
        runBenchmarkManifest({
          plannedManifest: planned,
          manifestPath,
          outputDirectory,
          executor,
        }),
        { code: 'checkpoint_integrity_failed' },
      );
      const checkpoint = await readCheckpoint(manifestPath);
      assert.equal(checkpoint.state, 'running');
      assert.equal(checkpoint.repetitions.at(-1).status, 'running');
      const nextLock = await acquireRunLock(path.join(outputDirectory, 'benchmark-run'));
      await nextLock.release();
    });
  }
});

test('rejects post-close provenance drift and preserves the last non-terminal checkpoint', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-provenance-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest({ batchSizeRequested: 1 });
  const executor = makeExecutor((context) =>
    successResult({ ...context, outputDirectory }),
  );
  let verifierCalls = 0;

  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor,
      postCloseVerify: async () => {
        verifierCalls += 1;
        assert.equal(executor.closeCount, 1);
        const error = new Error('Pinned model weights changed after adapter shutdown.');
        error.code = 'pin_mismatch';
        throw error;
      },
    }),
    { code: 'pin_mismatch' },
  );
  assert.equal(verifierCalls, 1);
  const checkpoint = await readCheckpoint(manifestPath);
  assert.equal(checkpoint.state, 'running');
  assert.equal(checkpoint.repetitions.at(-1).status, 'running');
});

test('fatal preflight revalidates earlier evidence after close before checkpointing terminal', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-fatal-close-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest({ batchSizeRequested: 1 });
  let warmupResult = null;
  const executor = makeExecutor(async (context) => {
    if (context.record.phase === 'warmup') {
      warmupResult = await successResult({ ...context, outputDirectory });
      return warmupResult;
    }
    return {
      status: 'failure',
      fatalPreflight: true,
      startedAt: '2026-08-24T10:00:00.000Z',
      finishedAt: '2026-08-24T10:00:01.000Z',
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
      error: {
        code: 'harness_worktree_dirty',
        category: 'executor',
        message: 'Fixture fatal preflight.',
        retryable: false,
        allocationFailure: false,
        detailsSha256: null,
      },
    };
  });
  executor.close = async () => {
    await writeFile(
      path.join(outputDirectory, warmupResult.candidates[0].outputFile),
      'mutated-during-fatal-close',
    );
  };

  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor,
    }),
    { code: 'checkpoint_integrity_failed' },
  );
  const checkpoint = await readCheckpoint(manifestPath);
  assert.equal(checkpoint.state, 'running');
  assert.equal(checkpoint.repetitions[0].status, 'running');
});

test('fatal preflight runs final provenance after evidence and preserves a non-terminal checkpoint on drift', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-fatal-pin-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest({ batchSizeRequested: 1 });
  const executor = makeExecutor(async () => ({
    status: 'failure',
    fatalPreflight: true,
    startedAt: '2026-08-24T10:00:00.000Z',
    finishedAt: '2026-08-24T10:00:01.000Z',
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
    error: {
      code: 'harness_worktree_dirty',
      category: 'executor',
      message: 'Fixture fatal preflight.',
      retryable: false,
      allocationFailure: false,
      detailsSha256: null,
    },
  }));
  let postCloseChecks = 0;

  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor,
      postCloseVerify: async () => {
        postCloseChecks += 1;
        const error = new Error('Host changed after fatal preflight shutdown.');
        error.code = 'host_identity_mismatch';
        throw error;
      },
    }),
    { code: 'host_identity_mismatch' },
  );
  assert.equal(postCloseChecks, 1);
  const checkpoint = await readCheckpoint(manifestPath);
  assert.equal(checkpoint.state, 'running');
  assert.equal(checkpoint.warmup.status, 'running');
});

test('does not checkpoint terminal errors before executor close validates the last response', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-close-error-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest({ batchSizeRequested: 4 });
  const executor = makeExecutor((context) => {
    if (context.record.phase === 'repetition') {
      return {
        status: 'failure',
        startedAt: '2026-08-24T10:00:00.000Z',
        finishedAt: '2026-08-24T10:00:01.000Z',
        exitCode: null,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        wallTimeSeconds: 1,
        metrics: { peakMemoryBytes: null, energyWh: null },
        metricUnavailableReason: {
          peakMemoryBytes: 'allocation_failure',
          energyWh: 'allocation_failure',
        },
        candidates: [],
        sidecar: null,
        error: {
          code: 'allocation_failure',
          category: 'allocation',
          message: 'Fixture allocation failure.',
          retryable: false,
          allocationFailure: true,
          detailsSha256: null,
        },
      };
    }
    return successResult({ ...context, outputDirectory });
  });
  executor.close = async () => {
    const error = new Error(
      'Persistent adapter emitted trailing output before shutdown.',
    );
    error.code = 'unexpected_adapter_output';
    error.cleanupUnproven = true;
    throw error;
  };

  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor,
    }),
    { code: 'unexpected_adapter_output' },
  );
  const checkpoint = await readCheckpoint(manifestPath, {
    outputDirectory,
    plannedManifest: planned,
  });
  assert.equal(checkpoint.state, 'running');
  assert.equal(checkpoint.repetitions[0].status, 'running');
  assert.equal(
    checkpoint.repetitions.slice(1).every((record) => record.status === 'planned'),
    true,
  );
  const lockTarget = path.join(outputDirectory, 'benchmark-run');
  try {
    await assert.rejects(acquireRunLock(lockTarget), {
      code: 'benchmark_lock_cleanup_unproven',
    });
  } finally {
    await unlink(`${lockTarget}.lock`).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
});

test('retains cleanup sentinel when final close fails after an interrupted attempt', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-runner-interrupted-close-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  const executor = makeExecutor(() => ({
    status: 'failure',
    startedAt: '2026-08-24T10:00:00.000Z',
    finishedAt: '2026-08-24T10:00:01.000Z',
    exitCode: null,
    signal: 'SIGINT',
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    wallTimeSeconds: 1,
    metrics: { peakMemoryBytes: null, energyWh: null },
    metricUnavailableReason: {
      peakMemoryBytes: 'interrupted',
      energyWh: 'interrupted',
    },
    candidates: [],
    sidecar: null,
    error: {
      code: 'execution_interrupted',
      category: 'interrupted',
      message: 'Fixture interruption.',
      retryable: true,
      allocationFailure: false,
      detailsSha256: null,
    },
  }));
  executor.close = async () => {
    const error = new Error('Persistent adapter process group remained alive.');
    error.code = 'executor_process_group_alive';
    error.cleanupUnproven = true;
    error.details = { processGroupId: 4242, priorErrorCode: null };
    throw error;
  };

  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor,
    }),
    { code: 'executor_process_group_alive' },
  );
  const checkpoint = await readCheckpoint(manifestPath, {
    outputDirectory,
    plannedManifest: planned,
  });
  assert.equal(checkpoint.state, 'interrupted');
  assert.equal(checkpoint.warmup.status, 'interrupted');
  const lockTarget = path.join(outputDirectory, 'benchmark-run');
  try {
    await assert.rejects(acquireRunLock(lockTarget), {
      code: 'benchmark_lock_cleanup_unproven',
    });
  } finally {
    await unlink(`${lockTarget}.lock.cleanup-unproven`).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await unlink(`${lockTarget}.lock`).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
});

test('finalizes unavailable energy reasons without leaving not_reported_yet', async () => {
  for (const [energySource, expectedReason] of [
    ['executor', 'not_available_for_all_completed_repetitions'],
    ['none', 'not_requested'],
  ]) {
    const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), `lofiever-energy-${energySource}-`));
    const manifestPath = path.join(outputDirectory, 'manifest.json');
    const planned = plannedManifest({ energySource });
    const executor = makeExecutor(async (context) => {
      const result = await successResult({ ...context, outputDirectory });
      result.metrics.energyWh = null;
      result.metricUnavailableReason.energyWh =
        energySource === 'none' ? 'not_requested' : 'fixture_unavailable';
      const sidecarPath = path.join(outputDirectory, result.sidecar.relativePath);
      const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
      sidecar.metrics.energyWh = null;
      sidecar.metricUnavailableReason.energyWh = result.metricUnavailableReason.energyWh;
      const bytes = Buffer.from(serializeManifest(sidecar));
      await writeFile(sidecarPath, bytes);
      const stats = await stat(sidecarPath);
      result.sidecar = {
        relativePath: result.sidecar.relativePath,
        sha256: sha256Receipt(bytes),
        bytes: bytes.length,
        device: String(stats.dev),
        inode: String(stats.ino),
      };
      return result;
    });
    const completed = await runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor,
    });
    assert.equal(completed.state, 'completed');
    assert.equal(completed.energyCollection.unavailableReason, expectedReason);
    assert.equal(completed.summary.energyWhTotal, null);
    assert.equal(completed.summary.energyUnavailableReason, expectedReason);
  }
});

test('rejects a terminal checkpoint forged without its consumed sidecar before spawn', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-forged-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor: makeExecutor((context) => successResult({ ...context, outputDirectory })),
  });
  const forged = JSON.parse(await readFile(manifestPath, 'utf8'));
  forged.repetitions[0].commandReceipt.sidecar = null;
  forged.repetitions[0].commandReceipt.attemptReceiptSha256 =
    deriveAttemptReceiptSha256(forged, forged.repetitions[0]);
  assert.equal(validateManifest(forged).success, false);
  await writeFile(manifestPath, serializeManifest(forged));
  const neverSpawned = makeExecutor(() => {
    throw new Error('must not spawn');
  });

  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor: neverSpawned,
    }),
    { code: 'checkpoint_integrity_failed' },
  );
  assert.deepEqual(neverSpawned.calls, []);
});

test('rejects a recomputed sidecar receipt whose metrics disagree with the record', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-sidecar-cross-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor: makeExecutor((context) => successResult({ ...context, outputDirectory })),
  });
  const checkpoint = JSON.parse(await readFile(manifestPath, 'utf8'));
  const receipt = checkpoint.repetitions[0].commandReceipt.sidecar;
  const sidecarPath = path.join(outputDirectory, receipt.relativePath);
  const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'));
  sidecar.metrics.energyWh = 99;
  const bytes = Buffer.from(serializeManifest(sidecar));
  await writeFile(sidecarPath, bytes);
  const stats = await stat(sidecarPath);
  checkpoint.repetitions[0].commandReceipt.sidecar = {
    relativePath: receipt.relativePath,
    sha256: sha256Receipt(bytes),
    bytes: bytes.length,
    device: String(stats.dev),
    inode: String(stats.ino),
  };
  checkpoint.repetitions[0].commandReceipt.attemptReceiptSha256 =
    deriveAttemptReceiptSha256(checkpoint, checkpoint.repetitions[0]);
  await writeFile(manifestPath, serializeManifest(checkpoint));

  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor: makeExecutor(() => {
        throw new Error('must not spawn');
      }),
    }),
    { code: 'checkpoint_integrity_failed' },
  );
});

test('resume trusts the current configuration, rejects tampering before spawn, and retries only interruption', async (t) => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-resume-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  const first = makeExecutor(async (context) => {
    if (context.record.phase === 'repetition' && context.record.index === 2) {
      return {
        status: 'failure',
        startedAt: '2026-08-24T10:00:00.000Z',
        finishedAt: '2026-08-24T10:00:01.000Z',
        exitCode: null,
        signal: 'SIGINT',
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        wallTimeSeconds: 1,
        metrics: { peakMemoryBytes: null, energyWh: null },
        metricUnavailableReason: {
          peakMemoryBytes: 'interrupted',
          energyWh: 'interrupted',
        },
        candidates: [],
        sidecar: null,
        error: {
          code: 'execution_interrupted',
          category: 'interrupted',
          message: 'Fixture interruption.',
          retryable: true,
          allocationFailure: false,
          detailsSha256: null,
        },
      };
    }
    return successResult({ ...context, outputDirectory });
  });
  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor: first,
    }),
    { name: 'AbortError' },
  );
  const checkpoint = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(checkpoint.repetitions[1].status, 'interrupted');
  assert.equal(checkpoint.repetitions[1].attempt, 1);
  const interruptedAttemptReceipt =
    checkpoint.repetitions[1].commandReceipt.attemptReceiptSha256;
  assert.match(interruptedAttemptReceipt, /^sha256:[a-f0-9]{64}$/);

  const interruptedCheckpointBytes = await readFile(manifestPath);
  for (const [label, relativePath] of [
    ['artifact', checkpoint.warmup.candidates[0].artifact.relativePath],
    ['sidecar', checkpoint.warmup.commandReceipt.sidecar.relativePath],
  ]) {
    await t.test(`resume rejects an interrupted checkpoint with a missing ${label}`, async () => {
      const absolutePath = path.join(outputDirectory, relativePath);
      const heldPath = `${absolutePath}.held-missing`;
      await rename(absolutePath, heldPath);
      const forbiddenExecutor = makeExecutor(() => assert.fail('resume must not spawn'));
      try {
        await assert.rejects(
          runBenchmarkManifest({
            plannedManifest: planned,
            manifestPath,
            outputDirectory,
            executor: forbiddenExecutor,
          }),
          { code: 'checkpoint_integrity_failed' },
        );
        assert.deepEqual(forbiddenExecutor.calls, []);
        assert.deepEqual(await readFile(manifestPath), interruptedCheckpointBytes);
      } finally {
        await rename(heldPath, absolutePath);
      }
    });
  }

  const tampered = structuredClone(checkpoint);
  tampered.repetitions[0].commandReceipt.command[0] = '/bin/sh';
  await writeFile(manifestPath, serializeManifest(tampered));
  const neverSpawned = makeExecutor(() => {
    throw new Error('must not spawn');
  });
  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor: neverSpawned,
    }),
    { code: 'checkpoint_integrity_failed' },
  );
  assert.deepEqual(neverSpawned.calls, []);

  await writeFile(manifestPath, serializeManifest(checkpoint));
  const resumed = makeExecutor((context) =>
    successResult({ ...context, outputDirectory }),
  );
  const completed = await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor: resumed,
  });
  assert.deepEqual(resumed.calls, ['repetition:2:2', 'repetition:3:1']);
  assert.equal(completed.state, 'completed');
  assert.equal(
    completed.repetitions[1].commandReceipt.previousAttemptReceiptSha256,
    interruptedAttemptReceipt,
  );
  assert.notEqual(
    completed.repetitions[1].commandReceipt.attemptReceiptSha256,
    interruptedAttemptReceipt,
  );
  assert.deepEqual(
    completed.repetitions[1].attemptReceipts.map((receipt) => receipt.attempt),
    [1, 2],
  );
  assert.equal(
    completed.repetitions[1].attemptReceipts[1].previousAttemptReceiptSha256,
    completed.repetitions[1].attemptReceipts[0].attemptReceiptSha256,
  );

  const forgedChain = structuredClone(completed);
  forgedChain.repetitions[1].attemptReceipts[1].previousAttemptReceiptSha256 =
    `sha256:${'0'.repeat(64)}`;
  forgedChain.repetitions[1].commandReceipt.previousAttemptReceiptSha256 =
    `sha256:${'0'.repeat(64)}`;
  forgedChain.repetitions[1].commandReceipt.attemptReceiptSha256 =
    deriveAttemptReceiptSha256(forgedChain, forgedChain.repetitions[1]);
  assert.equal(validateManifest(forgedChain).success, false);

  const forgedHistoricalTerminal = structuredClone(completed);
  const forgedRecord = forgedHistoricalTerminal.repetitions[1];
  const historicalReceipt = forgedRecord.attemptReceipts[0];
  historicalReceipt.result.status = 'completed';
  historicalReceipt.result.error = null;
  historicalReceipt.attemptReceiptSha256 = sha256Receipt(
    serializeManifest({
      request: deriveRequestIdentity(
        forgedHistoricalTerminal,
        forgedRecord,
        historicalReceipt.attempt,
      ),
      requestSha256: historicalReceipt.requestSha256,
      previousAttemptReceiptSha256: historicalReceipt.previousAttemptReceiptSha256,
      commandEvidence: historicalReceipt.commandEvidence,
      result: historicalReceipt.result,
    }),
  );
  const currentReceipt = forgedRecord.attemptReceipts[1];
  currentReceipt.previousAttemptReceiptSha256 = historicalReceipt.attemptReceiptSha256;
  currentReceipt.attemptReceiptSha256 = sha256Receipt(
    serializeManifest({
      request: deriveRequestIdentity(
        forgedHistoricalTerminal,
        forgedRecord,
        currentReceipt.attempt,
      ),
      requestSha256: currentReceipt.requestSha256,
      previousAttemptReceiptSha256: currentReceipt.previousAttemptReceiptSha256,
      commandEvidence: currentReceipt.commandEvidence,
      result: currentReceipt.result,
    }),
  );
  forgedRecord.commandReceipt.previousAttemptReceiptSha256 =
    historicalReceipt.attemptReceiptSha256;
  forgedRecord.commandReceipt.attemptReceiptSha256 = currentReceipt.attemptReceiptSha256;
  assert.equal(
    spikeManifestSchema.safeParse(forgedHistoricalTerminal).success,
    true,
    'hostile history must remain structurally valid so integrity validation owns the rejection',
  );
  assert.equal(validateManifest(forgedHistoricalTerminal).success, false);
});

test('checkpoints unexpected post-start failures and never retries them', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-failure-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  const executor = makeExecutor(async (context) => {
    if (context.record.phase === 'repetition' && context.record.index === 1) {
      throw new Error('unexpected adapter bug');
    }
    return successResult({ ...context, outputDirectory });
  });
  let postCloseChecks = 0;
  const completed = await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor,
    postCloseVerify: async () => {
      postCloseChecks += 1;
    },
  });
  assert.equal(postCloseChecks, 1);
  assert.equal(completed.state, 'completed_with_errors');
  assert.equal(completed.repetitions[0].status, 'failed');
  assert.equal(completed.repetitions[0].error.code, 'executor_unhandled_failure');
  assert.equal(completed.repetitions[0].error.retryable, false);
  assert.equal(completed.repetitions[0].commandReceipt.executed, true);
  assert.equal(completed.repetitions[0].wallTimeSeconds, null);
  assert.equal(
    completed.repetitions[0].metricUnavailableReason.wallTimeSeconds,
    'monotonic_measurement_unavailable',
  );

  const second = makeExecutor((context) =>
    successResult({ ...context, outputDirectory }),
  );
  let existingTerminalChecks = 0;
  await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor: second,
    postCloseVerify: async () => {
      existingTerminalChecks += 1;
    },
  });
  assert.deepEqual(second.calls, []);
  assert.equal(existingTerminalChecks, 1);
});

test('checkpoints post-start sidecar receipt failures as structured validation errors', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-sidecar-receipt-failure-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  const executor = makeExecutor(async (context) => {
    const result = await successResult({ ...context, outputDirectory });
    result.sidecar.sha256 = `sha256:${'0'.repeat(64)}`;
    return result;
  });

  const completed = await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor,
  });
  assert.equal(completed.state, 'completed_with_errors');
  assert.equal(completed.warmup.status, 'failed');
  assert.equal(completed.warmup.error.code, 'invalid_generation_result');
  assert.equal(
    completed.warmup.commandReceipt.stdoutSha256,
    sha256Receipt(Buffer.from('fixture stdout')),
  );
  assert.equal(completed.warmup.commandReceipt.stdoutBytes, Buffer.byteLength('fixture stdout'));
  assert.equal(validateManifest(completed).success, true);
  assert.deepEqual(await readCheckpoint(manifestPath, { outputDirectory }), completed);
});

test('cross-checks sidecar semantics before accepting a terminal attempt', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-sidecar-terminal-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  const executor = makeExecutor(async (context) => {
    const result = await successResult({ ...context, outputDirectory });
    result.metrics.energyWh = 99;
    return result;
  });

  const completed = await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor,
  });

  assert.equal(completed.state, 'completed_with_errors');
  assert.equal(completed.warmup.status, 'failed');
  assert.equal(completed.warmup.error.code, 'invalid_generation_result');
  assert.equal(completed.repetitions.every((record) => record.status === 'skipped'), true);
});

test('allocation failure ends the cell and marks all remaining repetitions skipped', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-allocation-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest({ batchSizeRequested: 4 });
  const executor = makeExecutor(async (context) => {
    if (context.record.phase === 'repetition' && context.record.index === 1) {
      return {
        status: 'failure',
        startedAt: '2026-08-24T10:00:00.000Z',
        finishedAt: '2026-08-24T10:00:01.000Z',
        exitCode: null,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        wallTimeSeconds: 1,
        metrics: { peakMemoryBytes: null, energyWh: null },
        metricUnavailableReason: {
          peakMemoryBytes: 'allocation_failure',
          energyWh: 'allocation_failure',
        },
        candidates: [],
        sidecar: null,
        error: {
          code: 'allocation_failure',
          category: 'allocation',
          message: 'Fixture allocation failure.',
          retryable: false,
          allocationFailure: true,
          detailsSha256: null,
        },
      };
    }
    return successResult({ ...context, outputDirectory });
  });
  const completed = await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor,
  });
  assert.deepEqual(executor.calls, ['warmup:0:1', 'repetition:1:1']);
  assert.equal(completed.repetitions[0].status, 'failed');
  assert.equal(completed.repetitions[1].status, 'skipped');
  assert.equal(completed.repetitions[2].status, 'skipped');
  assert.equal(completed.summary.allocationFailures, 1);
  assert.equal(completed.state, 'completed_with_errors');
});

test('rejects impossible effective batches before a success can become completed', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-batch-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest({ batchSizeRequested: 2 });
  const executor = makeExecutor(async (context) => {
    const result = await successResult({ ...context, outputDirectory });
    result.candidates.push({ ...result.candidates[0], index: 3 });
    return result;
  });
  const completed = await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor,
  });
  assert.equal(completed.warmup.status, 'failed');
  assert.equal(completed.warmup.error.code, 'invalid_generation_result');
  assert.equal(completed.repetitions.every((record) => record.status === 'skipped'), true);
});

test('effective batch divergence cannot complete a cell', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-batch-divergence-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest({ batchSizeRequested: 2 });
  const executor = makeExecutor((context) =>
    successResult({
      ...context,
      outputDirectory,
      batchSizeEffective:
        context.record.phase === 'repetition' && context.record.index === 2 ? 1 : 2,
    }),
  );

  const completed = await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor,
  });

  assert.equal(completed.state, 'completed_with_errors');
  assert.equal(completed.repetitions[1].status, 'failed');
  assert.equal(completed.repetitions[1].error.code, 'batch_effective_diverged');
  assert.equal(validateManifest(completed).success, true);
});

test('rejects candidate paths outside the current attempt and non-unique artifact evidence', async (t) => {
  for (const mode of ['outside_attempt', 'non_contiguous', 'same_inode', 'same_digest']) {
    await t.test(mode, async () => {
      const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), `lofiever-artifact-${mode}-`));
      const manifestPath = path.join(outputDirectory, 'manifest.json');
      const planned = plannedManifest();
      const executor = makeExecutor(async (context) => {
        const result = await successResult({ ...context, outputDirectory });
        if (mode === 'outside_attempt') {
          const outside = `cells/rogue-${context.record.phase}-${context.record.index}.wav`;
          await mkdir(path.dirname(path.join(outputDirectory, outside)), { recursive: true });
          await writeFile(path.join(outputDirectory, outside), wavFixture(7));
          result.candidates[0].outputFile = outside;
        } else if (mode === 'non_contiguous') {
          result.candidates[1].index = 3;
        } else {
          const first = path.join(outputDirectory, result.candidates[0].outputFile);
          const second = path.join(outputDirectory, result.candidates[1].outputFile);
          await unlink(second);
          if (mode === 'same_inode') await link(first, second);
          else await writeFile(second, await readFile(first));
        }
        return result;
      });
      const completed = await runBenchmarkManifest({
        plannedManifest: planned,
        manifestPath,
        outputDirectory,
        executor,
      });
      assert.equal(completed.warmup.status, 'failed');
      assert.equal(completed.warmup.error.code, 'invalid_generation_result');
      assert.equal(completed.repetitions.every((record) => record.status === 'skipped'), true);
    });
  }
});

test('lock refusal happens before the second executor can spawn', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-run-lock-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  let releaseFirst;
  const blocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const firstExecutor = makeExecutor(async (context) => {
    await blocked;
    return successResult({ ...context, outputDirectory });
  });
  const firstRun = runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor: firstExecutor,
  });
  let firstSettled = false;
  const firstOutcome = firstRun.then(
    (value) => {
      firstSettled = true;
      return { status: 'fulfilled', value };
    },
    (error) => {
      firstSettled = true;
      return { status: 'rejected', error };
    },
  );
  while (firstExecutor.calls.length === 0 && !firstSettled) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (firstExecutor.calls.length === 0) {
    const outcome = await firstOutcome;
    if (outcome.status === 'rejected') throw outcome.error;
    assert.fail('First runner completed before reaching the executor boundary.');
  }

  const secondExecutor = makeExecutor(() => {
    throw new Error('must not spawn');
  });
  await assert.rejects(
    runBenchmarkManifest({
      plannedManifest: planned,
      manifestPath,
      outputDirectory,
      executor: secondExecutor,
    }),
    { code: 'benchmark_locked' },
  );
  assert.deepEqual(secondExecutor.calls, []);
  releaseFirst();
  const outcome = await firstOutcome;
  if (outcome.status === 'rejected') throw outcome.error;
});

test('resume finalizes an abruptly abandoned running repetition and skips every later record', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-abandoned-'));
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const planned = plannedManifest();
  await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor: makeExecutor((context) => successResult({ ...context, outputDirectory })),
  });
  const crashed = JSON.parse(await readFile(manifestPath, 'utf8'));
  const running = crashed.repetitions[1];
  running.status = 'running';
  running.wallTimeSeconds = null;
  running.rtf = null;
  running.peakMemoryBytes = null;
  running.energyWh = null;
  running.batchSizeEffective = null;
  running.audioDurationSeconds = null;
  running.candidates = [];
  running.error = null;
  running.metricUnavailableReason = {
    wallTimeSeconds: 'running',
    rtf: 'running',
    peakMemoryBytes: 'running',
    energyWh: 'running',
    batchSizeEffective: 'running',
    audioDurationSeconds: 'running',
  };
  running.commandReceipt.finishedAt = null;
  running.commandReceipt.exitCode = null;
  running.commandReceipt.signal = null;
  running.commandReceipt.stdoutSha256 = null;
  running.commandReceipt.stderrSha256 = null;
  running.commandReceipt.stdoutBytes = null;
  running.commandReceipt.stderrBytes = null;
  running.commandReceipt.sidecar = null;
  running.commandReceipt.attemptReceiptSha256 = null;
  running.attemptReceipts = [];
  crashed.repetitions[2] = structuredClone(planned.repetitions[2]);
  crashed.state = 'running';
  crashed.factors.batchSizeEffective = 2;
  crashed.summary = deriveSummary(crashed);
  assert.equal(validateManifest(crashed).success, true);
  await writeFile(manifestPath, serializeManifest(crashed));

  const neverSpawned = makeExecutor(() => {
    throw new Error('must not spawn');
  });
  let abandonedChecks = 0;
  const finalized = await runBenchmarkManifest({
    plannedManifest: planned,
    manifestPath,
    outputDirectory,
    executor: neverSpawned,
    postCloseVerify: async () => {
      abandonedChecks += 1;
    },
  });

  assert.deepEqual(neverSpawned.calls, []);
  assert.equal(abandonedChecks, 1);
  assert.equal(finalized.repetitions[1].status, 'failed');
  assert.equal(finalized.repetitions[1].error.code, 'execution_abandoned');
  assert.equal(finalized.repetitions[2].status, 'skipped');
  assert.equal(
    finalized.repetitions[2].error.code,
    'skipped_after_abandoned_attempt',
  );
  assert.equal(validateManifest(finalized).success, true);
});
