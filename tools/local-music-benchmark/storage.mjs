import { createHash, randomBytes } from 'node:crypto';
import { constants, fstatSync, lstatSync } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { observeProcessStartIdentityWithPs } from './process-identity.mjs';

function sha256Receipt(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export class BenchmarkStorageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BenchmarkStorageError';
    this.code = code;
    this.details = details;
  }
}

function assertSafeRelativePath(relativePath) {
  if (
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).includes('..') ||
    relativePath.includes('\0')
  ) {
    throw new BenchmarkStorageError(
      'confined_relative_path_required',
      `Path is not confined to the pinned directory: ${relativePath}`,
    );
  }
}

export async function openPrivateDirectory(directoryPath) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const directoryOnly = constants.O_DIRECTORY ?? 0;
  let handle;
  try {
    handle = await open(directoryPath, constants.O_RDONLY | noFollow | directoryOnly);
  } catch (error) {
    if (error?.code === 'ELOOP' || error?.code === 'EMLINK') {
      throw new BenchmarkStorageError(
        'private_directory_symlink',
        'The benchmark directory must not be a symbolic link.',
      );
    }
    throw error;
  }
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isDirectory()) {
      throw new BenchmarkStorageError(
        'private_directory_required',
        'The benchmark directory must be a directory.',
      );
    }
    if (typeof process.getuid === 'function' && stats.uid !== BigInt(process.getuid())) {
      throw new BenchmarkStorageError(
        'private_directory_owner_mismatch',
        'The benchmark directory must be owned by the current user.',
      );
    }
    if ((stats.mode & 0o077n) !== 0n) {
      throw new BenchmarkStorageError(
        'private_directory_permissions',
        'The benchmark directory must not grant group or world permissions.',
      );
    }
    const canonicalPath = await realpath(directoryPath);
    const pathStats = await lstat(canonicalPath, { bigint: true });
    if (pathStats.dev !== stats.dev || pathStats.ino !== stats.ino) {
      throw new BenchmarkStorageError(
        'private_directory_changed',
        'The benchmark directory changed while it was being pinned.',
      );
    }
    let closed = false;
    function verifyCurrent() {
      if (closed) {
        throw new BenchmarkStorageError(
          'private_directory_closed',
          'The pinned benchmark directory is already closed.',
        );
      }
      let current;
      let descriptor;
      try {
        current = lstatSync(canonicalPath, { bigint: true });
        descriptor = fstatSync(handle.fd, { bigint: true });
      } catch (error) {
        throw new BenchmarkStorageError(
          'private_directory_changed',
          'The pinned benchmark directory path is no longer the opened directory.',
          { cause: error?.message ?? String(error) },
        );
      }
      if (
        current.isSymbolicLink() ||
        current.dev !== descriptor.dev ||
        current.ino !== descriptor.ino
      ) {
        throw new BenchmarkStorageError(
          'private_directory_changed',
          'The pinned benchmark directory path is no longer the opened directory.',
        );
      }
    }
    return {
      canonicalPath,
      device: String(stats.dev),
      inode: String(stats.ino),
      uid: Number(stats.uid),
      mode: Number(stats.mode & 0o7777n),
      handle,
      verifyCurrent,
      resolve(relativePath = '') {
        verifyCurrent();
        assertSafeRelativePath(relativePath);
        return relativePath === ''
          ? canonicalPath
          : path.join(canonicalPath, relativePath);
      },
      async close() {
        if (closed) return;
        closed = true;
        await handle.close();
      },
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

export async function openConfinedFile(
  storageRoot,
  relativePath,
  { maxBytes = 32 * 1024 * 1024 } = {},
) {
  assertSafeRelativePath(relativePath);
  const components = relativePath.split(/[\\/]/u).filter(Boolean);
  if (components.length === 0) {
    throw new BenchmarkStorageError(
      'confined_file_required',
      'A confined file path is required.',
    );
  }
  storageRoot.verifyCurrent();
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const directoryOnly = constants.O_DIRECTORY ?? 0;
  const directoryReceipts = [];
  let fileHandle = null;
  const closeOpened = async () => {
    if (fileHandle !== null) {
      await fileHandle.close().catch(() => {});
      fileHandle = null;
    }
    for (const receipt of directoryReceipts.reverse()) {
      await receipt.handle.close().catch(() => {});
    }
  };
  try {
    let currentPath = storageRoot.canonicalPath;
    for (const component of components.slice(0, -1)) {
      currentPath = path.join(currentPath, component);
      let handle;
      try {
        handle = await open(
          currentPath,
          constants.O_RDONLY | noFollow | directoryOnly,
        );
      } catch (error) {
        throw new BenchmarkStorageError(
          'confined_path_changed',
          `Confined path component is missing, changed, or a symlink: ${relativePath}`,
          { cause: error?.message ?? String(error) },
        );
      }
      const [descriptor, pathStats] = await Promise.all([
        handle.stat({ bigint: true }),
        lstat(currentPath, { bigint: true }),
      ]);
      if (
        pathStats.isSymbolicLink() ||
        !descriptor.isDirectory() ||
        descriptor.dev !== pathStats.dev ||
        descriptor.ino !== pathStats.ino
      ) {
        await handle.close();
        throw new BenchmarkStorageError(
          'confined_path_changed',
          `Confined path component changed or is a symlink: ${relativePath}`,
        );
      }
      directoryReceipts.push({
        handle,
        path: currentPath,
        device: descriptor.dev,
        inode: descriptor.ino,
      });
    }
    const filePath = path.join(storageRoot.canonicalPath, ...components);
    fileHandle = await open(filePath, constants.O_RDONLY | noFollow);
    const [fileStats, filePathStats, canonicalPath] = await Promise.all([
      fileHandle.stat({ bigint: true }),
      lstat(filePath, { bigint: true }),
      realpath(filePath),
    ]);
    const relativeCanonicalPath = path.relative(storageRoot.canonicalPath, canonicalPath);
    if (
      filePathStats.isSymbolicLink() ||
      !fileStats.isFile() ||
      fileStats.dev !== filePathStats.dev ||
      fileStats.ino !== filePathStats.ino ||
      relativeCanonicalPath.startsWith(`..${path.sep}`) ||
      relativeCanonicalPath === '..' ||
      path.isAbsolute(relativeCanonicalPath)
    ) {
      throw new BenchmarkStorageError(
        'confined_file_changed',
        `Confined file changed, escaped, or is not regular: ${relativePath}`,
      );
    }
    const fileReceipt = {
      path: filePath,
      canonicalPath,
      device: fileStats.dev,
      inode: fileStats.ino,
      size: fileStats.size,
      mtimeNs: fileStats.mtimeNs,
      ctimeNs: fileStats.ctimeNs,
    };
    let closed = false;
    let initialSha256 = null;
    function sameFileReceipt(stats) {
      return (
        stats.dev === fileReceipt.device &&
        stats.ino === fileReceipt.inode &&
        stats.size === fileReceipt.size &&
        stats.mtimeNs === fileReceipt.mtimeNs &&
        stats.ctimeNs === fileReceipt.ctimeNs
      );
    }
    async function verifyPathIdentity() {
      if (closed || fileHandle === null) {
        throw new BenchmarkStorageError(
          'confined_file_closed',
          'The confined file is already closed.',
        );
      }
      storageRoot.verifyCurrent();
      for (const receipt of directoryReceipts) {
        const [descriptor, current] = await Promise.all([
          receipt.handle.stat({ bigint: true }),
          lstat(receipt.path, { bigint: true }),
        ]);
        if (
          current.isSymbolicLink() ||
          descriptor.dev !== receipt.device ||
          descriptor.ino !== receipt.inode ||
          current.dev !== receipt.device ||
          current.ino !== receipt.inode
        ) {
          throw new BenchmarkStorageError(
            'confined_path_changed',
            `Confined path component changed: ${relativePath}`,
          );
        }
      }
      const [descriptor, current] = await Promise.all([
        fileHandle.stat({ bigint: true }),
        lstat(fileReceipt.path, { bigint: true }),
      ]);
      if (
        current.isSymbolicLink() ||
        !sameFileReceipt(descriptor) ||
        !sameFileReceipt(current)
      ) {
        throw new BenchmarkStorageError(
          'confined_file_changed',
          `Confined file path changed: ${relativePath}`,
        );
      }
    }
    async function readStableBytes(expectedSha256 = null) {
      await verifyPathIdentity();
      if (fileReceipt.size > BigInt(maxBytes)) {
        throw new BenchmarkStorageError(
          'confined_file_too_large',
          `Confined file exceeds ${maxBytes} bytes: ${relativePath}`,
        );
      }
      const bytes = Buffer.alloc(Number(fileReceipt.size));
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await fileHandle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== bytes.length) {
        throw new BenchmarkStorageError(
          'confined_file_changed',
          `Confined file changed while it was read: ${relativePath}`,
        );
      }
      await verifyPathIdentity();
      const sha256 = sha256Receipt(bytes);
      if (expectedSha256 !== null && sha256 !== expectedSha256) {
        throw new BenchmarkStorageError(
          'confined_file_changed',
          `Confined file content changed: ${relativePath}`,
        );
      }
      return { bytes, sha256 };
    }
    async function hashStableFile(expectedSha256 = null) {
      await verifyPathIdentity();
      if (fileReceipt.size > BigInt(maxBytes)) {
        throw new BenchmarkStorageError(
          'confined_file_too_large',
          `Confined file exceeds ${maxBytes} bytes: ${relativePath}`,
        );
      }
      const hash = createHash('sha256');
      const chunk = Buffer.alloc(64 * 1024);
      let offset = 0;
      while (offset < Number(fileReceipt.size)) {
        const length = Math.min(chunk.length, Number(fileReceipt.size) - offset);
        const { bytesRead } = await fileHandle.read(chunk, 0, length, offset);
        if (bytesRead === 0) break;
        hash.update(chunk.subarray(0, bytesRead));
        offset += bytesRead;
      }
      if (offset !== Number(fileReceipt.size)) {
        throw new BenchmarkStorageError(
          'confined_file_changed',
          `Confined file changed while it was hashed: ${relativePath}`,
        );
      }
      await verifyPathIdentity();
      const sha256 = `sha256:${hash.digest('hex')}`;
      if (expectedSha256 !== null && sha256 !== expectedSha256) {
        throw new BenchmarkStorageError(
          'confined_file_changed',
          `Confined file content changed: ${relativePath}`,
        );
      }
      return sha256;
    }
    initialSha256 = await hashStableFile();
    return {
      canonicalPath,
      sha256: initialSha256,
      bytes: Number(fileReceipt.size),
      device: String(fileReceipt.device),
      inode: String(fileReceipt.inode),
      handle: fileHandle,
      async readBytes() {
        return (await readStableBytes(initialSha256)).bytes;
      },
      async verifyCurrent() {
        await hashStableFile(initialSha256);
      },
      async close() {
        if (closed) return;
        closed = true;
        await closeOpened();
      },
    };
  } catch (error) {
    await closeOpened();
    throw error;
  }
}

async function syncDirectory(directoryPath) {
  const handle = await open(directoryPath, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeFileAtomicDurable(filePath, data) {
  const directoryPath = path.dirname(filePath);
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  const suffix = randomBytes(12).toString('hex');
  const temporaryPath = `${filePath}.tmp-${process.pid}-${suffix}`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(data, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
    await syncDirectory(directoryPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function readFileReceiptNoFollow(
  filePath,
  { durable = false, maxBytes = 16 * 1024 * 1024 } = {},
) {
  let handle;
  try {
    handle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    if (error?.code === 'ELOOP' || error?.code === 'EMLINK') {
      throw new BenchmarkStorageError(
        'nofollow_required',
        `Refusing to follow a symbolic link: ${filePath}`,
      );
    }
    throw error;
  }
  try {
    if (durable) await handle.sync();
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new BenchmarkStorageError(
        'regular_file_required',
        `Expected a regular file: ${filePath}`,
      );
    }
    if (before.size > BigInt(maxBytes)) {
      throw new BenchmarkStorageError(
        'file_too_large',
        `File exceeds the bounded read limit: ${filePath}`,
        { maxBytes, bytes: Number(before.size) },
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new BenchmarkStorageError(
        'file_changed_while_reading',
        `File changed while it was being read: ${filePath}`,
      );
    }
    return {
      bytes,
      device: String(before.dev),
      inode: String(before.ino),
      size: String(before.size),
      mtimeNs: String(before.mtimeNs),
      ctimeNs: String(before.ctimeNs),
      uid: Number(before.uid),
      mode: Number(before.mode),
    };
  } finally {
    await handle.close();
  }
}

export async function readFileNoFollow(filePath, options) {
  return (await readFileReceiptNoFollow(filePath, options)).bytes;
}

export async function renameFileDurable(sourcePath, destinationPath) {
  await rename(sourcePath, destinationPath);
  await syncDirectory(path.dirname(destinationPath));
  if (path.dirname(sourcePath) !== path.dirname(destinationPath)) {
    await syncDirectory(path.dirname(sourcePath));
  }
}

async function currentOwner(observeHostname, observeProcessStartIdentity) {
  const hostname = observeHostname();
  const processStartIdentity = await observeProcessStartIdentity(process.pid, hostname);
  if (processStartIdentity === null) {
    throw new BenchmarkStorageError(
      'benchmark_process_identity_unavailable',
      'Cannot establish the current process start identity for the benchmark lock.',
    );
  }
  const processIdentity = sha256Receipt(
    JSON.stringify({
      pid: process.pid,
      hostname,
      executable: process.execPath,
      processStartIdentity,
    }),
  );
  return {
    schemaVersion: '1.0.0',
    pid: process.pid,
    hostname,
    processIdentity,
    processStartIdentity,
    acquisitionIdentity: sha256Receipt(randomBytes(32)),
    acquiredAt: new Date().toISOString(),
  };
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

async function writeLockExclusive(lockPath, owner) {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${lockPath}.publish-${process.pid}-${randomBytes(8).toString('hex')}`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, lockPath);
    await syncDirectory(path.dirname(lockPath));
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

async function readLockOwner(lockPath) {
  let parsed;
  let receipt;
  try {
    receipt = await readFileReceiptNoFollow(lockPath, { maxBytes: 64 * 1024 });
    parsed = JSON.parse(receipt.bytes.toString('utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw error;
    if (error?.code === 'file_changed_while_reading') {
      throw new BenchmarkStorageError(
        'benchmark_lock_identity_changed',
        `Benchmark lock changed while its receipt was being read: ${lockPath}`,
      );
    }
    throw new BenchmarkStorageError(
      'benchmark_lock_invalid',
      `Benchmark lock cannot be validated: ${lockPath}`,
      { cause: error?.message ?? String(error) },
    );
  }
  if (
    !hasExactKeys(parsed, [
      'acquiredAt',
      'acquisitionIdentity',
      'hostname',
      'pid',
      'processIdentity',
      'processStartIdentity',
      'schemaVersion',
    ]) ||
    (typeof process.getuid === 'function' && receipt.uid !== process.getuid()) ||
    (receipt.mode & 0o077) !== 0 ||
    parsed?.schemaVersion !== '1.0.0' ||
    !Number.isInteger(parsed.pid) ||
    parsed.pid < 1 ||
    typeof parsed.hostname !== 'string' ||
    !/^[^\0\r\n]{1,255}$/u.test(parsed.hostname) ||
    !/^sha256:[a-f0-9]{64}$/u.test(parsed.processIdentity ?? '') ||
    !/^sha256:[a-f0-9]{64}$/u.test(parsed.processStartIdentity ?? '') ||
    !/^sha256:[a-f0-9]{64}$/u.test(parsed.acquisitionIdentity ?? '') ||
    typeof parsed.acquiredAt !== 'string' ||
    !Number.isFinite(Date.parse(parsed.acquiredAt))
  ) {
    throw new BenchmarkStorageError(
      'benchmark_lock_invalid',
      `Benchmark lock identity is malformed: ${lockPath}`,
    );
  }
  return {
    owner: parsed,
    receipt: lockReceiptFromFile(receipt),
  };
}

function sameLockReceipt(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.sha256 === right.sha256 &&
    left.bytes === right.bytes
  );
}

function lockReceiptFromFile(receipt) {
  return {
    device: receipt.device,
    inode: receipt.inode,
    size: receipt.size,
    mtimeNs: receipt.mtimeNs,
    ctimeNs: receipt.ctimeNs,
    sha256: sha256Receipt(receipt.bytes),
    bytes: receipt.bytes.length,
  };
}

async function assertLockUnchanged(lockPath, expected) {
  let current;
  try {
    const receipt = await readFileReceiptNoFollow(lockPath, { maxBytes: 64 * 1024 });
    current = lockReceiptFromFile(receipt);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new BenchmarkStorageError(
        'benchmark_lock_identity_changed',
        'The benchmark lock disappeared during compare-and-swap recovery.',
      );
    }
    throw error;
  }
  if (!sameLockReceipt(current, expected)) {
    throw new BenchmarkStorageError(
      'benchmark_lock_identity_changed',
      'The benchmark lock changed during compare-and-swap recovery.',
      { expected, actual: current },
    );
  }
}

async function ownerIsStale(existing, observeHostname, observeProcessStartIdentity) {
  const currentHostname = observeHostname();
  if (existing.hostname !== currentHostname) {
    throw new BenchmarkStorageError(
      'benchmark_lock_identity_uncertain',
      'A benchmark lock from another hostname cannot be proven stale.',
      { owner: existing },
    );
  }
  if (isAlive(existing.pid)) {
    const actualStartIdentity = await observeProcessStartIdentity(
      existing.pid,
      existing.hostname,
    );
    if (actualStartIdentity === null) {
      if (isAlive(existing.pid)) {
        throw new BenchmarkStorageError(
          'benchmark_lock_identity_uncertain',
          'A live benchmark lock owner has an unverifiable process start identity.',
          { owner: existing },
        );
      }
    } else if (actualStartIdentity === existing.processStartIdentity) {
      return false;
    }
  }
  return true;
}

async function quarantineStaleLock(lockPath, observed, suffix = 'stale') {
  await assertLockUnchanged(lockPath, observed.receipt);
  const quarantineName = `${lockPath}.${suffix}-${Date.now()}-${observed.owner.processIdentity.slice(-12)}-${randomBytes(4).toString('hex')}`;
  try {
    await rename(lockPath, quarantineName);
    await syncDirectory(path.dirname(lockPath));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new BenchmarkStorageError(
        'benchmark_lock_identity_changed',
        'The benchmark lock changed before quarantine could complete.',
      );
    }
    throw error;
  }
}

async function releaseOwnedLockFile(lockPath, owner, message) {
  const current = await readLockOwner(lockPath);
  if (
    current.owner.processIdentity !== owner.processIdentity ||
    current.owner.acquisitionIdentity !== owner.acquisitionIdentity
  ) {
    throw new BenchmarkStorageError(
      'benchmark_lock_identity_changed',
      message,
      { owner: current.owner },
    );
  }
  await assertLockUnchanged(lockPath, current.receipt);
  await unlink(lockPath);
  await syncDirectory(path.dirname(lockPath));
}

function cleanupSentinelPath(lockPath) {
  return `${lockPath}.cleanup-unproven`;
}

function cleanupGuardError(lockPath, guard, valid = true) {
  const sentinelPath = cleanupSentinelPath(lockPath);
  const state = valid ? guard?.sentinel?.state : null;
  return new BenchmarkStorageError(
    state === 'cleanup-pending'
      ? 'benchmark_lock_cleanup_pending'
      : 'benchmark_lock_cleanup_unproven',
    state === 'cleanup-pending'
      ? 'A benchmark cleanup guard is pending process-group proof.'
      : 'A benchmark cleanup sentinel blocks automatic stale-lock recovery.',
    {
      sentinelPath,
      sentinelValid: valid,
      owner: valid ? guard.sentinel.owner : null,
      errorCode: valid ? guard.sentinel.errorCode : null,
      processGroupId: valid ? guard.sentinel.processGroupId : null,
    },
  );
}

function cleanupGuardDetails(guard) {
  if (guard?.state === 'cleanup-pending') {
    return {
      state: guard.state,
      processGroupId: guard.processGroupId,
    };
  }
  return {
    state: guard?.state,
    code: guard?.errorCode,
    processGroupId: guard?.processGroupId,
    priorErrorCode: guard?.priorErrorCode,
  };
}

function validCleanupErrorCode(value) {
  return /^[a-z][a-z0-9_]{0,127}$/u.test(value ?? '');
}

function hasExactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

async function readCleanupGuard(lockPath, { allowMissing = true } = {}) {
  const sentinelPath = cleanupSentinelPath(lockPath);
  let receipt;
  let parsed = null;
  try {
    receipt = await readFileReceiptNoFollow(sentinelPath, { maxBytes: 64 * 1024 });
    parsed = JSON.parse(receipt.bytes.toString('utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' && allowMissing) return null;
    if (error?.code === 'ENOENT') throw error;
    throw cleanupGuardError(lockPath, null, false);
  }
  const validState =
    parsed?.state === 'cleanup-pending' || parsed?.state === 'cleanup-unproven';
  const valid =
    hasExactKeys(parsed, [
      'errorCode',
      'errorDetailsSha256',
      'owner',
      'priorErrorCode',
      'processGroupId',
      'recordedAt',
      'schemaVersion',
      'state',
    ]) &&
    hasExactKeys(parsed.owner, [
      'acquiredAt',
      'acquisitionIdentity',
      'hostname',
      'pid',
      'processIdentity',
      'processStartIdentity',
      'schemaVersion',
    ]) &&
    (typeof process.getuid !== 'function' || receipt.uid === process.getuid()) &&
    (receipt.mode & 0o077) === 0 &&
    parsed?.schemaVersion === 'cleanup-guard-v1' &&
    validState &&
    parsed.owner.schemaVersion === '1.0.0' &&
    Number.isInteger(parsed.owner?.pid) &&
    parsed.owner.pid > 0 &&
    typeof parsed.owner.hostname === 'string' &&
    /^[^\0\r\n]{1,255}$/u.test(parsed.owner.hostname) &&
    /^sha256:[a-f0-9]{64}$/u.test(parsed.owner.processIdentity ?? '') &&
    /^sha256:[a-f0-9]{64}$/u.test(parsed.owner.processStartIdentity ?? '') &&
    /^sha256:[a-f0-9]{64}$/u.test(parsed.owner.acquisitionIdentity ?? '') &&
    typeof parsed.owner.acquiredAt === 'string' &&
    Number.isFinite(Date.parse(parsed.owner.acquiredAt)) &&
    ((parsed.state === 'cleanup-pending' &&
      parsed.errorCode === null &&
      parsed.priorErrorCode === null) ||
      (parsed.state === 'cleanup-unproven' &&
        validCleanupErrorCode(parsed.errorCode) &&
        (parsed.priorErrorCode === null ||
          validCleanupErrorCode(parsed.priorErrorCode)))) &&
    (parsed.processGroupId === null ||
      (Number.isInteger(parsed.processGroupId) && parsed.processGroupId > 0)) &&
    /^sha256:[a-f0-9]{64}$/u.test(parsed.errorDetailsSha256 ?? '') &&
    parsed.errorDetailsSha256 ===
      sha256Receipt(JSON.stringify(cleanupGuardDetails(parsed))) &&
    typeof parsed.recordedAt === 'string' &&
    Number.isFinite(Date.parse(parsed.recordedAt));
  if (!valid) throw cleanupGuardError(lockPath, null, false);
  return {
    sentinel: parsed,
    receipt: lockReceiptFromFile(receipt),
  };
}

function cleanupGuardOwner(owner) {
  return {
    schemaVersion: owner.schemaVersion,
    pid: owner.pid,
    hostname: owner.hostname,
    processIdentity: owner.processIdentity,
    processStartIdentity: owner.processStartIdentity,
    acquisitionIdentity: owner.acquisitionIdentity,
    acquiredAt: owner.acquiredAt,
  };
}

function pendingCleanupGuard(owner, processGroupId = null) {
  const guard = {
    schemaVersion: 'cleanup-guard-v1',
    state: 'cleanup-pending',
    owner: cleanupGuardOwner(owner),
    errorCode: null,
    priorErrorCode: null,
    processGroupId,
    errorDetailsSha256: null,
    recordedAt: new Date().toISOString(),
  };
  guard.errorDetailsSha256 = sha256Receipt(
    JSON.stringify(cleanupGuardDetails(guard)),
  );
  return guard;
}

function unprovenCleanupGuard(owner, error, existingProcessGroupId) {
  if (error?.cleanupUnproven !== true) {
    throw new BenchmarkStorageError(
      'benchmark_cleanup_proof_required',
      'Cleanup sentinel creation requires an explicit unproven-cleanup error.',
    );
  }
  const processGroupId = error.details?.processGroupId ?? existingProcessGroupId;
  if (
    processGroupId !== null &&
    (!Number.isInteger(processGroupId) || processGroupId < 1)
  ) {
    throw new BenchmarkStorageError(
      'benchmark_cleanup_process_group_invalid',
      'Cleanup sentinel process-group identity must be a positive integer or null.',
    );
  }
  const errorCode = error.code ?? 'executor_cleanup_unproven';
  const priorErrorCode = error.details?.priorErrorCode ?? null;
  if (
    !validCleanupErrorCode(errorCode) ||
    (priorErrorCode !== null && !validCleanupErrorCode(priorErrorCode))
  ) {
    throw new BenchmarkStorageError(
      'benchmark_cleanup_error_code_invalid',
      'Cleanup error codes must use the bounded structured-code format.',
    );
  }
  const guard = {
    schemaVersion: 'cleanup-guard-v1',
    state: 'cleanup-unproven',
    owner: cleanupGuardOwner(owner),
    errorCode,
    priorErrorCode,
    processGroupId,
    errorDetailsSha256: null,
    recordedAt: new Date().toISOString(),
  };
  guard.errorDetailsSha256 = sha256Receipt(
    JSON.stringify(cleanupGuardDetails(guard)),
  );
  return guard;
}

function sameCleanupOwner(guard, owner) {
  return (
    guard.owner.schemaVersion === owner.schemaVersion &&
    guard.owner.pid === owner.pid &&
    guard.owner.hostname === owner.hostname &&
    guard.owner.processIdentity === owner.processIdentity &&
    guard.owner.processStartIdentity === owner.processStartIdentity &&
    guard.owner.acquisitionIdentity === owner.acquisitionIdentity &&
    guard.owner.acquiredAt === owner.acquiredAt
  );
}

async function replaceCleanupGuard(
  lockPath,
  owner,
  nextGuard,
  { expectedState, onCleanupGuardWrite, operation },
) {
  const currentGuard = await readCleanupGuard(lockPath, { allowMissing: false });
  if (
    !sameCleanupOwner(currentGuard.sentinel, owner) ||
    currentGuard.sentinel.state !== expectedState
  ) {
    throw new BenchmarkStorageError(
      'benchmark_cleanup_guard_identity_changed',
      'Cleanup guard identity changed before its durable update.',
    );
  }
  await assertLockUnchanged(cleanupSentinelPath(lockPath), currentGuard.receipt);
  await onCleanupGuardWrite?.(operation, structuredClone(nextGuard));
  await writeFileAtomicDurable(
    cleanupSentinelPath(lockPath),
    `${JSON.stringify(nextGuard)}\n`,
  );
}

async function assertOwnedLock(lockPath, owner) {
  const current = await readLockOwner(lockPath);
  if (
    current.owner.processIdentity !== owner.processIdentity ||
    current.owner.acquisitionIdentity !== owner.acquisitionIdentity
  ) {
    throw new BenchmarkStorageError(
      'benchmark_lock_identity_changed',
      'Refusing to mark cleanup uncertainty on a lock owned by another process.',
      { owner: current.owner },
    );
  }
  await assertLockUnchanged(lockPath, current.receipt);
}

function ownedLockHandle(lockPath, owner, { onCleanupGuardWrite } = {}) {
  let released = false;
  let cleanupState = 'none';
  return {
    lockPath,
    owner,
    async armCleanupPending() {
      if (released || cleanupState !== 'none') {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_guard_state_invalid',
          'Cleanup guard can only be armed once on a live lock.',
        );
      }
      await assertOwnedLock(lockPath, owner);
      const guard = pendingCleanupGuard(owner);
      await onCleanupGuardWrite?.('arm', structuredClone(guard));
      await writeLockExclusive(cleanupSentinelPath(lockPath), guard);
      cleanupState = 'cleanup-pending';
    },
    async recordCleanupProcessGroup(processGroupId) {
      if (released || cleanupState !== 'cleanup-pending') {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_guard_state_invalid',
          'Process-group identity requires an armed cleanup guard.',
        );
      }
      if (!Number.isInteger(processGroupId) || processGroupId < 1) {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_process_group_invalid',
          'Cleanup process-group identity must be a positive integer.',
        );
      }
      await assertOwnedLock(lockPath, owner);
      await replaceCleanupGuard(
        lockPath,
        owner,
        pendingCleanupGuard(owner, processGroupId),
        {
          expectedState: 'cleanup-pending',
          onCleanupGuardWrite,
          operation: 'record-process-group',
        },
      );
    },
    async markCleanupUnproven(error) {
      if (released) {
        throw new BenchmarkStorageError(
          'benchmark_lock_already_released',
          'Cannot mark cleanup uncertainty after releasing the benchmark lock.',
        );
      }
      if (cleanupState === 'cleanup-unproven') return;
      if (cleanupState !== 'cleanup-pending') {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_guard_not_armed',
          'Cleanup uncertainty requires a durable pre-armed guard.',
        );
      }
      const currentGuard = await readCleanupGuard(lockPath, { allowMissing: false });
      const next = unprovenCleanupGuard(
        owner,
        error,
        currentGuard.sentinel.processGroupId,
      );
      cleanupState = 'cleanup-unproven';
      await replaceCleanupGuard(lockPath, owner, next, {
        expectedState: 'cleanup-pending',
        onCleanupGuardWrite,
        operation: 'mark-unproven',
      });
    },
    async clearCleanupPending({ processGroupAbsent } = {}) {
      if (
        released ||
        cleanupState !== 'cleanup-pending' ||
        processGroupAbsent !== true
      ) {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_proof_required',
          'Cleanup guard removal requires explicit process-group absence proof.',
        );
      }
      await assertOwnedLock(lockPath, owner);
      const currentGuard = await readCleanupGuard(lockPath, { allowMissing: false });
      if (
        !sameCleanupOwner(currentGuard.sentinel, owner) ||
        currentGuard.sentinel.state !== 'cleanup-pending'
      ) {
        throw new BenchmarkStorageError(
          'benchmark_cleanup_guard_identity_changed',
          'Cleanup guard identity changed before proven removal.',
        );
      }
      await assertLockUnchanged(cleanupSentinelPath(lockPath), currentGuard.receipt);
      await unlink(cleanupSentinelPath(lockPath));
      await syncDirectory(path.dirname(lockPath));
      cleanupState = 'none';
    },
    async release() {
      if (released) return;
      if (cleanupState !== 'none') {
        throw new BenchmarkStorageError(
          cleanupState === 'cleanup-pending'
            ? 'benchmark_lock_cleanup_pending'
            : 'benchmark_lock_cleanup_unproven',
          'Refusing to release a lock with an active cleanup guard.',
        );
      }
      await releaseOwnedLockFile(
        lockPath,
        owner,
        'Refusing to release a benchmark lock owned by another process identity.',
      );
      released = true;
    },
  };
}

async function acquireRecoveryGuard(
  lockPath,
  owner,
  observeHostname,
  observeProcessStartIdentity,
) {
  const guardPath = `${lockPath}.recovery`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await writeLockExclusive(guardPath, owner);
      return {
        async release() {
          await releaseOwnedLockFile(
            guardPath,
            owner,
            'The stale-recovery guard changed ownership before release.',
          );
        },
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readLockOwner(guardPath);
      if (!(await ownerIsStale(
        existing.owner,
        observeHostname,
        observeProcessStartIdentity,
      ))) {
        throw new BenchmarkStorageError(
          'benchmark_lock_recovery_in_progress',
          'Another live process is serializing benchmark lock recovery.',
          { owner: existing.owner },
        );
      }
      const reaperPath = `${guardPath}.reaper`;
      try {
        await writeLockExclusive(reaperPath, owner);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const reaper = await readLockOwner(reaperPath);
        if (!(await ownerIsStale(
          reaper.owner,
          observeHostname,
          observeProcessStartIdentity,
        ))) {
          throw new BenchmarkStorageError(
            'benchmark_lock_recovery_in_progress',
            'Another live process is recovering an abandoned benchmark guard.',
            { owner: reaper.owner },
          );
        }
        throw new BenchmarkStorageError(
          'benchmark_lock_identity_uncertain',
          'An abandoned second-level recovery guard requires explicit operator quarantine.',
          { owner: reaper.owner },
        );
      }
      try {
        let currentGuard;
        try {
          currentGuard = await readLockOwner(guardPath);
        } catch (error) {
          if (error?.code === 'ENOENT') continue;
          throw error;
        }
        if (!(await ownerIsStale(
          currentGuard.owner,
          observeHostname,
          observeProcessStartIdentity,
        ))) {
          throw new BenchmarkStorageError(
            'benchmark_lock_recovery_in_progress',
            'The benchmark recovery guard gained a live owner.',
            { owner: currentGuard.owner },
          );
        }
        try {
          await quarantineStaleLock(guardPath, currentGuard, 'stale-recovery');
        } catch (recoveryError) {
          if (recoveryError?.code !== 'benchmark_lock_identity_changed') throw recoveryError;
        }
      } finally {
        await releaseOwnedLockFile(
          reaperPath,
          owner,
          'The second-level recovery guard changed ownership before release.',
        );
      }
    }
  }
  throw new BenchmarkStorageError(
    'benchmark_lock_race',
    'Could not serialize benchmark lock recovery.',
  );
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
    throw new BenchmarkStorageError(
      'benchmark_cleanup_process_group_uncertain',
      'Process-group absence could not be established during cleanup recovery.',
    );
  }
}

async function recoverCleanupGuard(lockPath, existing, cleanupGuard) {
  if (!sameCleanupOwner(cleanupGuard.sentinel, existing.owner)) {
    throw cleanupGuardError(lockPath, null, false);
  }
  if (
    cleanupGuard.sentinel.state !== 'cleanup-pending' ||
    !processGroupAbsentOnce(cleanupGuard.sentinel.processGroupId)
  ) {
    throw cleanupGuardError(lockPath, cleanupGuard);
  }
  await assertLockUnchanged(lockPath, existing.receipt);
  await assertLockUnchanged(cleanupSentinelPath(lockPath), cleanupGuard.receipt);
  const quarantineName = `${cleanupSentinelPath(lockPath)}.recovered-${Date.now()}-${cleanupGuard.sentinel.owner.processIdentity.slice(-12)}-${randomBytes(4).toString('hex')}`;
  await rename(cleanupSentinelPath(lockPath), quarantineName);
  await syncDirectory(path.dirname(lockPath));
}

export async function acquireRunLock(
  manifestPath,
  {
    observeHostname = os.hostname,
    observeProcessStartIdentity = observeProcessStartIdentityWithPs,
    onBeforeStaleQuarantine,
    onCleanupGuardWrite,
  } = {},
) {
  if (typeof observeHostname !== 'function') {
    throw new TypeError('Benchmark lock hostname observer must be a function.');
  }
  if (typeof observeProcessStartIdentity !== 'function') {
    throw new TypeError('Benchmark lock process-identity observer must be a function.');
  }
  if (
    onBeforeStaleQuarantine !== undefined &&
    typeof onBeforeStaleQuarantine !== 'function'
  ) {
    throw new TypeError('onBeforeStaleQuarantine must be a function when provided.');
  }
  if (
    onCleanupGuardWrite !== undefined &&
    typeof onCleanupGuardWrite !== 'function'
  ) {
    throw new TypeError('onCleanupGuardWrite must be a function when provided.');
  }
  const lockPath = `${manifestPath}.lock`;
  const owner = await currentOwner(observeHostname, observeProcessStartIdentity);
  const guard = await acquireRecoveryGuard(
    lockPath,
    owner,
    observeHostname,
    observeProcessStartIdentity,
  );
  try {
    let cleanupGuard = await readCleanupGuard(lockPath);
    if (cleanupGuard !== null) {
      if (cleanupGuard.sentinel.state === 'cleanup-unproven') {
        throw cleanupGuardError(lockPath, cleanupGuard);
      }
      let existing;
      try {
        existing = await readLockOwner(lockPath);
      } catch (error) {
        if (error?.code === 'ENOENT') throw cleanupGuardError(lockPath, cleanupGuard);
        throw error;
      }
      if (!(await ownerIsStale(
        existing.owner,
        observeHostname,
        observeProcessStartIdentity,
      ))) {
        throw new BenchmarkStorageError(
          'benchmark_locked',
          'Another live process owns the machine-wide benchmark lock.',
          { owner: existing.owner },
        );
      }
      await recoverCleanupGuard(lockPath, existing, cleanupGuard);
      await quarantineStaleLock(lockPath, existing);
      await writeLockExclusive(lockPath, owner);
      return ownedLockHandle(lockPath, owner, { onCleanupGuardWrite });
    }
    try {
      await writeLockExclusive(lockPath, owner);
      return ownedLockHandle(lockPath, owner, { onCleanupGuardWrite });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readLockOwner(lockPath);
      if (!(await ownerIsStale(
        existing.owner,
        observeHostname,
        observeProcessStartIdentity,
      ))) {
        throw new BenchmarkStorageError(
          'benchmark_locked',
          'Another live process owns the machine-wide benchmark lock.',
          { owner: existing.owner },
        );
      }
      await onBeforeStaleQuarantine?.();
      cleanupGuard = await readCleanupGuard(lockPath);
      if (cleanupGuard !== null) {
        await recoverCleanupGuard(lockPath, existing, cleanupGuard);
      }
      await quarantineStaleLock(lockPath, existing);
      await writeLockExclusive(lockPath, owner);
      return ownedLockHandle(lockPath, owner, { onCleanupGuardWrite });
    }
  } finally {
    await guard.release();
  }
}
