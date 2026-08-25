import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { acquireConfinedRunLock } from './confined-run-lock.mjs';
import {
  assertBundledHelperSource,
  createConfinedOutputStore,
  validateConfinedOutputReadyFrame,
} from './confined-output-store.mjs';
import { sha256Receipt } from './manifest.mjs';
import {
  MAX_ADAPTER_OUTPUT_BYTES,
  MAX_ARTIFACT_BYTES,
  MAX_CONFINED_PROTOCOL_BYTES,
} from './limits.mjs';

async function canonicalTemp(templatePath) {
  return realpath(await mkdtemp(templatePath));
}

async function waitFor(predicate, label, timeoutMilliseconds = 8_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function fakeHelperSource(body) {
  return `
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
const protocolVersion = 'lofiever-confined-output-v1';
const handle = await open('.', constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
const stats = await handle.stat({ bigint: true });
const root = {
  device: String(stats.dev),
  inode: String(stats.ino),
  uid: Number(stats.uid),
  mode: Number(stats.mode & 0o7777n),
};
process.stdout.write(JSON.stringify({ protocolVersion, type: 'ready', root }) + '\\n');
function acknowledgeReady(request) {
  if (request.type !== 'confirm-ready') return false;
  process.stdout.write(JSON.stringify({
    protocolVersion,
    requestId: request.requestId,
    type: 'ready-confirmed',
  }) + '\\n');
  return true;
}
${body}
`;
}

async function closeIgnoringFatal(store) {
  await store?.close().catch(() => {});
}

test('validates the exact helper ready handshake', () => {
  const identity = { device: '1', inode: '2', uid: 501, mode: 0o700 };
  assert.deepEqual(
    validateConfinedOutputReadyFrame(
      {
        protocolVersion: 'lofiever-confined-output-v1',
        type: 'ready',
        root: identity,
      },
      identity,
    ).root,
    identity,
  );
  assert.throws(
    () => validateConfinedOutputReadyFrame(
      {
        protocolVersion: 'lofiever-confined-output-v1',
        type: 'ready',
        root: { ...identity, extra: true },
      },
      identity,
    ),
    { code: 'manifest_store_protocol_invalid' },
  );
});

test('anchors bundled helper bytes to a parent-module digest literal', async () => {
  const source = await readFile(
    new URL('./manifest-store-helper.mjs', import.meta.url),
  );
  assert.match(assertBundledHelperSource(source), /^sha256:[0-9a-f]{64}$/u);
  const helperText = source.toString('utf8');
  assert.match(helperText, new RegExp(
    `MAX_FILE_BYTES = ${MAX_ARTIFACT_BYTES / 1024 / 1024} \\* 1024 \\* 1024`,
    'u',
  ));
  assert.match(helperText, new RegExp(
    `MAX_FRAME_BYTES = ${MAX_CONFINED_PROTOCOL_BYTES / 1024 / 1024} \\* 1024 \\* 1024`,
    'u',
  ));
  assert.throws(
    () => assertBundledHelperSource(Buffer.concat([source, Buffer.from('\n')])),
    { code: 'manifest_store_helper_digest_mismatch' },
  );
});

test('closes the pinned output root when helper capture fails before spawn', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-capture-'));
  const captureError = new Error('injected helper capture failure');
  const before = (await readdir('/dev/fd')).length;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    let unexpectedStore = null;
    try {
      await assert.rejects(
        async () => {
          unexpectedStore = await createConfinedOutputStore(root, {
            testOnlyCaptureHelper: async () => {
              throw captureError;
            },
          });
        },
        (error) => error === captureError,
      );
    } finally {
      await closeIgnoringFatal(unexpectedStore);
    }
  }

  const after = (await readdir('/dev/fd')).length;
  assert.equal(after, before);
});

test('writes and rereads exact persisted bytes through one confined helper', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-basic-'));
  const store = await createConfinedOutputStore(root);
  try {
    const receipt = await store.writeFile('manifests/d150-b1.json', '{"ok":true}\n');
    const persisted = await store.readFile('manifests/d150-b1.json');
    assert.equal(receipt.uid, process.getuid());
    assert.equal(receipt.mode & 0o777, 0o600);
    assert.equal(persisted.bytes.toString('utf8'), '{"ok":true}\n');
    assert.deepEqual(persisted.receipt, receipt);
  } finally {
    await store.close();
  }
});

test('exclusive create and CAS replacement reread legitimate manifests above 64 KiB', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-large-text-'));
  const store = await createConfinedOutputStore(root);
  try {
    const firstBytes = `${'A'.repeat(96 * 1024)}\n`;
    const secondBytes = `${'B'.repeat(192 * 1024)}\n`;
    const first = await store.createExclusiveFile('manifests/large.json', firstBytes);
    assert.equal(first.bytes, Buffer.byteLength(firstBytes));
    const second = await store.replaceFile('manifests/large.json', first, secondBytes);
    assert.equal(second.bytes, Buffer.byteLength(secondBytes));
    assert.equal(
      (await store.readFile('manifests/large.json', { maxBytes: second.bytes })).bytes.toString(),
      secondBytes,
    );

    const oversized = 'X'.repeat(MAX_ADAPTER_OUTPUT_BYTES + 1);
    await assert.rejects(
      store.createExclusiveFile('manifests/oversized.json', oversized),
      {
        code: 'manifest_store_file_too_large',
        details: { bytes: MAX_ADAPTER_OUTPUT_BYTES + 1, maxBytes: MAX_ADAPTER_OUTPUT_BYTES },
      },
    );
    await assert.rejects(stat(path.join(root, 'manifests', 'oversized.json')), { code: 'ENOENT' });
  } finally {
    await store.close();
  }
});

test('retains directory identities and rejects a regular-directory replacement', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-dir-swap-'));
  const store = await createConfinedOutputStore(root);
  const manifests = path.join(root, 'manifests');
  const moved = path.join(root, 'manifests-original');
  try {
    await store.ensureDirectory('manifests');
    await rename(manifests, moved);
    await mkdir(manifests, { mode: 0o700 });
    await writeFile(path.join(manifests, 'sentinel.txt'), 'replacement sentinel\n');
    await assert.rejects(
      store.writeFile('manifests/d150-b1.json', '{}\n'),
      { code: 'confined_directory_changed' },
    );
    assert.equal(
      await readFile(path.join(manifests, 'sentinel.txt'), 'utf8'),
      'replacement sentinel\n',
    );
    await assert.rejects(stat(path.join(manifests, 'd150-b1.json')), { code: 'ENOENT' });
  } finally {
    await closeIgnoringFatal(store);
  }
});

test('rejects final symlinks without changing their external targets', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-leaf-link-'));
  const outside = path.join(root, 'outside.txt');
  const output = path.join(root, 'output');
  await mkdir(output, { mode: 0o700 });
  await writeFile(outside, 'outside sentinel\n');
  await symlink(outside, path.join(output, 'benchmark-index.v1.json'));
  const store = await createConfinedOutputStore(output);
  try {
    await assert.rejects(
      store.writeFile('benchmark-index.v1.json', '{"unsafe":true}\n'),
      { code: 'confined_file_changed' },
    );
    assert.equal(await readFile(outside, 'utf8'), 'outside sentinel\n');
    assert.equal((await lstat(path.join(output, 'benchmark-index.v1.json'))).isSymbolicLink(), true);
  } finally {
    await closeIgnoringFatal(store);
  }
});

test('rejects an intermediate output-root symlink before spawning its helper', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-root-link-'));
  const trusted = path.join(root, 'trusted');
  const outside = path.join(root, 'outside');
  const outsideOutput = path.join(outside, 'output');
  const marker = path.join(root, 'helper-spawned');
  await mkdir(trusted, { mode: 0o700 });
  await mkdir(outsideOutput, { recursive: true, mode: 0o700 });
  await writeFile(path.join(outsideOutput, 'sentinel.txt'), 'outside sentinel\n');
  await symlink(outside, path.join(trusted, 'link'));
  const hostileHelper = `
import { writeFile } from 'node:fs/promises';
await writeFile(${JSON.stringify(marker)}, 'spawned');
await new Promise(() => {});
`;
  await assert.rejects(
    createConfinedOutputStore(path.join(trusted, 'link', 'output'), {
      testOnlyHelperSource: hostileHelper,
      startupTimeoutMilliseconds: 25,
    }),
    { code: 'confined_output_root_not_canonical' },
  );
  await assert.rejects(stat(marker), { code: 'ENOENT' });
  assert.deepEqual(await readdir(outsideOutput), ['sentinel.txt']);
});

test('detects same-inode rewrites between write/read receipts', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-rewrite-'));
  const target = path.join(root, 'manifests', 'd150-b1.json');
  let phase = 'write';
  let writeMutation = false;
  let readMutation = false;
  const store = await createConfinedOutputStore(root, {
    lifecycleObserver: async (event) => {
      if (
        phase === 'write' &&
        event.type === 'write-complete' &&
        event.path === 'manifests/d150-b1.json' &&
        !writeMutation
      ) {
        const before = await stat(target);
        await writeFile(target, 'BBBB\n');
        assert.equal((await stat(target)).ino, before.ino);
        writeMutation = true;
      } else if (
        phase === 'read' &&
        event.type === 'read-complete' &&
        event.path === 'manifests/d150-b1.json' &&
        !readMutation
      ) {
        const before = await stat(target);
        await writeFile(target, 'DDDD\n');
        assert.equal((await stat(target)).ino, before.ino);
        readMutation = true;
      }
    },
  });
  try {
    await assert.rejects(
      store.writeFile('manifests/d150-b1.json', 'AAAA\n'),
      { code: 'confined_file_changed' },
    );
    assert.equal(writeMutation, true);
    phase = 'none';
    await store.writeFile('manifests/d150-b1.json', 'CCCC\n');
    phase = 'read';
    await assert.rejects(
      store.readFile('manifests/d150-b1.json'),
      { code: 'confined_file_changed' },
    );
    assert.equal(readMutation, true);
  } finally {
    await closeIgnoringFatal(store);
  }
});

test('never respawns or falls back after its pinned helper dies', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-death-'));
  const store = await createConfinedOutputStore(root);
  const helperPid = store.helperProcessId;
  process.kill(helperPid, 'SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 25));
  try {
    await assert.rejects(
      store.writeFile('manifests/d150-b1.json', '{}\n'),
      { code: 'manifest_store_helper_exited' },
    );
    await assert.rejects(
      store.writeFile('manifests/d150-b1.json', '{}\n'),
      { code: 'manifest_store_helper_exited' },
    );
    assert.equal(store.helperProcessId, helperPid);
    await assert.rejects(stat(path.join(root, 'manifests', 'd150-b1.json')), {
      code: 'ENOENT',
    });
  } finally {
    await closeIgnoringFatal(store);
  }
});

test('stale recovery waits for an orphaned helper paused before publication', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-helper-orphan-'));
  const holderScriptPath = path.join(root, 'holder.mjs');
  const readyPath = path.join(root, 'holder-ready.json');
  const pausedPath = path.join(root, 'helper-paused');
  const releasePath = path.join(root, 'helper-release');
  const helperPath = new URL('./manifest-store-helper.mjs', import.meta.url);
  const storeModule = new URL('./confined-output-store.mjs', import.meta.url).href;
  const lockModule = new URL('./confined-run-lock.mjs', import.meta.url).href;
  const holderSource = `
import { readFile, writeFile } from 'node:fs/promises';
import { createConfinedOutputStore } from ${JSON.stringify(storeModule)};
import { acquireConfinedRunLock } from ${JSON.stringify(lockModule)};
const root = ${JSON.stringify(root)};
let helperSource = await readFile(${JSON.stringify(helperPath.pathname)}, 'utf8');
helperSource = helperSource.replace(
  "import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';",
  "import { access, link, lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';",
);
helperSource = helperSource.replace(
  '      await rename(temporaryName, name);',
  ${JSON.stringify(`      await writeFile(${JSON.stringify(pausedPath)}, 'paused\\n');
      while (true) {
        try { await access(${JSON.stringify(releasePath)}); break; }
        catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
      }
      await rename(temporaryName, name);`)},
);
const store = await createConfinedOutputStore(root, { testOnlyHelperSource: helperSource });
const lock = await acquireConfinedRunLock(store);
await writeFile(${JSON.stringify(readyPath)}, JSON.stringify({ helperPid: store.helperProcessId }));
await store.writeFile('manifests/pending.json', '{"pending":true}\\n');
await new Promise(() => {});
`;
  await writeFile(holderScriptPath, holderSource, { mode: 0o600 });
  const holder = spawn(process.execPath, [holderScriptPath], {
    env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    shell: false,
    stdio: 'ignore',
  });
  const holderExit = new Promise((resolve) => {
    holder.once('close', (code, signal) => resolve({ code, signal }));
  });
  let helperPid = null;
  let contenderStore = null;
  let contenderLock = null;
  try {
    await waitFor(async () => {
      try {
        helperPid = JSON.parse(await readFile(readyPath, 'utf8')).helperPid;
        return Number.isInteger(helperPid) && helperPid > 0;
      } catch {
        return false;
      }
    }, 'holder helper identity');
    await waitFor(async () => {
      try {
        return (await readFile(pausedPath, 'utf8')) === 'paused\n';
      } catch {
        return false;
      }
    }, 'helper pre-publication pause');
    const lockPath = path.join(root, 'benchmark-run.lock');
    const owner = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(owner.pid, holder.pid);
    assert.equal(owner.helperPid, helperPid);
    assert.match(owner.helperProcessStartIdentity, /^sha256:[a-f0-9]{64}$/u);
    const lockBefore = await readFile(lockPath);

    process.kill(holder.pid, 'SIGKILL');
    await holderExit;
    contenderStore = await createConfinedOutputStore(root);
    await assert.rejects(acquireConfinedRunLock(contenderStore), {
      code: 'benchmark_locked',
    });
    assert.deepEqual(await readFile(lockPath), lockBefore);
    await assert.rejects(stat(path.join(root, 'manifests', 'pending.json')), { code: 'ENOENT' });

    await writeFile(releasePath, 'release\n');
    await waitFor(() => {
      try {
        process.kill(helperPid, 0);
        return false;
      } catch (error) {
        return error?.code === 'ESRCH';
      }
    }, 'orphaned helper exit');
    assert.equal(
      await readFile(path.join(root, 'manifests', 'pending.json'), 'utf8'),
      '{"pending":true}\n',
    );

    contenderLock = await acquireConfinedRunLock(contenderStore);
    contenderStore.bindTerminalRelease(await contenderLock.prepareTerminalRelease());
    await contenderStore.close();
    contenderStore = null;
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL');
    if (Number.isInteger(helperPid)) {
      try { process.kill(helperPid, 'SIGKILL'); } catch {}
    }
    await closeIgnoringFatal(contenderStore);
  }
});

test('terminal shutdown release fails closed before and after its final unlink', async (t) => {
  const reviewedSource = await readFile(
    new URL('./manifest-store-helper.mjs', import.meta.url),
    'utf8',
  );

  await t.test('a crash before unlink retains the exact lock', async () => {
    const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-terminal-pre-unlink-'));
    const helperSource = reviewedSource.replace(
      '    const removed = await removeStableFile(request.lockPath, request.expectedLock);',
      "    process.exit(92);\n    const removed = await removeStableFile(request.lockPath, request.expectedLock);",
    );
    assert.notEqual(helperSource, reviewedSource);
    const store = await createConfinedOutputStore(root, { testOnlyHelperSource: helperSource });
    const lock = await acquireConfinedRunLock(store);
    const lockPath = path.join(root, 'benchmark-run.lock');
    const before = await readFile(lockPath);
    store.bindTerminalRelease(await lock.prepareTerminalRelease());
    const closeStartedAt = Date.now();
    await assert.rejects(store.close(), /helper|shutdown|exited/iu);
    assert.ok(Date.now() - closeStartedAt < 5_000, 'pre-unlink crash must reject promptly');
    assert.deepEqual(await readFile(lockPath), before);
  });

  await t.test('a crash after unlink cannot perform a late filesystem mutation', async () => {
    const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-terminal-post-unlink-'));
    const lateMarker = path.join(root, 'late-mutation');
    const helperSource = reviewedSource.replace(
      '    const removed = await removeStableFile(request.lockPath, request.expectedLock);',
      `    const removed = await removeStableFile(request.lockPath, request.expectedLock);\n    process.exit(93);\n    await writeStableFile(${JSON.stringify(path.basename(lateMarker))}, 'late\\n');`,
    );
    assert.notEqual(helperSource, reviewedSource);
    const store = await createConfinedOutputStore(root, { testOnlyHelperSource: helperSource });
    const lock = await acquireConfinedRunLock(store);
    store.bindTerminalRelease(await lock.prepareTerminalRelease());
    const closeStartedAt = Date.now();
    await assert.rejects(store.close(), /helper|shutdown|exited/iu);
    assert.ok(Date.now() - closeStartedAt < 5_000, 'post-unlink crash must reject promptly');
    await assert.rejects(stat(path.join(root, 'benchmark-run.lock')), { code: 'ENOENT' });
    await assert.rejects(stat(lateMarker), { code: 'ENOENT' });
  });

  await t.test('binding terminal release rejects every later nonterminal request', async () => {
    const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-terminal-trailing-'));
    const store = await createConfinedOutputStore(root);
    const lock = await acquireConfinedRunLock(store);
    store.bindTerminalRelease(await lock.prepareTerminalRelease());
    await assert.rejects(
      store.writeFile('manifests/late.json', '{}\n'),
      { code: 'manifest_store_terminal_release_bound' },
    );
    await store.close();
    await assert.rejects(stat(path.join(root, 'manifests', 'late.json')), { code: 'ENOENT' });
    await assert.rejects(stat(path.join(root, 'benchmark-run.lock')), { code: 'ENOENT' });
  });
});

test('keeps confined lock, cleanup guard, and release operations inside the pinned root', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-confined-lock-basic-'));
  const store = await createConfinedOutputStore(root);
  try {
    const lock = await acquireConfinedRunLock(store);
    await lock.armCleanupPending();
    await lock.recordCleanupProcessGroup(424242);
    await lock.clearCleanupPending({ processGroupAbsent: true });
    store.bindTerminalRelease(await lock.prepareTerminalRelease());
    await store.close();
    await assert.rejects(stat(path.join(root, 'benchmark-run.lock')), { code: 'ENOENT' });
    await assert.rejects(
      stat(path.join(root, 'benchmark-run.lock.cleanup-unproven')),
      { code: 'ENOENT' },
    );
  } finally {
    await closeIgnoringFatal(store);
  }
});

test('confined lock captures one hostname and blocks on observer drift', async () => {
  const root = await canonicalTemp(
    path.join(os.tmpdir(), 'lofiever-confined-lock-hostname-'),
  );
  const store = await createConfinedOutputStore(root);
  let holderObservations = 0;
  const holder = await acquireConfinedRunLock(store, 'benchmark-run', {
    observeHostname: () => {
      holderObservations += 1;
      return 'host-a';
    },
  });
  try {
    assert.equal(holderObservations, 1);
    const before = await readFile(path.join(root, 'benchmark-run.lock'));
    let contenderObservations = 0;
    await assert.rejects(
      acquireConfinedRunLock(store, 'benchmark-run', {
        observeHostname: () => {
          contenderObservations += 1;
          return contenderObservations === 1 ? 'host-a' : 'host-b';
        },
      }),
      { code: 'benchmark_lock_identity_uncertain' },
    );
    assert.equal(contenderObservations, 2);
    assert.deepEqual(await readFile(path.join(root, 'benchmark-run.lock')), before);
    assert.equal(
      (await readdir(root)).some((name) => name.includes('.stale-')),
      false,
    );
  } finally {
    store.bindTerminalRelease(await holder.prepareTerminalRelease());
    await closeIgnoringFatal(store);
  }
});

test('fails closed if the output root is replaced during confined lock acquisition', async () => {
  const parent = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-confined-lock-root-swap-'));
  const root = path.join(parent, 'output');
  const moved = path.join(parent, 'output-original');
  await mkdir(root, { mode: 0o700 });
  let swapped = false;
  const store = await createConfinedOutputStore(root, {
    lifecycleObserver: async (event) => {
      if (
        !swapped &&
        event.type === 'create-exclusive-complete' &&
        event.path === 'benchmark-run.lock.recovery'
      ) {
        swapped = true;
        await rename(root, moved);
        await mkdir(root, { mode: 0o700 });
        await writeFile(path.join(root, 'sentinel.txt'), 'replacement root\n');
      }
    },
  });
  try {
    await assert.rejects(acquireConfinedRunLock(store), {
      code: 'private_directory_changed',
    });
    assert.equal(await readFile(path.join(root, 'sentinel.txt'), 'utf8'), 'replacement root\n');
    assert.deepEqual(await readdir(root), ['sentinel.txt']);
  } finally {
    await closeIgnoringFatal(store);
  }
});

test('rename cannot quarantine a replacement created after stale-lock observation', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-confined-lock-rename-cas-'));
  const store = await createConfinedOutputStore(root);
  const recoveryPath = path.join(root, 'benchmark-run.lock.recovery');
  const quarantinePath = path.join(root, 'benchmark-run.lock.recovery.stale-hostile');
  try {
    await store.createExclusiveFile('benchmark-run.lock.recovery', 'stale owner\n');
    const observed = await store.readFile('benchmark-run.lock.recovery');
    await writeFile(recoveryPath, 'live replacement owner\n');
    const replacement = await readFile(recoveryPath);

    await assert.rejects(
      store.renameFile(
        'benchmark-run.lock.recovery',
        'benchmark-run.lock.recovery.stale-hostile',
        observed.receipt,
      ),
      { code: 'benchmark_lock_identity_changed' },
    );
    assert.deepEqual(await readFile(recoveryPath), replacement);
    await assert.rejects(stat(quarantinePath), { code: 'ENOENT' });
  } finally {
    await closeIgnoringFatal(store);
  }
});

test('stale recovery retries identity drift but rejects a malformed replacement', async () => {
  const root = await canonicalTemp(
    path.join(os.tmpdir(), 'lofiever-confined-lock-malformed-replacement-'),
  );
  const recoveryPath = path.join(root, 'benchmark-run.lock.recovery');
  const staleOwner = {
    schemaVersion: '1.1.0',
    pid: 99_999_991,
    helperPid: 99_999_992,
    hostname: os.hostname(),
    processIdentity: `sha256:${'1'.repeat(64)}`,
    processStartIdentity: `sha256:${'2'.repeat(64)}`,
    helperProcessStartIdentity: `sha256:${'4'.repeat(64)}`,
    acquisitionIdentity: `sha256:${'3'.repeat(64)}`,
    acquiredAt: '2026-08-25T00:00:00.000Z',
  };
  const seedStore = await createConfinedOutputStore(root);
  await seedStore.createExclusiveFile(
    'benchmark-run.lock.recovery',
    `${JSON.stringify(staleOwner)}\n`,
  );
  await seedStore.close();

  const malformed = Buffer.from('{"schemaVersion":\n');
  let recoveryReads = 0;
  const store = await createConfinedOutputStore(root, {
    lifecycleObserver: async (event) => {
      if (event.type !== 'read-complete' || event.path !== 'benchmark-run.lock.recovery') return;
      recoveryReads += 1;
      if (recoveryReads === 2) await writeFile(recoveryPath, malformed);
    },
  });
  try {
    await assert.rejects(acquireConfinedRunLock(store), {
      code: 'benchmark_lock_invalid',
    });
    assert.deepEqual(await readFile(recoveryPath), malformed);
    assert.equal(
      (await readdir(root)).some((name) => name.includes('.stale-')),
      false,
    );
  } finally {
    await closeIgnoringFatal(store);
  }
});

test('concurrent stale-recovery contenders cannot quarantine the winner', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-confined-lock-recovery-race-'));
  const staleOwner = {
    schemaVersion: '1.1.0',
    pid: 99_999_991,
    helperPid: 99_999_992,
    hostname: os.hostname(),
    processIdentity: `sha256:${'1'.repeat(64)}`,
    processStartIdentity: `sha256:${'2'.repeat(64)}`,
    helperProcessStartIdentity: `sha256:${'4'.repeat(64)}`,
    acquisitionIdentity: `sha256:${'3'.repeat(64)}`,
    acquiredAt: '2026-08-25T00:00:00.000Z',
  };
  const staleBytes = Buffer.from(`${JSON.stringify(staleOwner)}\n`);
  const seedStore = await createConfinedOutputStore(root);
  await seedStore.createExclusiveFile('benchmark-run.lock.recovery', staleBytes.toString('utf8'));
  await seedStore.close();

  let barrierArrivals = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => {
    releaseBarrier = resolve;
  });
  const readCounts = new Map();
  const observer = (name) => async (event) => {
    if (
      event.type !== 'read-complete' ||
      event.path !== 'benchmark-run.lock.recovery'
    ) return;
    const count = (readCounts.get(name) ?? 0) + 1;
    readCounts.set(name, count);
    if (count !== 2) return;
    barrierArrivals += 1;
    if (barrierArrivals === 2) releaseBarrier();
    await barrier;
  };
  const storeA = await createConfinedOutputStore(root, { lifecycleObserver: observer('a') });
  const storeB = await createConfinedOutputStore(root, { lifecycleObserver: observer('b') });
  let winner = null;
  let results = [];
  try {
    results = await Promise.allSettled([
      acquireConfinedRunLock(storeA),
      acquireConfinedRunLock(storeB),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    const resultSummary = results.map((result) =>
      result.status === 'fulfilled'
        ? 'fulfilled'
        : `${result.reason?.code ?? result.reason?.name}:${result.reason?.message}:${JSON.stringify(result.reason?.details ?? {})}`);
    assert.equal(fulfilled.length, 1, JSON.stringify(resultSummary));
    assert.equal(rejected.length, 1, JSON.stringify(resultSummary));
    assert.match(
      rejected[0].reason.code,
      /benchmark_lock_(?:recovery_in_progress|race)|benchmark_locked/u,
      JSON.stringify(resultSummary),
    );
    winner = fulfilled[0].value;

    const names = await readdir(root);
    const staleQuarantines = names.filter((name) =>
      name.startsWith('benchmark-run.lock.recovery.stale-'));
    assert.equal(staleQuarantines.length, 1);
    assert.deepEqual(await readFile(path.join(root, staleQuarantines[0])), staleBytes);
    assert.equal(names.includes('benchmark-run.lock'), true);
    assert.equal(names.includes('benchmark-run.lock.recovery'), false);
  } finally {
    if (winner !== null) {
      const winnerStore = results.findIndex((result) => result.status === 'fulfilled') === 0
        ? storeA
        : storeB;
      winnerStore.bindTerminalRelease(await winner.prepareTerminalRelease());
    }
    await closeIgnoringFatal(storeA);
    await closeIgnoringFatal(storeB);
  }
});

test('guard state replacement cannot be overwritten by record or mark transitions', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-confined-lock-cas-'));
  const store = await createConfinedOutputStore(root);
  const sentinelPath = path.join(root, 'benchmark-run.lock.cleanup-unproven');
  try {
    const lock = await acquireConfinedRunLock(store);
    await lock.armCleanupPending();
    const pendingBytes = await readFile(sentinelPath);
    const pending = JSON.parse(pendingBytes.toString('utf8'));
    const unproven = {
      ...pending,
      state: 'cleanup-unproven',
      errorCode: 'hostile_replacement',
      priorErrorCode: null,
    };
    unproven.errorDetailsSha256 = sha256Receipt(JSON.stringify({
      state: unproven.state,
      code: unproven.errorCode,
      processGroupId: unproven.processGroupId,
      priorErrorCode: unproven.priorErrorCode,
    }));
    const unprovenBytes = Buffer.from(`${JSON.stringify(unproven)}\n`);

    await writeFile(sentinelPath, unprovenBytes);
    await assert.rejects(lock.recordCleanupProcessGroup(424242), {
      code: 'benchmark_cleanup_guard_identity_changed',
    });
    assert.deepEqual(await readFile(sentinelPath), unprovenBytes);

    await writeFile(sentinelPath, pendingBytes);
    const cleanupError = Object.assign(new Error('cleanup uncertain'), {
      code: 'executor_cleanup_unproven',
      cleanupUnproven: true,
      details: { processGroupId: 424242 },
    });
    await writeFile(sentinelPath, unprovenBytes);
    await assert.rejects(lock.markCleanupUnproven(cleanupError), {
      code: 'benchmark_cleanup_guard_identity_changed',
    });
    assert.deepEqual(await readFile(sentinelPath), unprovenBytes);

    await writeFile(sentinelPath, pendingBytes);
    await lock.clearCleanupPending({ processGroupAbsent: true });
    store.bindTerminalRelease(await lock.prepareTerminalRelease());
  } finally {
    await closeIgnoringFatal(store);
  }
});

test('mismatched or orphan cleanup guards block automatic recovery without mutation', async () => {
  for (const mode of ['mismatched-owner', 'missing-lock']) {
    const root = await canonicalTemp(path.join(os.tmpdir(), `lofiever-confined-lock-${mode}-`));
    const lockOwner = {
      schemaVersion: '1.1.0',
      pid: 99999991,
      helperPid: 99999992,
      hostname: os.hostname(),
      processIdentity: `sha256:${'1'.repeat(64)}`,
      processStartIdentity: `sha256:${'2'.repeat(64)}`,
      helperProcessStartIdentity: `sha256:${'5'.repeat(64)}`,
      acquisitionIdentity: `sha256:${'3'.repeat(64)}`,
      acquiredAt: '2026-08-25T00:00:00.000Z',
    };
    const guardOwner = mode === 'mismatched-owner'
      ? { ...lockOwner, acquisitionIdentity: `sha256:${'4'.repeat(64)}` }
      : lockOwner;
    const guard = {
      schemaVersion: 'cleanup-guard-v1',
      state: 'cleanup-pending',
      owner: guardOwner,
      errorCode: null,
      priorErrorCode: null,
      processGroupId: 99999992,
      errorDetailsSha256: null,
      recordedAt: '2026-08-25T00:00:00.000Z',
    };
    guard.errorDetailsSha256 = sha256Receipt(JSON.stringify({
      state: guard.state,
      processGroupId: guard.processGroupId,
    }));
    if (mode !== 'missing-lock') {
      await writeFile(path.join(root, 'benchmark-run.lock'), `${JSON.stringify(lockOwner)}\n`, {
        mode: 0o600,
      });
    }
    const guardPath = path.join(root, 'benchmark-run.lock.cleanup-unproven');
    const guardBytes = Buffer.from(`${JSON.stringify(guard)}\n`);
    await writeFile(guardPath, guardBytes, { mode: 0o600 });
    const store = await createConfinedOutputStore(root);
    try {
      await assert.rejects(acquireConfinedRunLock(store), {
        code: 'benchmark_lock_cleanup_unproven',
      });
      assert.deepEqual(await readFile(guardPath), guardBytes);
    } finally {
      await store.close();
    }
  }
});

test('bounds startup and rejects ready trailing fragments', async () => {
  const noReadyRoot = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-no-ready-'));
  await assert.rejects(
    createConfinedOutputStore(noReadyRoot, {
      startupTimeoutMilliseconds: 20,
      testOnlyHelperSource: 'setInterval(() => {}, 1000);',
    }),
    { code: 'manifest_store_startup_timeout' },
  );

  const trailingRoot = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-ready-tail-'));
  await assert.rejects(
    createConfinedOutputStore(trailingRoot, {
      requestTimeoutMilliseconds: 100,
      testOnlyHelperSource: fakeHelperSource(`
process.stdout.write('x');
process.stdin.on('data', (chunk) => {
  const request = JSON.parse(chunk.toString('utf8').trim());
  acknowledgeReady(request);
});
setInterval(() => {}, 1000);
`),
    }),
    (error) => {
      assert.match(error.code, /^manifest_store_(?:trailing_output|protocol_invalid)$/u);
      return true;
    },
  );
});

test('rejects a same-length forged write receipt and a nonzero acknowledged shutdown', async () => {
  const forgedRoot = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-forged-'));
  const forgedStore = await createConfinedOutputStore(forgedRoot, {
    requestTimeoutMilliseconds: 100,
    testOnlyHelperSource: fakeHelperSource(`
process.stdin.on('data', (chunk) => {
  const request = JSON.parse(chunk.toString('utf8').trim());
  if (acknowledgeReady(request)) return;
  process.stdout.write(JSON.stringify({
    protocolVersion,
    requestId: request.requestId,
    type: 'write-complete',
    path: request.path,
    file: {
      bytes: Buffer.byteLength(request.data, 'utf8'),
      device: root.device,
      inode: '999',
      uid: root.uid,
      mode: 0o600,
      size: String(Buffer.byteLength(request.data, 'utf8')),
      mtimeNs: '1',
      ctimeNs: '1',
      sha256: 'sha256:' + '0'.repeat(64),
    },
  }) + '\\n');
});
`),
  });
  try {
    await assert.rejects(
      forgedStore.writeFile('manifest.json', 'same\n'),
      { code: 'manifest_store_protocol_invalid' },
    );
  } finally {
    await closeIgnoringFatal(forgedStore);
  }

  const exitRoot = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-output-store-exit-'));
  const exitStore = await createConfinedOutputStore(exitRoot, {
    requestTimeoutMilliseconds: 100,
    testOnlyHelperSource: fakeHelperSource(`
process.stdin.on('data', (chunk) => {
  const request = JSON.parse(chunk.toString('utf8').trim());
  if (acknowledgeReady(request)) return;
  process.stdout.write(JSON.stringify({
    protocolVersion,
    requestId: request.requestId,
    type: 'shutdown-complete',
  }) + '\\n', () => process.exit(7));
});
`),
  });
  await assert.rejects(exitStore.close(), { code: 'manifest_store_shutdown_invalid' });
});
