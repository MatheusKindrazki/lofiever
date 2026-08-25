import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
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

import { captureExecutableClosure } from './dynamic-linker.mjs';
import { createConfinedOutputStore } from './confined-output-store.mjs';
import { createPersistentAdapter } from './executor.mjs';
import { digestPath } from './integrity.mjs';
import {
  createDryRunManifest,
  deriveRequestSha256,
  serializeManifest,
  sha256Receipt,
} from './manifest.mjs';

const execFileAsync = promisify(execFile);
const fixtureAdapter = new URL('./fixtures/fake-persistent-adapter.py', import.meta.url).pathname;

async function filePin(filePath) {
  return {
    path: filePath,
    realpath: await realpath(filePath),
    sha256: await digestPath(await realpath(filePath)),
  };
}

function environmentIdentity(processEnvironment) {
  const environment = Object.entries(processEnvironment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      name,
      valueSha256: sha256Receipt(value),
    }));
  return {
    environment,
    environmentSha256: sha256Receipt(serializeManifest(environment)),
  };
}

async function executableFixture({
  hostileAdjacentModule = false,
  includeDynamicLinker = true,
  maxOutputBytes = 1024 * 1024,
  terminateGraceSeconds = 0.1,
  timeout = 5,
} = {}) {
  const outputDirectory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'lofiever-persistent-')),
  );
  const { stdout } = process.platform === 'darwin'
    ? await execFileAsync(
      process.env.LOFIEVER_TEST_UV ?? '/Users/matheuskindrazki/.local/bin/uv',
      ['python', 'find', '3.12'],
      { encoding: 'utf8' },
    )
    : await execFileAsync('which', ['python3']);
  const pythonPath = stdout.trim();
  const pythonRuntimeRoot = path.dirname(path.dirname(await realpath(pythonPath)));
  const python = await filePin(pythonPath);
  const dynamicLinker = includeDynamicLinker
    ? await captureExecutableClosure(python)
    : undefined;
  let adapterPath = fixtureAdapter;
  if (hostileAdjacentModule) {
    adapterPath = path.join(outputDirectory, 'adapter.py');
    await writeFile(adapterPath, await readFile(fixtureAdapter));
    await writeFile(
      path.join(outputDirectory, 'threading.py'),
      'raise RuntimeError("adjacent module shadowed the Python standard library")\n',
    );
  }
  const script = await filePin(adapterPath);
  const weightsPath = path.join(outputDirectory, 'model.bin');
  const lmWeightsPath = path.join(outputDirectory, 'lm.bin');
  await writeFile(weightsPath, 'fixture-model');
  await writeFile(lmWeightsPath, 'fixture-lm');
  const weights = await filePin(weightsPath);
  const lmWeights = await filePin(lmWeightsPath);
  const processEnvironment = {
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONSAFEPATH: '1',
  };
  const { environment, environmentSha256 } = environmentIdentity(processEnvironment);
  const identity = {
    benchmarkId: 'fixture-persistent',
    host: {
      machine: 'fixture-mac',
      chip: 'fixture-chip',
      memoryBytes: 1024,
      osVersion: 'fixture-os (fixture-build)',
    },
    engine: {
      name: 'ace-step-1.5',
      repositoryPath: outputDirectory,
      repoCommit: '14c0211d5a0653b0f63e27686f4c3f151b4d8629',
      clean: true,
    },
    model: {
      id: 'fixture-model',
      revision: '1'.repeat(40),
      weights,
      lm: {
        id: 'fixture-lm',
        revision: '2'.repeat(40),
        weights: lmWeights,
      },
    },
    runtime: {
      device: 'mps',
      lmBackend: 'mlx',
      vaeChunk: 8,
      harnessCommit: '473babf21658793629c1ce5f250b931b1072d802',
      harnessRepositoryPath: outputDirectory,
      harnessClean: true,
      runDirectory: pythonRuntimeRoot,
      runDirectoryIdentity: {
        realpath: pythonRuntimeRoot,
        device: '1',
        inode: '2',
        parent: { realpath: path.dirname(outputDirectory), device: '1', inode: '1' },
      },
      serverCommit: null,
    },
    toolchain: {
      git: { ...python, version: 'fixture-git' },
      node: { ...python, version: 'fixture-node' },
      python: { ...python, version: 'fixture-python' },
      uv: { ...python, version: 'fixture-uv', dynamicLinker },
      ffmpeg: { ...python, version: 'fixture-ffmpeg' },
      ffprobe: {
        ...python,
        version: 'fixture-ffprobe',
        ...(dynamicLinker === undefined ? {} : { dynamicLinker }),
      },
    },
    environment,
    environmentSha256,
  };
  const adapter = {
    kind: 'persistent-jsonl-v1',
    workingDirectory: outputDirectory,
    executable: python,
    script,
    ...(dynamicLinker === undefined ? {} : { dynamicLinker }),
    requestTimeoutSeconds: timeout,
    terminateGraceSeconds,
    maxOutputBytes,
  };
  const manifest = createDryRunManifest({
    identity,
    adapter,
    cell: { durationSeconds: 180, batchSizeRequested: 2 },
    repetitions: 3,
    executionMode: 'execute',
  });
  return { adapter, identity, manifest, outputDirectory, processEnvironment };
}

function attemptRecord(manifest, source, attempt = 1) {
  const record = structuredClone(source);
  record.attempt = attempt;
  record.commandReceipt.requestSha256 = deriveRequestSha256(manifest, record, attempt);
  return record;
}

function createVerifiedPersistentAdapter(fixture, overrides = {}) {
  return createPersistentAdapter({
    adapter: fixture.adapter,
    identity: fixture.identity,
    outputDirectory: fixture.outputDirectory,
    processEnvironment: fixture.processEnvironment,
    preSpawnVerify: async () => {},
    ...overrides,
  });
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch (error) {
      if (error?.code === 'ESRCH') return;
      throw error;
    }
  }
  assert.fail(`Adapter process ${pid} did not exit before the test deadline.`);
}

async function waitForPath(filePath, timeoutMilliseconds = 5_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      await stat(filePath);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.fail(`Expected path was not created before the test deadline: ${filePath}`);
}

test('requires a pre-spawn verifier at the public persistent-adapter boundary', async () => {
  const fixture = await executableFixture();
  assert.throws(
    () =>
      createPersistentAdapter({
        adapter: fixture.adapter,
        identity: fixture.identity,
        outputDirectory: fixture.outputDirectory,
        processEnvironment: {},
      }),
    { code: 'executor_pre_spawn_verifier_required' },
  );
});

test('records every cleanup guard PGID before adapter initialization', async () => {
  const fixture = await executableFixture();
  const lifecyclePath = path.join(fixture.outputDirectory, 'adapter-lifecycle.json');
  const observed = [];
  const guard = {
    async recordCleanupProcessGroup(processGroupId) {
      await assert.rejects(stat(lifecyclePath), { code: 'ENOENT' });
      observed.push(processGroupId);
    },
  };
  const session = createVerifiedPersistentAdapter(fixture, {
    cleanupGuards: [guard],
  });
  session.registerCleanupGuard({
    async recordCleanupProcessGroup(processGroupId) {
      await assert.rejects(stat(lifecyclePath), { code: 'ENOENT' });
      observed.push(processGroupId);
    },
  });
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });
    assert.equal(result.status, 'success');
    assert.deepEqual(observed, [session.pid, session.pid]);
  } finally {
    await session.close();
  }
});

test('PGID guard update failure terminates the adapter before initialization', async () => {
  const fixture = await executableFixture();
  const updateError = Object.assign(new Error('simulated guard ENOSPC'), {
    code: 'ENOSPC',
  });
  const session = createVerifiedPersistentAdapter(fixture, {
    cleanupGuards: [{
      async recordCleanupProcessGroup() {
        throw updateError;
      },
    }],
  });
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });
    assert.equal(result.status, 'failure');
    assert.equal(result.error.code, 'ENOSPC');
    assert.equal(result.fatalPreflight, true);
    await waitForProcessExit(session.pid);
    await assert.rejects(
      stat(path.join(fixture.outputDirectory, 'adapter-lifecycle.json')),
      { code: 'ENOENT' },
    );
  } finally {
    await session.close().catch(() => {});
  }
});

test('initialization rejects an adapter-observed host identity that differs from local evidence', async () => {
  const fixture = await executableFixture();
  await writeFile(
    path.join(fixture.outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'host_identity_mismatch' }),
  );
  const session = createVerifiedPersistentAdapter(fixture);
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });
    assert.equal(result.status, 'failure');
    assert.equal(result.error.code, 'adapter_identity_mismatch');
  } finally {
    await session.close().catch(() => {});
  }
});

test(
  'rejects a non-Mach-O adapter wrapper before the public executor can spawn it',
  { skip: process.platform !== 'darwin' },
  async () => {
    const fixture = await executableFixture();
    const marker = path.join(fixture.outputDirectory, 'wrapper-spawned');
    const wrapperPath = path.join(fixture.outputDirectory, 'python3');
    await writeFile(
      wrapperPath,
      `#!/bin/sh\nprintf spawned > ${JSON.stringify(marker)}\nexit 97\n`,
    );
    await chmod(wrapperPath, 0o700);
    const wrapper = await filePin(wrapperPath);
    fixture.adapter.executable = wrapper;
    fixture.adapter.dynamicLinker = await captureExecutableClosure(wrapper);
    const session = createVerifiedPersistentAdapter(fixture);
    try {
      const result = await session.execute({
        manifest: fixture.manifest,
        record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
      });
      assert.equal(result.status, 'failure');
      assert.equal(result.error.code, 'python_runtime_not_macho');
      await assert.rejects(stat(marker), { code: 'ENOENT' });
    } finally {
      await session.close();
    }
  },
);

test('freezes the receipted adapter environment and rejects external Python paths', async () => {
  const fixture = await executableFixture();
  const mutableEnvironment = { ...fixture.processEnvironment };
  const session = createVerifiedPersistentAdapter(fixture, {
    processEnvironment: mutableEnvironment,
  });
  mutableEnvironment.DYLD_LIBRARY_PATH = '/tmp/evil-after-construction';
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });
    assert.equal(result.status, 'success');
  } finally {
    await session.close();
  }

  const hostileSitePackages = path.join(fixture.outputDirectory, 'hostile-site-packages');
  const marker = path.join(fixture.outputDirectory, 'sitecustomize-executed');
  await mkdir(hostileSitePackages);
  await writeFile(
    path.join(hostileSitePackages, 'sitecustomize.py'),
    `open(${JSON.stringify(marker)}, "w").write("executed")\n`,
  );
  const hostileEnvironment = {
    ...fixture.processEnvironment,
    PYTHONPATH: hostileSitePackages,
  };
  const hostileIdentity = {
    ...fixture.identity,
    ...environmentIdentity(hostileEnvironment),
  };
  assert.throws(
    () =>
      createPersistentAdapter({
        adapter: fixture.adapter,
        identity: hostileIdentity,
        outputDirectory: fixture.outputDirectory,
        processEnvironment: hostileEnvironment,
        preSpawnVerify: async () => {},
      }),
    { code: 'adapter_environment_not_allowlisted' },
  );
  await assert.rejects(stat(marker), { code: 'ENOENT' });
});

test('loads one persistent adapter for warmup and repetitions and consumes one sidecar per attempt', async () => {
  const fixture = await executableFixture({ includeDynamicLinker: true });
  const session = createVerifiedPersistentAdapter(fixture);
  try {
    const warmup = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });
    const repetition = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.repetitions[0]),
    });

    assert.equal(warmup.status, 'success');
    assert.equal(repetition.status, 'success');
    assert.equal(warmup.candidates.length, 2);
    assert.equal(warmup.candidates[0].durationSeconds, 180);
    assert.match(warmup.sidecar.relativePath, /executor-result\.consumed\.json$/);
    await assert.rejects(stat(path.join(fixture.outputDirectory, warmup.resultJsonPath)), {
      code: 'ENOENT',
    });
    const lifecycle = JSON.parse(
      await readFile(path.join(fixture.outputDirectory, 'adapter-lifecycle.json'), 'utf8'),
    );
    assert.equal(lifecycle.initializations, 1);
    assert.equal(lifecycle.executions, 2);
    assert.equal(lifecycle.pid, session.pid);
    assert.equal(lifecycle.harnessPid, process.pid);
    assert.equal(lifecycle.pythonSafePath, true);
    assert.equal(
      lifecycle.pythonClosureSha256,
      fixture.adapter.dynamicLinker.closureSha256,
    );
    assert.equal(
      lifecycle.ffprobeClosureSha256,
      fixture.identity.toolchain.ffprobe.dynamicLinker.closureSha256,
    );
  } finally {
    await session.close();
  }
});

test('binds one confined output store before any adapter spawn', async (t) => {
  await t.test('rejects a constructor-store override on the first request', async () => {
    const fixture = await executableFixture();
    const otherRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'lofiever-store-other-first-')),
    );
    const storeA = await createConfinedOutputStore(fixture.outputDirectory);
    const storeB = await createConfinedOutputStore(otherRoot);
    const session = createVerifiedPersistentAdapter(fixture, { outputStore: storeA });
    try {
      await assert.rejects(
        session.execute({
          manifest: fixture.manifest,
          record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
          outputStore: storeB,
        }),
        { code: 'executor_output_store_mismatch' },
      );
      await assert.rejects(
        stat(path.join(fixture.outputDirectory, 'adapter-lifecycle.json')),
        { code: 'ENOENT' },
      );
      assert.deepEqual(await readdir(otherRoot), []);
    } finally {
      await session.close();
      await storeB.close();
      await storeA.close();
    }
  });

  await t.test('rejects a different store after the first request binds fd4', async () => {
    const fixture = await executableFixture();
    const otherRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'lofiever-store-other-bound-')),
    );
    const storeA = await createConfinedOutputStore(fixture.outputDirectory);
    const storeB = await createConfinedOutputStore(otherRoot);
    const session = createVerifiedPersistentAdapter(fixture, { outputStore: storeA });
    try {
      const first = await session.execute({
        manifest: fixture.manifest,
        record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
        outputStore: storeA,
      });
      assert.equal(first.status, 'success');
      await assert.rejects(
        session.execute({
          manifest: fixture.manifest,
          record: attemptRecord(fixture.manifest, fixture.manifest.repetitions[0]),
          outputStore: storeB,
        }),
        { code: 'executor_output_store_mismatch' },
      );
      assert.deepEqual(await readdir(otherRoot), []);
      const lifecycle = JSON.parse(
        await readFile(path.join(fixture.outputDirectory, 'adapter-lifecycle.json'), 'utf8'),
      );
      assert.equal(lifecycle.executions, 1);
    } finally {
      await session.close();
      await storeB.close();
      await storeA.close();
    }
  });
});

test('fd4 output capability rejects a cells replacement before adapter output', async () => {
  const fixture = await executableFixture();
  await writeFile(
    path.join(fixture.outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'wait_before_output' }),
  );
  const outside = await mkdtemp(path.join(os.tmpdir(), 'lofiever-cells-outside-'));
  const sentinel = path.join(outside, 'sentinel.txt');
  await writeFile(sentinel, 'outside sentinel\n');
  const store = await createConfinedOutputStore(fixture.outputDirectory);
  const session = createVerifiedPersistentAdapter(fixture, { outputStore: store });
  const cells = path.join(fixture.outputDirectory, 'cells');
  const movedCells = path.join(fixture.outputDirectory, 'cells-original');
  let swapped = false;
  try {
    const execution = session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
      outputStore: store,
    });
    await waitForPath(path.join(fixture.outputDirectory, 'adapter-before-output.json'));
    await rename(cells, movedCells);
    await symlink(outside, cells);
    swapped = true;
    await writeFile(
      path.join(fixture.outputDirectory, 'adapter-continue-output.json'),
      '{}\n',
    );
    const result = await execution;
    assert.equal(result.status, 'failure');
    assert.equal(result.error.code, 'executor_sidecar_quarantine_failed');
    assert.equal(await readFile(sentinel, 'utf8'), 'outside sentinel\n');
    assert.deepEqual(await readdir(outside), ['sentinel.txt']);
  } finally {
    if (swapped) {
      await unlink(cells);
      await rename(movedCells, cells);
    }
    await session.close().catch(() => {});
    await store.close().catch(() => {});
  }
});

test('fd5 keeps the verified working-directory inode across a public-path swap', async () => {
  const fixture = await executableFixture();
  const workingDirectory = path.join(fixture.outputDirectory, 'engine-cwd');
  const movedWorkingDirectory = path.join(fixture.outputDirectory, 'engine-cwd-original');
  const replacementSaved = path.join(fixture.outputDirectory, 'engine-cwd-replacement');
  await mkdir(workingDirectory, { mode: 0o700 });
  fixture.adapter.workingDirectory = await realpath(workingDirectory);
  let swapped = false;
  const session = createVerifiedPersistentAdapter(fixture, {
    preSpawnVerify: async () => {
      await rename(workingDirectory, movedWorkingDirectory);
      await mkdir(workingDirectory, { mode: 0o700 });
      await writeFile(
        path.join(workingDirectory, 'fixture-behavior.json'),
        JSON.stringify({ mode: 'identity_mismatch' }),
      );
      swapped = true;
    },
  });
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });
    assert.equal(result.status, 'failure');
    assert.equal(result.error.code, 'adapter_working_directory_changed');
  } finally {
    if (swapped) {
      await rename(workingDirectory, replacementSaved);
      await rename(movedWorkingDirectory, workingDirectory);
    }
    await session.close().catch(() => {});
  }
});

test('isolates the persistent Python adapter from hostile modules beside its snapshot', async () => {
  const fixture = await executableFixture({ hostileAdjacentModule: true });
  const session = createVerifiedPersistentAdapter(fixture);
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });
    assert.equal(result.status, 'success');
  } finally {
    await session.close();
  }
});

test('fails closed for missing, incomplete, mismatched, or failed GenerationResult sidecars', async (t) => {
  const cases = [
    ['missing_sidecar', 'executor_sidecar_missing'],
    ['incomplete_sidecar', 'invalid_executor_result'],
    ['sidecar_identity_mismatch', 'executor_sidecar_identity_mismatch'],
    ['generation_failure', 'generation_failed'],
    ['extra_response', 'unexpected_adapter_output'],
    ['extra_response_split', 'unexpected_adapter_output'],
  ];
  for (const [mode, code] of cases) {
    await t.test(mode, async () => {
      const fixture = await executableFixture();
      await writeFile(
        path.join(fixture.outputDirectory, 'fixture-behavior.json'),
        JSON.stringify({ mode }),
      );
      const session = createVerifiedPersistentAdapter(fixture);
      try {
        const result = await session.execute({
          manifest: fixture.manifest,
          record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
        });
        assert.equal(result.status, 'failure');
        assert.equal(result.error.code, code);
        assert.notEqual(result.error, null);
      } finally {
        await session.close();
      }
    });
  }
});

test('rejects a trailing partial byte coalesced with the response boundary', async () => {
  const fixture = await executableFixture();
  await writeFile(
    path.join(fixture.outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'trailing_partial_immediate' }),
  );
  const session = createVerifiedPersistentAdapter(fixture);
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });
    assert.equal(result.status, 'failure');
    assert.equal(result.error.code, 'unexpected_adapter_output');
  } finally {
    await session.close();
  }
});

test('close rejects a trailing partial byte emitted after boundary resolution', async () => {
  const fixture = await executableFixture();
  await writeFile(
    path.join(fixture.outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'trailing_partial_delayed' }),
  );
  const session = createVerifiedPersistentAdapter(fixture);
  const result = await session.execute({
    manifest: fixture.manifest,
    record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
  });
  assert.equal(result.status, 'success');
  const adapterPid = session.pid;
  await waitForProcessExit(adapterPid);
  await assert.rejects(session.close(), { code: 'unexpected_adapter_output' });
});

test('close rejects EOF immediately after the last response boundary', async () => {
  const fixture = await executableFixture();
  await writeFile(
    path.join(fixture.outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'exit_after_boundary' }),
  );
  const session = createVerifiedPersistentAdapter(fixture);
  const result = await session.execute({
    manifest: fixture.manifest,
    record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
  });
  assert.equal(result.status, 'success');
  await waitForProcessExit(session.pid);
  await assert.rejects(session.close(), { code: 'executor_process_exit' });
});

test('close rejects wrong shutdown acknowledgement type or shape', async (t) => {
  for (const mode of ['wrong_shutdown_type', 'wrong_shutdown_shape']) {
    await t.test(mode, async () => {
      const fixture = await executableFixture();
      const session = createVerifiedPersistentAdapter(fixture);
      const result = await session.execute({
        manifest: fixture.manifest,
        record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
      });
      assert.equal(result.status, 'success');
      await writeFile(
        path.join(fixture.outputDirectory, 'fixture-behavior.json'),
        JSON.stringify({ mode }),
      );
      await assert.rejects(session.close(), { code: 'invalid_adapter_response' });
    });
  }
});

test('close never signals a process-group number again after TERM reports ESRCH', async () => {
  const fixture = await executableFixture();
  const session = createVerifiedPersistentAdapter(fixture);
  const warmup = await session.execute({
    manifest: fixture.manifest,
    record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
  });
  assert.equal(warmup.status, 'success');
  const adapterPid = session.pid;
  await writeFile(
    path.join(fixture.outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'exit_after_boundary' }),
  );

  const originalKill = process.kill;
  const groupSignals = [];
  let killSent = false;
  process.kill = (pid, signal) => {
    if (pid !== -adapterPid) return originalKill(pid, signal);
    groupSignals.push(signal);
    if (signal === 'SIGTERM') {
      const error = new Error('No such process group.');
      error.code = 'ESRCH';
      throw error;
    }
    if (signal === 'SIGKILL') {
      killSent = true;
      return true;
    }
    if (signal === 0 && killSent) {
      const error = new Error('Reused group exited.');
      error.code = 'ESRCH';
      throw error;
    }
    return true;
  };
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.repetitions[0]),
    });
    assert.equal(result.status, 'success');
    await waitForProcessExit(adapterPid);
    await assert.rejects(session.close(), { code: 'executor_process_exit' });
    await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    process.kill = originalKill;
  }
  assert.deepEqual(groupSignals, ['SIGTERM']);
});

test('close stops forever when SIGKILL reports the process group absent', async () => {
  const fixture = await executableFixture({ terminateGraceSeconds: 0.001 });
  const session = createVerifiedPersistentAdapter(fixture);
  const result = await session.execute({
    manifest: fixture.manifest,
    record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
  });
  assert.equal(result.status, 'success');
  const adapterPid = session.pid;
  const originalKill = process.kill;
  const groupSignals = [];
  let killObserved = false;
  process.kill = (pid, signal) => {
    if (pid !== -adapterPid) return originalKill(pid, signal);
    groupSignals.push(signal);
    if (signal === 'SIGTERM') return true;
    if (signal === 'SIGKILL') {
      killObserved = true;
      const error = new Error('Process group disappeared before SIGKILL.');
      error.code = 'ESRCH';
      throw error;
    }
    if (killObserved) {
      throw new Error('A reused process group was probed after first ESRCH.');
    }
    return true;
  };
  try {
    await session.close();
  } finally {
    process.kill = originalKill;
    await session.close().catch(() => {});
  }
  assert.equal(killObserved, true);
  assert.equal(groupSignals.at(-1), 'SIGKILL');
});

test('close does not signal or probe again after a pre-KILL liveness check reports ESRCH', async () => {
  const fixture = await executableFixture({ terminateGraceSeconds: 0.001 });
  const session = createVerifiedPersistentAdapter(fixture);
  const result = await session.execute({
    manifest: fixture.manifest,
    record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
  });
  assert.equal(result.status, 'success');
  const adapterPid = session.pid;
  const originalKill = process.kill;
  const groupSignals = [];
  process.kill = (pid, signal) => {
    if (pid !== -adapterPid) return originalKill(pid, signal);
    groupSignals.push(signal);
    if (signal === 'SIGTERM') return true;
    if (signal === 0) {
      const error = new Error('Process group exited during TERM grace.');
      error.code = 'ESRCH';
      throw error;
    }
    throw new Error('A process-group number was signalled after first ESRCH.');
  };
  try {
    await session.close();
  } finally {
    process.kill = originalKill;
    await session.close().catch(() => {});
  }
  assert.deepEqual(groupSignals, ['SIGTERM', 0]);
});

test('close never reprobes a process-group number after a post-KILL poll reports ESRCH', async () => {
  const fixture = await executableFixture({ terminateGraceSeconds: 0.001 });
  const session = createVerifiedPersistentAdapter(fixture);
  const result = await session.execute({
    manifest: fixture.manifest,
    record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
  });
  assert.equal(result.status, 'success');
  const adapterPid = session.pid;
  const originalKill = process.kill;
  const groupSignals = [];
  let killObserved = false;
  let postKillProbes = 0;
  process.kill = (pid, signal) => {
    if (pid !== -adapterPid) return originalKill(pid, signal);
    groupSignals.push(signal);
    if (signal === 'SIGTERM') return true;
    if (signal === 'SIGKILL') {
      killObserved = true;
      return true;
    }
    if (!killObserved) return true;
    postKillProbes += 1;
    if (postKillProbes === 1) return true;
    if (postKillProbes === 2) {
      const error = new Error('Process group disappeared after SIGKILL.');
      error.code = 'ESRCH';
      throw error;
    }
    throw new Error('A reused process group was probed after first ESRCH.');
  };
  try {
    await session.close();
  } finally {
    process.kill = originalKill;
    await session.close().catch(() => {});
  }
  assert.equal(postKillProbes, 2);
  assert.deepEqual(groupSignals.slice(-3), ['SIGKILL', 0, 0]);
});

test('close kills same-group workers after the adapter exits at the last boundary', async () => {
  const fixture = await executableFixture();
  await writeFile(
    path.join(fixture.outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'exit_after_boundary_with_worker' }),
  );
  const session = createVerifiedPersistentAdapter(fixture);
  let workerPid = null;
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });
    assert.equal(result.status, 'success');
    workerPid = JSON.parse(
      await readFile(path.join(fixture.outputDirectory, 'orphan-worker.json'), 'utf8'),
    ).pid;
    await waitForProcessExit(session.pid);
    await waitForProcessExit(workerPid);
    await assert.rejects(session.close(), { code: 'executor_process_exit' });
  } finally {
    await session.close().catch(() => {});
    if (workerPid !== null) {
      try {
        process.kill(workerPid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
  }
});

test('close prioritizes an unproven process-group cleanup over the protocol error', async () => {
  const fixture = await executableFixture();
  const session = createVerifiedPersistentAdapter(fixture);
  const warmup = await session.execute({
    manifest: fixture.manifest,
    record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
  });
  assert.equal(warmup.status, 'success');
  const adapterPid = session.pid;
  await writeFile(
    path.join(fixture.outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'exit_after_boundary_with_worker' }),
  );

  const originalKill = process.kill;
  let workerPid = null;
  process.kill = (pid, signal) => {
    if (pid !== -adapterPid) return originalKill(pid, signal);
    return true;
  };
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.repetitions[0]),
    });
    assert.equal(result.status, 'success');
    workerPid = JSON.parse(
      await readFile(path.join(fixture.outputDirectory, 'orphan-worker.json'), 'utf8'),
    ).pid;
    await waitForProcessExit(adapterPid);
    await assert.rejects(session.close(), (error) => {
      assert.equal(error.code, 'executor_process_group_alive');
      assert.equal(error.cleanupUnproven, true);
      assert.equal(error.details.priorErrorCode, 'executor_process_exit');
      return true;
    });
  } finally {
    process.kill = originalKill;
    await session.close().catch(() => {});
    if (workerPid !== null) {
      try {
        process.kill(workerPid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
  }
});

test('bounds streaming output and times out by terminating the persistent process group', async (t) => {
  for (const [behavior, expectedCode, maxOutputBytes] of [
    [{ mode: 'hang', seconds: 30 }, 'executor_timeout', 1024 * 1024],
    [{ mode: 'stderr_overflow', bytes: 4096 }, 'executor_output_limit', 512],
  ]) {
    await t.test(expectedCode, async () => {
      const fixture = await executableFixture({ maxOutputBytes, timeout: 0.1 });
      await writeFile(
        path.join(fixture.outputDirectory, 'fixture-behavior.json'),
        JSON.stringify(behavior),
      );
      const session = createVerifiedPersistentAdapter(fixture);
      const result = await session.execute({
        manifest: fixture.manifest,
        record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
      });
      assert.equal(result.status, 'failure');
      assert.equal(result.error.code, expectedCode);
      assert.ok(result.stderr.length <= maxOutputBytes);
      await session.close();
    });
  }
});

test('revalidates every pin immediately before the persistent adapter spawn', async () => {
  const fixture = await executableFixture();
  let checks = 0;
  const session = createVerifiedPersistentAdapter(fixture, {
    preSpawnVerify: async () => {
      checks += 1;
      const error = new Error('Harness worktree became dirty.');
      error.code = 'harness_worktree_dirty';
      throw error;
    },
  });
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });

    assert.equal(checks, 1);
    assert.equal(result.status, 'failure');
    assert.equal(result.error.code, 'harness_worktree_dirty');
    assert.equal(result.fatalPreflight, true);
    await assert.rejects(
      stat(path.join(fixture.outputDirectory, 'adapter-lifecycle.json')),
      { code: 'ENOENT' },
    );
  } finally {
    await session.close();
  }
});

test('spawns only constructor snapshots even when the verifier mutates caller-owned adapter paths', async () => {
  const fixture = await executableFixture();
  const marker = path.join(fixture.outputDirectory, 'mutated-adapter-spawned');
  const wrapperPath = path.join(fixture.outputDirectory, 'python3-wrapper');
  await writeFile(
    wrapperPath,
    `#!/bin/sh\nprintf spawned > ${JSON.stringify(marker)}\nexit 97\n`,
  );
  await chmod(wrapperPath, 0o700);
  const mutatedExecutable = await filePin(wrapperPath);
  const mutatedScriptPath = path.join(fixture.outputDirectory, 'mutated-adapter.py');
  await writeFile(
    mutatedScriptPath,
    `open(${JSON.stringify(marker)}, "w").write("executed")\n`,
  );
  const mutatedScript = await filePin(mutatedScriptPath);
  const session = createVerifiedPersistentAdapter(fixture, {
    preSpawnVerify: async () => {
      fixture.adapter.executable = mutatedExecutable;
      fixture.adapter.script = mutatedScript;
      fixture.adapter.workingDirectory = path.join(fixture.outputDirectory, 'missing-cwd');
    },
  });
  try {
    const result = await session.execute({
      manifest: fixture.manifest,
      record: attemptRecord(fixture.manifest, fixture.manifest.warmup),
    });
    assert.equal(result.status, 'success');
    await assert.rejects(stat(marker), { code: 'ENOENT' });
  } finally {
    await session.close();
  }
});
