import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BenchmarkStorageError,
  acquireRunLock,
  openPrivateDirectory,
  readFileNoFollow,
  writeFileAtomicDurable,
} from './storage.mjs';

function firstLine(stream) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for lock-process output.'));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      stream.off('data', onData);
      stream.off('error', onError);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      buffered += chunk.toString('utf8');
      const newline = buffered.indexOf('\n');
      if (newline === -1) return;
      cleanup();
      resolve(buffered.slice(0, newline));
    };
    stream.on('data', onData);
    stream.on('error', onError);
  });
}

test('serializes writers with an exclusive process lock', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-'));
  const manifestPath = path.join(directory, 'manifest.json');
  const first = await acquireRunLock(manifestPath);

  await assert.rejects(acquireRunLock(manifestPath), (error) => {
    assert.equal(error instanceof BenchmarkStorageError, true);
    assert.equal(error.code, 'benchmark_locked');
    assert.equal(error.details.owner.pid, process.pid);
    assert.match(error.details.owner.processIdentity, /^sha256:[a-f0-9]{64}$/);
    assert.match(error.details.owner.processStartIdentity, /^sha256:[a-f0-9]{64}$/);
    assert.match(error.details.owner.acquisitionIdentity, /^sha256:[a-f0-9]{64}$/);
    return true;
  });
  await first.release();

  const next = await acquireRunLock(manifestPath);
  await next.release();
});

test('captures one hostname per lock identity and never quarantines on observer drift', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-hostname-'));
  const lockTarget = path.join(directory, 'metal');
  let holderObservations = 0;
  const holder = await acquireRunLock(lockTarget, {
    observeHostname: () => {
      holderObservations += 1;
      return 'host-a';
    },
  });
  assert.equal(holderObservations, 1);
  const lockPath = `${lockTarget}.lock`;
  const before = await readFile(lockPath);
  let contenderObservations = 0;
  await assert.rejects(
    acquireRunLock(lockTarget, {
      observeHostname: () => {
        contenderObservations += 1;
        return contenderObservations === 1 ? 'host-a' : 'host-b';
      },
    }),
    { code: 'benchmark_lock_identity_uncertain' },
  );
  assert.equal(contenderObservations, 2);
  assert.deepEqual(await readFile(lockPath), before);
  assert.equal(
    (await readdir(directory)).some((name) => name.includes('.stale-')),
    false,
  );
  await holder.release();
});

test('keeps a live process lock exclusive across divergent process locales', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-locale-'));
  const lockTarget = path.join(directory, 'metal-benchmark');
  const storageModule = new URL('./storage.mjs', import.meta.url).href;
  const childSource = `
    const { acquireRunLock } = await import(${JSON.stringify(storageModule)});
    try {
      const lock = await acquireRunLock(process.env.LOFIEVER_TEST_LOCK_TARGET);
      process.stdout.write(JSON.stringify({ status: 'acquired', pid: process.pid }) + '\\n');
      if (process.env.LOFIEVER_TEST_LOCK_ROLE === 'holder') {
        process.stdin.resume();
        await new Promise((resolve) => process.stdin.once('end', resolve));
      }
      await lock.release();
      process.exit(process.env.LOFIEVER_TEST_LOCK_ROLE === 'holder' ? 0 : 42);
    } catch (error) {
      process.stdout.write(JSON.stringify({ status: 'rejected', code: error.code }) + '\\n');
      process.exit(error.code === 'benchmark_locked' ? 0 : 43);
    }
  `;
  const spawnLockProcess = (role, locale, timezone) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', childSource],
      {
        env: {
          ...process.env,
          LANG: locale,
          LC_ALL: locale,
          TZ: timezone,
          LOFIEVER_TEST_LOCK_ROLE: role,
          LOFIEVER_TEST_LOCK_TARGET: lockTarget,
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    return { child, closed: once(child, 'close'), line: firstLine(child.stdout) };
  };

  const holder = spawnLockProcess('holder', 'C', 'UTC');
  let holderExit;
  try {
    assert.deepEqual(JSON.parse(await holder.line).status, 'acquired');
    const contender = spawnLockProcess(
      'contender',
      'pt_BR.UTF-8',
      'America/Sao_Paulo',
    );
    const contenderResult = JSON.parse(await contender.line);
    const [contenderExit] = await contender.closed;
    assert.deepEqual(contenderResult, {
      status: 'rejected',
      code: 'benchmark_locked',
    });
    assert.equal(contenderExit, 0);
  } finally {
    holder.child.stdin.end();
    [holderExit] = await holder.closed;
  }
  assert.equal(holderExit, 0);
});

test('cleanup-unproven sentinel blocks a new process after the lock owner exits', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-cleanup-'));
  const lockTarget = path.join(directory, 'metal-benchmark');
  const lockPath = `${lockTarget}.lock`;
  const sentinelPath = `${lockPath}.cleanup-unproven`;
  const storageModule = new URL('./storage.mjs', import.meta.url).href;
  const childSource = `
    const { acquireRunLock } = await import(${JSON.stringify(storageModule)});
    try {
      const lock = await acquireRunLock(process.env.LOFIEVER_TEST_LOCK_TARGET);
      await lock.armCleanupPending();
      await lock.recordCleanupProcessGroup(process.pid);
      await lock.markCleanupUnproven({
        code: 'executor_process_group_alive',
        cleanupUnproven: true,
        details: { processGroupId: process.pid },
      });
      process.stdout.write(JSON.stringify({ status: 'marked' }) + '\\n');
      process.exit(0);
    } catch (error) {
      process.stdout.write(JSON.stringify({ status: 'failed', code: error.code }) + '\\n');
      process.exit(43);
    }
  `;
  const marker = spawn(
    process.execPath,
    ['--input-type=module', '--eval', childSource],
    {
      env: {
        ...process.env,
        LOFIEVER_TEST_LOCK_TARGET: lockTarget,
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const closed = once(marker, 'close');
  try {
    assert.deepEqual(JSON.parse(await firstLine(marker.stdout)), { status: 'marked' });
    const [exitCode] = await closed;
    assert.equal(exitCode, 0);
    const sentinel = JSON.parse(await readFile(sentinelPath, 'utf8'));
    assert.equal(sentinel.state, 'cleanup-unproven');
    assert.equal(sentinel.processGroupId, marker.pid);
    assert.deepEqual(Object.keys(sentinel).sort(), [
      'errorCode',
      'errorDetailsSha256',
      'owner',
      'priorErrorCode',
      'processGroupId',
      'recordedAt',
      'schemaVersion',
      'state',
    ]);
    await assert.rejects(acquireRunLock(lockTarget), {
      code: 'benchmark_lock_cleanup_unproven',
    });
  } finally {
    await unlink(sentinelPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await unlink(lockPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
});

test('pre-arms cleanup before spawn and fails closed when guard writes or updates fail', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-guard-fault-'));
  const armTarget = path.join(directory, 'arm-failure');
  const armError = Object.assign(new Error('simulated ENOSPC before guard publish'), {
    code: 'ENOSPC',
  });
  const armLock = await acquireRunLock(armTarget, {
    onCleanupGuardWrite: async (operation) => {
      if (operation === 'arm') throw armError;
    },
  });
  await assert.rejects(armLock.armCleanupPending(), { code: 'ENOSPC' });
  await assert.rejects(readFile(`${armTarget}.lock.cleanup-unproven`), {
    code: 'ENOENT',
  });
  await armLock.release();

  const updateTarget = path.join(directory, 'update-failure');
  const updateError = Object.assign(new Error('simulated ENOSPC before PGID update'), {
    code: 'ENOSPC',
  });
  const updateLock = await acquireRunLock(updateTarget, {
    onCleanupGuardWrite: async (operation) => {
      if (operation === 'record-process-group') throw updateError;
    },
  });
  await updateLock.armCleanupPending();
  await assert.rejects(updateLock.recordCleanupProcessGroup(process.pid), {
    code: 'ENOSPC',
  });
  const pending = JSON.parse(
    await readFile(`${updateTarget}.lock.cleanup-unproven`, 'utf8'),
  );
  assert.equal(pending.state, 'cleanup-pending');
  assert.equal(pending.processGroupId, null);
  await assert.rejects(acquireRunLock(updateTarget), {
    code: 'benchmark_locked',
  });
  await updateLock.clearCleanupPending({ processGroupAbsent: true });
  await updateLock.release();
});

test('never writes unbounded cleanup error fields into a durable guard', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-guard-code-'));
  const hostile = 'raw-secret MUST_NOT_APPEAR\n';
  for (const field of ['code', 'priorErrorCode']) {
    await t.test(field, async () => {
      const lockTarget = path.join(directory, field);
      const lock = await acquireRunLock(lockTarget);
      await lock.armCleanupPending();
      await assert.rejects(
        lock.markCleanupUnproven({
          code: field === 'code' ? hostile : 'executor_process_group_alive',
          cleanupUnproven: true,
          details: {
            processGroupId: null,
            priorErrorCode: field === 'priorErrorCode' ? hostile : null,
          },
        }),
        { code: 'benchmark_cleanup_error_code_invalid' },
      );
      const bytes = await readFile(`${lockTarget}.lock.cleanup-unproven`, 'utf8');
      assert.equal(bytes.includes(hostile), false);
      assert.equal(JSON.parse(bytes).state, 'cleanup-pending');
      await lock.clearCleanupPending({ processGroupAbsent: true });
      await lock.release();
    });
  }
});

test('auto-recovers a stale pending guard only after one ESRCH process-group proof', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-pending-recovery-'));
  const lockTarget = path.join(directory, 'metal-benchmark');
  const storageModule = new URL('./storage.mjs', import.meta.url).href;
  const childSource = `
    const { acquireRunLock } = await import(${JSON.stringify(storageModule)});
    const lock = await acquireRunLock(process.env.LOFIEVER_TEST_LOCK_TARGET);
    await lock.armCleanupPending();
    await lock.recordCleanupProcessGroup(99999999);
    process.stdout.write('armed\\n');
  `;
  const marker = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
    env: { ...process.env, LOFIEVER_TEST_LOCK_TARGET: lockTarget },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(await firstLine(marker.stdout), 'armed');
  const [exitCode] = await once(marker, 'close');
  assert.equal(exitCode, 0);

  const recovered = await acquireRunLock(lockTarget);
  const names = await readdir(directory);
  assert.equal(names.some((name) => name.includes('.cleanup-unproven.recovered-')), true);
  assert.equal(names.some((name) => name.includes('.lock.stale-')), true);
  await recovered.release();
});

test('never auto-recovers a stale pending guard without a positive process-group identity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-pending-manual-'));
  const lockTarget = path.join(directory, 'metal-benchmark');
  const storageModule = new URL('./storage.mjs', import.meta.url).href;
  const childSource = `
    const { acquireRunLock } = await import(${JSON.stringify(storageModule)});
    const lock = await acquireRunLock(process.env.LOFIEVER_TEST_LOCK_TARGET);
    await lock.armCleanupPending();
    process.stdout.write('armed\\n');
  `;
  const marker = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
    env: { ...process.env, LOFIEVER_TEST_LOCK_TARGET: lockTarget },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(await firstLine(marker.stdout), 'armed');
  const [exitCode] = await once(marker, 'close');
  assert.equal(exitCode, 0);

  await assert.rejects(acquireRunLock(lockTarget), {
    code: 'benchmark_lock_cleanup_pending',
  });
  assert.equal((await readdir(directory)).includes('metal-benchmark.lock'), true);
});

test('rejects cleanup-guard field, owner, and schema tampering', async (t) => {
  const storageModule = new URL('./storage.mjs', import.meta.url).href;
  for (const mutation of [
    'pgid',
    'state',
    'extra-key',
    'owner',
    'pending-prior',
    'lock-extra-key',
    'lock-acquired-at',
  ]) {
    await t.test(mutation, async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), `lofiever-lock-guard-${mutation}-`));
      const lockTarget = path.join(directory, 'metal-benchmark');
      const lockPath = `${lockTarget}.lock`;
      const sentinelPath = `${lockTarget}.lock.cleanup-unproven`;
      const childSource = `
        const { acquireRunLock } = await import(${JSON.stringify(storageModule)});
        const lock = await acquireRunLock(process.env.LOFIEVER_TEST_LOCK_TARGET);
        await lock.armCleanupPending();
        await lock.recordCleanupProcessGroup(99999999);
        if (process.env.LOFIEVER_TEST_MUTATION === 'state') {
          await lock.markCleanupUnproven({
            code: 'executor_process_group_alive',
            cleanupUnproven: true,
            details: { processGroupId: 99999999 },
          });
        }
        process.stdout.write('armed\\n');
      `;
      const marker = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
        env: {
          ...process.env,
          LOFIEVER_TEST_LOCK_TARGET: lockTarget,
          LOFIEVER_TEST_MUTATION: mutation,
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.equal(await firstLine(marker.stdout), 'armed');
      const [exitCode] = await once(marker, 'close');
      assert.equal(exitCode, 0);

      if (mutation.startsWith('lock-')) {
        const tamperedLock = JSON.parse(await readFile(lockPath, 'utf8'));
        if (mutation === 'lock-extra-key') {
          tamperedLock.unexpected = 'not part of the lock-owner schema';
        } else {
          tamperedLock.acquiredAt = '2026-08-24T00:00:00.000Z';
        }
        await writeFile(lockPath, `${JSON.stringify(tamperedLock)}\n`, { mode: 0o600 });
      } else {
        const tampered = JSON.parse(await readFile(sentinelPath, 'utf8'));
        if (mutation === 'pgid') {
          tampered.processGroupId = 99999998;
        } else if (mutation === 'state') {
          tampered.state = 'cleanup-pending';
          tampered.errorCode = null;
          tampered.priorErrorCode = null;
        } else if (mutation === 'extra-key') {
          tampered.unexpected = 'not part of the cleanup guard schema';
        } else if (mutation === 'owner') {
          tampered.owner.pid += 1;
        } else {
          tampered.priorErrorCode = 'invisible_pending_field';
        }
        await writeFile(sentinelPath, `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
      }
      await assert.rejects(acquireRunLock(lockTarget), (error) => {
        assert.equal(
          error.code,
          mutation === 'lock-extra-key'
            ? 'benchmark_lock_invalid'
            : 'benchmark_lock_cleanup_unproven',
        );
        return true;
      });
      assert.equal((await readdir(directory)).includes('metal-benchmark.lock'), true);
    });
  }
});

test('rechecks cleanup sentinel under the recovery guard before stale quarantine', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-sentinel-race-'));
  const lockTarget = path.join(directory, 'metal-benchmark');
  const lockPath = `${lockTarget}.lock`;
  const sentinelPath = `${lockPath}.cleanup-unproven`;
  const staleOwner = {
    schemaVersion: '1.0.0',
    pid: 99999999,
    hostname: os.hostname(),
    processIdentity: `sha256:${'0'.repeat(64)}`,
    processStartIdentity: `sha256:${'1'.repeat(64)}`,
    acquisitionIdentity: `sha256:${'2'.repeat(64)}`,
    acquiredAt: '2026-08-24T00:00:00.000Z',
  };
  const staleBytes = `${JSON.stringify(staleOwner)}\n`;
  await writeFile(lockPath, staleBytes, { mode: 0o600 });

  try {
    await assert.rejects(
      acquireRunLock(lockTarget, {
        onBeforeStaleQuarantine: async () => {
          await writeFile(sentinelPath, '{}\n', { flag: 'wx', mode: 0o600 });
        },
      }),
      { code: 'benchmark_lock_cleanup_unproven' },
    );
    assert.equal(await readFile(lockPath, 'utf8'), staleBytes);
  } finally {
    for (const entry of await readdir(directory)) {
      await unlink(path.join(directory, entry));
    }
  }
});

test('rejects a machine lock that is not private to the current user', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-mode-'));
  const identityTarget = path.join(directory, 'identity-source');
  const identityLock = await acquireRunLock(identityTarget);
  const ownerBytes = await readFile(`${identityTarget}.lock`);
  await identityLock.release();

  const lockTarget = path.join(directory, 'metal-benchmark');
  const lockPath = `${lockTarget}.lock`;
  await writeFile(lockPath, ownerBytes, { mode: 0o600 });
  await chmod(lockPath, 0o644);
  await assert.rejects(acquireRunLock(lockTarget), (error) => {
    assert.equal(error.code, 'benchmark_lock_invalid');
    return true;
  });
  assert.equal(await readFile(lockPath, 'utf8'), ownerBytes.toString('utf8'));
});

test('pins a private directory and fails closed across parent path replacement', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'lofiever-private-root-'));
  const root = path.join(parent, 'staging');
  const moved = path.join(parent, 'staging-original');
  await mkdir(root, { mode: 0o700 });
  await writeFile(path.join(root, 'identity.txt'), 'original');
  const pinned = await openPrivateDirectory(root);

  await rename(root, moved);
  await mkdir(root, { mode: 0o700 });
  await writeFile(path.join(root, 'identity.txt'), 'replacement');
  assert.throws(() => pinned.resolve('identity.txt'), (error) => {
    assert.equal(error.code, 'private_directory_changed');
    return true;
  });
  await pinned.close();

  await chmod(root, 0o755);
  await assert.rejects(openPrivateDirectory(root), (error) => {
    assert.equal(error.code, 'private_directory_permissions');
    return true;
  });
});

test('quarantines an explicitly stale lock before acquiring a new identity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-stale-lock-'));
  const manifestPath = path.join(directory, 'manifest.json');
  const lockPath = `${manifestPath}.lock`;
  await writeFile(
    lockPath,
    `${JSON.stringify({
      schemaVersion: '1.0.0',
      pid: 99999999,
      hostname: os.hostname(),
      processIdentity: `sha256:${'0'.repeat(64)}`,
      processStartIdentity: `sha256:${'1'.repeat(64)}`,
      acquisitionIdentity: `sha256:${'2'.repeat(64)}`,
      acquiredAt: '2026-08-24T00:00:00.000Z',
    })}\n`,
    { mode: 0o600 },
  );

  const lock = await acquireRunLock(manifestPath);
  const entries = await readdir(directory);
  assert.equal(entries.includes('manifest.json.lock'), true);
  assert.equal(
    entries.some((name) => name.startsWith('manifest.json.lock.stale-')),
    true,
  );
  await lock.release();
});

test('treats a lock from another hostname as an identity conflict instead of stale', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-remote-lock-'));
  const lockTarget = path.join(directory, 'metal-benchmark');
  await writeFile(
    `${lockTarget}.lock`,
    `${JSON.stringify({
      schemaVersion: '1.0.0',
      pid: 99999999,
      hostname: 'another-mac.local',
      processIdentity: `sha256:${'0'.repeat(64)}`,
      processStartIdentity: `sha256:${'1'.repeat(64)}`,
      acquisitionIdentity: `sha256:${'2'.repeat(64)}`,
      acquiredAt: '2026-08-24T00:00:00.000Z',
    })}\n`,
    { mode: 0o600 },
  );

  await assert.rejects(acquireRunLock(lockTarget), (error) => {
    assert.equal(error.code, 'benchmark_lock_identity_uncertain');
    return true;
  });
  assert.deepEqual(await readdir(directory), ['metal-benchmark.lock']);
});

test('recovers a live PID lock only when its process-start identity proves PID reuse', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-reused-pid-lock-'));
  const lockTarget = path.join(directory, 'metal-benchmark');
  await writeFile(
    `${lockTarget}.lock`,
    `${JSON.stringify({
      schemaVersion: '1.0.0',
      pid: process.pid,
      hostname: os.hostname(),
      processIdentity: `sha256:${'0'.repeat(64)}`,
      processStartIdentity: `sha256:${'1'.repeat(64)}`,
      acquisitionIdentity: `sha256:${'2'.repeat(64)}`,
      acquiredAt: '2026-08-24T00:00:00.000Z',
    })}\n`,
    { mode: 0o600 },
  );

  const lock = await acquireRunLock(lockTarget);
  assert.equal(
    (await readdir(directory)).some((name) => name.includes('.stale-')),
    true,
  );
  await lock.release();
});

test('stale recovery uses compare-and-swap and cannot quarantine a replacement live lock', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-cas-'));
  const identityTarget = path.join(directory, 'identity-source');
  const identityLock = await acquireRunLock(identityTarget);
  const liveOwnerBytes = await readFile(`${identityTarget}.lock`, 'utf8');
  await identityLock.release();

  const lockTarget = path.join(directory, 'metal-benchmark');
  const lockPath = `${lockTarget}.lock`;
  await writeFile(
    lockPath,
    `${JSON.stringify({
      schemaVersion: '1.0.0',
      pid: process.pid,
      hostname: os.hostname(),
      processIdentity: `sha256:${'0'.repeat(64)}`,
      processStartIdentity: `sha256:${'1'.repeat(64)}`,
      acquisitionIdentity: `sha256:${'2'.repeat(64)}`,
      acquiredAt: '2026-08-24T00:00:00.000Z',
    })}\n`,
    { mode: 0o600 },
  );

  const acquisition = acquireRunLock(lockTarget);
  await new Promise((resolve) => setTimeout(resolve, 1));
  await rename(lockPath, `${lockPath}.observed-stale`);
  await writeFile(lockPath, liveOwnerBytes, { flag: 'wx', mode: 0o600 });

  await assert.rejects(acquisition, (error) => {
    assert.ok(
      ['benchmark_lock_identity_changed', 'benchmark_locked'].includes(error.code),
      error.code,
    );
    return true;
  });
  assert.equal(await readFile(lockPath, 'utf8'), liveOwnerBytes);
});

test('concurrent stale recovery elects exactly one lock owner', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-lock-election-'));
  const lockTarget = path.join(directory, 'metal-benchmark');
  await writeFile(
    `${lockTarget}.lock`,
    `${JSON.stringify({
      schemaVersion: '1.0.0',
      pid: 99999999,
      hostname: os.hostname(),
      processIdentity: `sha256:${'0'.repeat(64)}`,
      processStartIdentity: `sha256:${'1'.repeat(64)}`,
      acquisitionIdentity: `sha256:${'2'.repeat(64)}`,
      acquiredAt: '2026-08-24T00:00:00.000Z',
    })}\n`,
    { mode: 0o600 },
  );

  const contenders = await Promise.allSettled(
    Array.from({ length: 8 }, () => acquireRunLock(lockTarget)),
  );
  const acquired = contenders.filter((result) => result.status === 'fulfilled');
  assert.equal(acquired.length, 1);
  const rejectedCodes = contenders
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason.code);
  const rejectedReceipts = contenders
    .filter((result) => result.status === 'rejected')
    .map((result) => ({
      code: result.reason.code,
      message: result.reason.message,
      details: result.reason.details,
    }));
  assert.ok(
    rejectedCodes.every((code) =>
        [
          'benchmark_locked',
          'benchmark_lock_race',
          'benchmark_lock_recovery_in_progress',
          'benchmark_lock_identity_changed',
        ].includes(code),
      ),
    JSON.stringify(rejectedReceipts),
  );
  await acquired[0].value.release();
});

test('concurrent recovery of an abandoned recovery guard is itself serialized', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-guard-election-'));
  const lockTarget = path.join(directory, 'metal-benchmark');
  const staleOwner = {
    schemaVersion: '1.0.0',
    pid: 99999999,
    hostname: os.hostname(),
    processIdentity: `sha256:${'0'.repeat(64)}`,
    processStartIdentity: `sha256:${'1'.repeat(64)}`,
    acquisitionIdentity: `sha256:${'2'.repeat(64)}`,
    acquiredAt: '2026-08-24T00:00:00.000Z',
  };
  await writeFile(
    `${lockTarget}.lock.recovery`,
    `${JSON.stringify(staleOwner)}\n`,
    { mode: 0o600 },
  );

  const contenders = await Promise.allSettled(
    Array.from({ length: 8 }, () => acquireRunLock(lockTarget)),
  );
  const acquired = contenders.filter((result) => result.status === 'fulfilled');
  assert.equal(acquired.length, 1);
  await acquired[0].value.release();
});

test('writes atomically and refuses a symlink at the final read boundary', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-atomic-'));
  const filePath = path.join(directory, 'manifest.json');
  await writeFileAtomicDurable(filePath, '{"version":1}\n');
  await writeFileAtomicDurable(filePath, '{"version":2}\n');
  assert.equal(await readFile(filePath, 'utf8'), '{"version":2}\n');
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.includes('.tmp-')),
    [],
  );

  const linkPath = path.join(directory, 'manifest-link.json');
  await symlink(filePath, linkPath);
  await assert.rejects(readFileNoFollow(linkPath), (error) => {
    assert.equal(error instanceof BenchmarkStorageError, true);
    assert.equal(error.code, 'nofollow_required');
    return true;
  });
});
