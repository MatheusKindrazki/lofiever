import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { promisify } from 'node:util';

import { sha256Receipt } from './manifest.mjs';
import { BenchmarkStorageError } from './storage.mjs';

const execFileAsync = promisify(execFile);
const PROCESS_IDENTITY_ENVIRONMENT = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  TZ: 'UTC',
});

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

async function queryProcessStartIdentity(pid, hostname) {
  try {
    const { stdout } = await execFileAsync(
      '/bin/ps',
      ['-o', 'lstart=', '-p', String(pid)],
      {
        encoding: 'utf8',
        env: PROCESS_IDENTITY_ENVIRONMENT,
        maxBuffer: 16 * 1024,
        shell: false,
        timeout: 5_000,
      },
    );
    const startedAt = stdout.trim();
    return startedAt.length === 0
      ? null
      : sha256Receipt(`${hostname}\0${pid}\0${startedAt}`);
  } catch {
    return null;
  }
}

async function currentOwner(store, observeHostname) {
  const hostname = observeHostname();
  const processStartIdentity = await queryProcessStartIdentity(process.pid, hostname);
  const helperPid = store?.helperProcessId;
  const helperProcessStartIdentity = Number.isInteger(helperPid) && helperPid > 0
    ? await queryProcessStartIdentity(helperPid, hostname)
    : null;
  if (processStartIdentity === null || helperProcessStartIdentity === null) {
    throw new BenchmarkStorageError(
      'benchmark_process_identity_unavailable',
      'Cannot establish parent and helper start identities for the confined benchmark lock.',
    );
  }
  return {
    schemaVersion: '1.1.0',
    pid: process.pid,
    helperPid,
    hostname,
    processIdentity: sha256Receipt(JSON.stringify({
      pid: process.pid,
      helperPid,
      hostname,
      executable: process.execPath,
      processStartIdentity,
      helperProcessStartIdentity,
    })),
    processStartIdentity,
    helperProcessStartIdentity,
    acquisitionIdentity: sha256Receipt(randomBytes(32)),
    acquiredAt: new Date().toISOString(),
  };
}

function validOwner(owner) {
  return (
    exactKeys(owner, [
      'acquiredAt',
      'acquisitionIdentity',
      'hostname',
      'helperPid',
      'helperProcessStartIdentity',
      'pid',
      'processIdentity',
      'processStartIdentity',
      'schemaVersion',
    ]) &&
    owner.schemaVersion === '1.1.0' &&
    Number.isInteger(owner.pid) &&
    owner.pid > 0 &&
    Number.isInteger(owner.helperPid) &&
    owner.helperPid > 0 &&
    typeof owner.hostname === 'string' &&
    /^[^\0\r\n]{1,255}$/u.test(owner.hostname) &&
    /^sha256:[a-f0-9]{64}$/u.test(owner.processIdentity ?? '') &&
    /^sha256:[a-f0-9]{64}$/u.test(owner.processStartIdentity ?? '') &&
    /^sha256:[a-f0-9]{64}$/u.test(owner.helperProcessStartIdentity ?? '') &&
    /^sha256:[a-f0-9]{64}$/u.test(owner.acquisitionIdentity ?? '') &&
    typeof owner.acquiredAt === 'string' &&
    Number.isFinite(Date.parse(owner.acquiredAt))
  );
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function exactProcessIsLive(pid, expectedStartIdentity, hostname) {
  if (!isAlive(pid)) return false;
  const observed = await queryProcessStartIdentity(pid, hostname);
  if (observed === null) {
    if (isAlive(pid)) {
      throw new BenchmarkStorageError(
        'benchmark_lock_identity_uncertain',
        'A live confined-lock process has an unverifiable start identity.',
      );
    }
    return false;
  }
  return observed === expectedStartIdentity;
}

async function ownerIsStale(owner, observeHostname) {
  const currentHostname = observeHostname();
  if (owner.hostname !== currentHostname) {
    throw new BenchmarkStorageError(
      'benchmark_lock_identity_uncertain',
      'A confined benchmark lock from another hostname cannot be proven stale.',
    );
  }
  const parentLive = await exactProcessIsLive(
    owner.pid,
    owner.processStartIdentity,
    owner.hostname,
  );
  const helperLive = await exactProcessIsLive(
    owner.helperPid,
    owner.helperProcessStartIdentity,
    owner.hostname,
  );
  return !parentLive && !helperLive;
}

async function readJson(store, relativePath, { allowMissing = false } = {}) {
  let file;
  try {
    file = await store.readFile(relativePath, { maxBytes: 64 * 1024 });
  } catch (error) {
    if (error?.code === 'confined_file_changed') {
      throw new BenchmarkStorageError(
        'benchmark_lock_identity_changed',
        `Confined lock changed while its receipt was read: ${relativePath}`,
      );
    }
    throw error;
  }
  if (file === null) {
    if (allowMissing) return null;
    const error = new BenchmarkStorageError(
      'confined_file_missing',
      `Confined lock receipt is missing: ${relativePath}`,
    );
    error.code = 'confined_file_missing';
    throw error;
  }
  let value;
  try {
    value = JSON.parse(file.bytes.toString('utf8'));
  } catch {
    throw new BenchmarkStorageError(
      'benchmark_lock_invalid',
      `Confined lock receipt is not valid JSON: ${relativePath}`,
    );
  }
  return { value, receipt: file.receipt };
}

async function readOwner(store, relativePath, { allowMissing = false } = {}) {
  const result = await readJson(store, relativePath, { allowMissing });
  if (result === null) return null;
  assertPrivateLockReceipt(result.receipt, relativePath);
  if (!validOwner(result.value)) {
    throw new BenchmarkStorageError(
      'benchmark_lock_invalid',
      `Confined benchmark lock has a malformed owner: ${relativePath}`,
    );
  }
  return { owner: result.value, receipt: result.receipt };
}

function assertPrivateLockReceipt(receipt, relativePath) {
  const expectedUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (
    expectedUid === null ||
    receipt.uid !== expectedUid ||
    (receipt.mode & 0o777) !== 0o600
  ) {
    throw new BenchmarkStorageError(
      'benchmark_lock_permissions_invalid',
      `Confined lock receipt is not private to the current user: ${relativePath}`,
    );
  }
}

function sameOwner(left, right) {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.pid === right.pid &&
    left.helperPid === right.helperPid &&
    left.hostname === right.hostname &&
    left.processIdentity === right.processIdentity &&
    left.processStartIdentity === right.processStartIdentity &&
    left.helperProcessStartIdentity === right.helperProcessStartIdentity &&
    left.acquisitionIdentity === right.acquisitionIdentity &&
    left.acquiredAt === right.acquiredAt
  );
}

function cleanupDetails(guard) {
  return guard.state === 'cleanup-pending'
    ? { state: guard.state, processGroupId: guard.processGroupId }
    : {
        state: guard.state,
        code: guard.errorCode,
        processGroupId: guard.processGroupId,
        priorErrorCode: guard.priorErrorCode,
      };
}

function cleanupOwner(owner) {
  return structuredClone(owner);
}

function pendingGuard(owner, processGroupId = null) {
  const guard = {
    schemaVersion: 'cleanup-guard-v1',
    state: 'cleanup-pending',
    owner: cleanupOwner(owner),
    errorCode: null,
    priorErrorCode: null,
    processGroupId,
    errorDetailsSha256: null,
    recordedAt: new Date().toISOString(),
  };
  guard.errorDetailsSha256 = sha256Receipt(JSON.stringify(cleanupDetails(guard)));
  return guard;
}

function validCode(value) {
  return /^[a-z][a-z0-9_]{0,127}$/u.test(value ?? '');
}

function unprovenGuard(owner, error, processGroupId) {
  const code = error?.code ?? 'executor_cleanup_unproven';
  const priorErrorCode = error?.details?.priorErrorCode ?? null;
  const effectiveProcessGroupId = error?.details?.processGroupId ?? processGroupId;
  if (
    error?.cleanupUnproven !== true ||
    !validCode(code) ||
    (priorErrorCode !== null && !validCode(priorErrorCode)) ||
    (effectiveProcessGroupId !== null &&
      (!Number.isInteger(effectiveProcessGroupId) || effectiveProcessGroupId < 1))
  ) {
    throw new BenchmarkStorageError(
      'benchmark_cleanup_proof_required',
      'Confined cleanup guard requires bounded structured cleanup evidence.',
    );
  }
  const guard = {
    schemaVersion: 'cleanup-guard-v1',
    state: 'cleanup-unproven',
    owner: cleanupOwner(owner),
    errorCode: code,
    priorErrorCode,
    processGroupId: effectiveProcessGroupId,
    errorDetailsSha256: null,
    recordedAt: new Date().toISOString(),
  };
  guard.errorDetailsSha256 = sha256Receipt(JSON.stringify(cleanupDetails(guard)));
  return guard;
}

function validGuard(guard) {
  return (
    exactKeys(guard, [
      'errorCode',
      'errorDetailsSha256',
      'owner',
      'priorErrorCode',
      'processGroupId',
      'recordedAt',
      'schemaVersion',
      'state',
    ]) &&
    guard.schemaVersion === 'cleanup-guard-v1' &&
    ['cleanup-pending', 'cleanup-unproven'].includes(guard.state) &&
    validOwner(guard.owner) &&
    ((guard.state === 'cleanup-pending' &&
      guard.errorCode === null &&
      guard.priorErrorCode === null) ||
      (guard.state === 'cleanup-unproven' &&
        validCode(guard.errorCode) &&
        (guard.priorErrorCode === null || validCode(guard.priorErrorCode)))) &&
    (guard.processGroupId === null ||
      (Number.isInteger(guard.processGroupId) && guard.processGroupId > 0)) &&
    guard.errorDetailsSha256 === sha256Receipt(JSON.stringify(cleanupDetails(guard))) &&
    typeof guard.recordedAt === 'string' &&
    Number.isFinite(Date.parse(guard.recordedAt))
  );
}

async function readGuard(store, relativePath, { allowMissing = true } = {}) {
  const result = await readJson(store, relativePath, { allowMissing });
  if (result === null) return null;
  assertPrivateLockReceipt(result.receipt, relativePath);
  if (!validGuard(result.value)) {
    throw new BenchmarkStorageError(
      'benchmark_lock_cleanup_unproven',
      'Confined cleanup guard is malformed and requires manual recovery.',
    );
  }
  return { guard: result.value, receipt: result.receipt };
}

function processGroupAbsentOnce(processGroupId) {
  if (
    process.platform === 'win32' ||
    !Number.isInteger(processGroupId) ||
    processGroupId < 1
  ) return false;
  try {
    process.kill(-processGroupId, 0);
    return false;
  } catch (error) {
    if (error?.code === 'ESRCH') return true;
    if (error?.code === 'EPERM') return false;
    throw error;
  }
}

function quarantineName(relativePath, label, owner) {
  return `${relativePath}.${label}-${Date.now()}-${owner.processIdentity.slice(-12)}-${randomBytes(4).toString('hex')}`;
}

async function acquireRecovery(store, baseName, owner, observeHostname) {
  const path = `${baseName}.lock.recovery`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const receipt = await store.createExclusiveFile(path, `${JSON.stringify(owner)}\n`);
      return { path, receipt };
    } catch (error) {
      if (error?.code !== 'benchmark_lock_exists') throw error;
      const existing = await readOwner(store, path);
      if (!(await ownerIsStale(existing.owner, observeHostname))) {
        throw new BenchmarkStorageError(
          'benchmark_lock_recovery_in_progress',
          'Another live process is recovering the confined benchmark lock.',
        );
      }
      try {
        await store.renameFile(
          path,
          quarantineName(path, 'stale', existing.owner),
          existing.receipt,
        );
      } catch (race) {
        if (!['confined_file_missing', 'benchmark_lock_identity_changed'].includes(race?.code)) {
          throw race;
        }
      }
    }
  }
  throw new BenchmarkStorageError(
    'benchmark_lock_race',
    'Could not serialize confined benchmark lock recovery.',
  );
}

async function assertOwned(store, lockPath, owner) {
  const current = await readOwner(store, lockPath);
  if (!sameOwner(current.owner, owner)) {
    throw new BenchmarkStorageError(
      'benchmark_lock_identity_changed',
      'Confined benchmark lock changed ownership.',
    );
  }
  return current;
}

function ownedHandle(store, baseName, owner) {
  const lockPath = `${baseName}.lock`;
  const guardPath = `${lockPath}.cleanup-unproven`;
  let released = false;
  let cleanupState = 'none';
  return {
    lockPath,
    owner,
    async armCleanupPending() {
      if (released || cleanupState !== 'none') {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_guard_state_invalid',
          'Confined cleanup guard can only be armed once.',
        );
      }
      await assertOwned(store, lockPath, owner);
      await store.createExclusiveFile(
        guardPath,
        `${JSON.stringify(pendingGuard(owner))}\n`,
      );
      cleanupState = 'cleanup-pending';
    },
    async recordCleanupProcessGroup(processGroupId) {
      if (
        cleanupState !== 'cleanup-pending' ||
        !Number.isInteger(processGroupId) ||
        processGroupId < 1
      ) {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_process_group_invalid',
          'Confined cleanup guard requires a positive process-group identity.',
        );
      }
      await assertOwned(store, lockPath, owner);
      const current = await readGuard(store, guardPath, { allowMissing: false });
      if (
        !sameOwner(current.guard.owner, owner) ||
        current.guard.state !== 'cleanup-pending'
      ) {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_guard_identity_changed',
          'Confined cleanup guard changed ownership.',
        );
      }
      await store.replaceFile(
        guardPath,
        current.receipt,
        `${JSON.stringify(pendingGuard(owner, processGroupId))}\n`,
      );
    },
    async markCleanupUnproven(error) {
      if (cleanupState === 'cleanup-unproven') return;
      if (released || cleanupState !== 'cleanup-pending') {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_guard_not_armed',
          'Confined cleanup uncertainty requires a pre-armed guard.',
        );
      }
      await assertOwned(store, lockPath, owner);
      const current = await readGuard(store, guardPath, { allowMissing: false });
      if (
        !sameOwner(current.guard.owner, owner) ||
        current.guard.state !== 'cleanup-pending'
      ) {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_guard_identity_changed',
          'Confined cleanup guard changed before marking uncertainty.',
        );
      }
      await store.replaceFile(
        guardPath,
        current.receipt,
        `${JSON.stringify(unprovenGuard(
          owner,
          error,
          current.guard.processGroupId,
        ))}\n`,
      );
      cleanupState = 'cleanup-unproven';
    },
    async clearCleanupPending({ processGroupAbsent } = {}) {
      if (
        released ||
        cleanupState !== 'cleanup-pending' ||
        processGroupAbsent !== true
      ) {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_proof_required',
          'Confined cleanup removal requires process-group absence proof.',
        );
      }
      await assertOwned(store, lockPath, owner);
      const current = await readGuard(store, guardPath, { allowMissing: false });
      if (!sameOwner(current.guard.owner, owner) || current.guard.state !== 'cleanup-pending') {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_guard_identity_changed',
          'Confined cleanup guard changed before removal.',
        );
      }
      await store.removeFile(guardPath, current.receipt);
      cleanupState = 'none';
    },
    async prepareTerminalRelease() {
      if (released) {
        throw new BenchmarkStorageError(
          'benchmark_terminal_release_already_prepared',
          'Confined benchmark terminal release was already prepared.',
        );
      }
      if (cleanupState !== 'none') {
        throw new BenchmarkStorageError(
          cleanupState === 'cleanup-pending'
            ? 'benchmark_lock_cleanup_pending'
            : 'benchmark_lock_cleanup_unproven',
          'Confined benchmark lock is not eligible for terminal helper release.',
        );
      }
      const current = await assertOwned(store, lockPath, owner);
      released = true;
      return Object.freeze({
        lockPath,
        guardPath,
        expectedLock: current.receipt,
      });
    },
  };
}

export async function acquireConfinedRunLock(
  store,
  baseName = 'benchmark-run',
  { observeHostname = os.hostname } = {},
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u.test(baseName)) {
    throw new TypeError('Confined benchmark lock name is invalid.');
  }
  if (typeof observeHostname !== 'function') {
    throw new TypeError('Confined lock hostname observer must be a function.');
  }
  const owner = await currentOwner(store, observeHostname);
  const lockPath = `${baseName}.lock`;
  const guardPath = `${lockPath}.cleanup-unproven`;
  const observedBeforeRecovery = await readOwner(store, lockPath, { allowMissing: true });
  if (
    observedBeforeRecovery !== null &&
    !(await ownerIsStale(observedBeforeRecovery.owner, observeHostname))
  ) {
    throw new BenchmarkStorageError(
      'benchmark_locked',
      'Another live parent or confined-output helper owns the benchmark lock.',
    );
  }
  const recovery = await acquireRecovery(store, baseName, owner, observeHostname);
  try {
    const cleanup = await readGuard(store, guardPath);
    if (cleanup !== null) {
      if (cleanup.guard.state === 'cleanup-unproven') {
        throw new BenchmarkStorageError(
          'benchmark_lock_cleanup_unproven',
          'Confined cleanup uncertainty requires manual recovery.',
        );
      }
      let existing;
      try {
        existing = await readOwner(store, lockPath);
      } catch (error) {
        if (error?.code === 'confined_file_missing') {
          throw new BenchmarkStorageError(
            'benchmark_lock_cleanup_unproven',
            'A confined cleanup guard exists without its correlated lock.',
          );
        }
        throw error;
      }
      if (!sameOwner(cleanup.guard.owner, existing.owner)) {
        throw new BenchmarkStorageError(
          'benchmark_lock_cleanup_unproven',
          'Confined cleanup guard owner does not match its lock owner.',
        );
      }
      if (!(await ownerIsStale(existing.owner, observeHostname))) {
        throw new BenchmarkStorageError(
          'benchmark_locked',
          'Another live process owns the confined benchmark lock.',
        );
      }
      if (!processGroupAbsentOnce(cleanup.guard.processGroupId)) {
        throw new BenchmarkStorageError(
          'benchmark_lock_cleanup_pending',
          'Confined cleanup guard cannot prove process-group absence.',
        );
      }
      await store.renameFile(
        guardPath,
        quarantineName(guardPath, 'recovered', cleanup.guard.owner),
        cleanup.receipt,
      );
      await store.renameFile(
        lockPath,
        quarantineName(lockPath, 'stale', existing.owner),
        existing.receipt,
      );
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await store.createExclusiveFile(lockPath, `${JSON.stringify(owner)}\n`);
        return ownedHandle(store, baseName, owner);
      } catch (error) {
        if (error?.code !== 'benchmark_lock_exists') throw error;
        const existing = await readOwner(store, lockPath);
        if (!(await ownerIsStale(existing.owner, observeHostname))) {
          throw new BenchmarkStorageError(
            'benchmark_locked',
            'Another live process owns the confined benchmark lock.',
          );
        }
        await store.renameFile(
          lockPath,
          quarantineName(lockPath, 'stale', existing.owner),
          existing.receipt,
        );
      }
    }
    throw new BenchmarkStorageError(
      'benchmark_lock_race',
      'Could not acquire the confined benchmark lock after stale recovery.',
    );
  } finally {
    await store.removeFile(recovery.path, recovery.receipt);
  }
}
