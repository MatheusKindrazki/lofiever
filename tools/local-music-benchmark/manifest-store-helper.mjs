import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';

const PROTOCOL_VERSION = 'lofiever-confined-output-v1';
// Standalone --eval source: limits.mjs tests pin these reviewed literal twins.
const MAX_FRAME_BYTES = 96 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_RETAINED_DIRECTORIES = 512;
const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const RECOVERABLE_ERROR_CODES = new Set([
  'benchmark_lock_exists',
  'confined_file_missing',
  'benchmark_lock_identity_changed',
]);
const noFollow = constants.O_NOFOLLOW ?? 0;
const directoryOnly = constants.O_DIRECTORY ?? 0;

class HelperError extends Error {
  constructor(code, { silent = false } = {}) {
    super(code);
    this.code = code;
    this.silent = silent;
  }
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function receipt(stats) {
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    uid: Number(stats.uid),
    mode: Number(stats.mode & 0o7777n),
  };
}

function sameReceipt(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.uid === right.uid &&
    left.mode === right.mode
  );
}

function parseRelativePath(relativePath, { file = false } = {}) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length < 1 ||
    relativePath.length > 4096 ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    relativePath.startsWith('/')
  ) {
    throw new HelperError('confined_relative_path_required');
  }
  const components = relativePath.split('/');
  if (
    components.some(
      (component) =>
        !SAFE_COMPONENT.test(component) || component === '.' || component === '..',
    )
  ) {
    throw new HelperError('confined_relative_path_required');
  }
  if (file && components.length < 1) {
    throw new HelperError('confined_file_required');
  }
  return components;
}

async function openDotReceipt() {
  const handle = await open('.', constants.O_RDONLY | noFollow | directoryOnly);
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isDirectory()) throw new HelperError('confined_directory_required');
    return receipt(stats);
  } finally {
    await handle.close();
  }
}

// This is deliberately the helper's first filesystem/protocol action. The
// parent accepts no command until this cwd capability matches its retained fd.
const rootHandle = await open('.', constants.O_RDONLY | noFollow | directoryOnly);
const rootStats = await rootHandle.stat({ bigint: true });
if (!rootStats.isDirectory()) process.exit(97);
const rootReceipt = receipt(rootStats);
let currentReceipt = rootReceipt;
let shuttingDown = false;
const retainedDirectories = new Map([
  ['', { handle: rootHandle, receipt: rootReceipt }],
]);

async function assertCurrentDirectory(expected, retainedHandle) {
  const observed = await openDotReceipt();
  const retained = receipt(await retainedHandle.stat({ bigint: true }));
  if (!sameReceipt(observed, expected) || !sameReceipt(retained, expected)) {
    throw new HelperError('confined_directory_changed', { silent: true });
  }
}

async function enterDirectories(components, { create }) {
  await assertCurrentDirectory(rootReceipt, rootHandle);
  currentReceipt = rootReceipt;
  const chain = [{ handle: rootHandle, receipt: rootReceipt }];
  let relativePath = '';
  for (const component of components) {
    relativePath = relativePath === '' ? component : `${relativePath}/${component}`;
    if (create) {
      try {
        await mkdir(component, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    let childHandle;
    try {
      childHandle = await open(
        component,
        constants.O_RDONLY | noFollow | directoryOnly,
      );
    } catch (error) {
      if (error?.code === 'ENOENT' && !create) {
        throw new HelperError('confined_file_missing');
      }
      throw new HelperError('confined_path_changed');
    }
    const [descriptor, pathStats] = await Promise.all([
      childHandle.stat({ bigint: true }),
      lstat(component, { bigint: true }),
    ]);
    const childReceipt = receipt(descriptor);
    if (
      pathStats.isSymbolicLink() ||
      !descriptor.isDirectory() ||
      descriptor.dev !== pathStats.dev ||
      descriptor.ino !== pathStats.ino
    ) {
      await childHandle.close();
      throw new HelperError('confined_path_changed');
    }
    const retained = retainedDirectories.get(relativePath);
    if (retained !== undefined && !sameReceipt(childReceipt, retained.receipt)) {
      await childHandle.close();
      throw new HelperError('confined_directory_changed');
    }
    let activeDirectory = retained;
    if (activeDirectory === undefined) {
      if (retainedDirectories.size >= MAX_RETAINED_DIRECTORIES) {
        await childHandle.close();
        throw new HelperError('manifest_store_directory_limit');
      }
      activeDirectory = { handle: childHandle, receipt: childReceipt };
      retainedDirectories.set(relativePath, activeDirectory);
      childHandle = null;
    }
    process.chdir(component);
    // No read, write, log, or path resolution may occur before this handshake.
    const cwdReceipt = await openDotReceipt();
    if (!sameReceipt(cwdReceipt, activeDirectory.receipt)) {
      await childHandle?.close();
      throw new HelperError('confined_directory_changed', { silent: true });
    }
    await childHandle?.close();
    currentReceipt = activeDirectory.receipt;
    chain.push(activeDirectory);
  }
  return chain;
}

async function leaveToRoot(chain) {
  for (let index = chain.length - 1; index > 0; index -= 1) {
    process.chdir('..');
    // As on descent, this must be the first action after chdir.
    const parentReceipt = await openDotReceipt();
    const expectedParent = chain[index - 1].receipt;
    if (!sameReceipt(parentReceipt, expectedParent)) {
      throw new HelperError('confined_directory_changed', { silent: true });
    }
    currentReceipt = parentReceipt;
  }
  await assertCurrentDirectory(rootReceipt, rootHandle);
  currentReceipt = rootReceipt;
}

async function withDirectory(components, options, operation) {
  let chain = null;
  try {
    chain = await enterDirectories(components, options);
    const value = await operation(chain.at(-1).handle);
    await assertCurrentDirectory(chain.at(-1).receipt, chain.at(-1).handle);
    return value;
  } finally {
    if (chain !== null) await leaveToRoot(chain);
  }
}

function sameFileMetadata(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function fileReceipt(stats, sha256) {
  return {
    bytes: Number(stats.size),
    device: String(stats.dev),
    inode: String(stats.ino),
    uid: Number(stats.uid),
    mode: Number(stats.mode & 0o7777n),
    size: String(stats.size),
    mtimeNs: String(stats.mtimeNs),
    ctimeNs: String(stats.ctimeNs),
    sha256,
  };
}

async function readHandleBytes(handle, size) {
  if (size > BigInt(MAX_FILE_BYTES)) {
    throw new HelperError('manifest_store_file_too_large');
  }
  const bytes = Buffer.alloc(Number(size));
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  if (offset !== bytes.length) throw new HelperError('confined_file_changed');
  return bytes;
}

async function assertLeafNotSymlink(name) {
  try {
    const stats = await lstat(name, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new HelperError('confined_file_changed');
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}

async function lstatStableLeaf(name) {
  try {
    return await lstat(name, { bigint: true });
  } catch {
    throw new HelperError('confined_file_changed');
  }
}

async function ensureDirectory(relativePath) {
  const components = parseRelativePath(relativePath);
  return withDirectory(components, { create: true }, async (directoryHandle) => {
    const stats = await directoryHandle.stat({ bigint: true });
    return receipt(stats);
  });
}

async function writeStableFile(relativePath, data, expectedFile = null) {
  if (typeof data !== 'string') throw new HelperError('manifest_store_data_required');
  const bytes = Buffer.byteLength(data, 'utf8');
  if (bytes > MAX_FILE_BYTES) throw new HelperError('manifest_store_file_too_large');
  const components = parseRelativePath(relativePath, { file: true });
  const name = components.pop();
  return withDirectory(components, { create: true }, async (directoryHandle) => {
    async function readCurrentFileReceipt() {
      let existingHandle;
      try {
        existingHandle = await open(name, constants.O_RDONLY | noFollow);
      } catch (error) {
        if (error?.code === 'ENOENT') throw new HelperError('confined_file_missing');
        throw new HelperError('confined_file_changed');
      }
      try {
        const before = await existingHandle.stat({ bigint: true });
        const pathBefore = await lstatStableLeaf(name);
        if (
          !before.isFile() ||
          pathBefore.isSymbolicLink() ||
          !sameFileMetadata(before, pathBefore)
        ) {
          throw new HelperError('confined_file_changed');
        }
        const existingBytes = await readHandleBytes(existingHandle, before.size);
        const after = await existingHandle.stat({ bigint: true });
        if (!sameFileMetadata(before, after)) {
          throw new HelperError('confined_file_changed');
        }
        return fileReceipt(
          after,
          `sha256:${createHash('sha256').update(existingBytes).digest('hex')}`,
        );
      } finally {
        await existingHandle.close();
      }
    }
    if (expectedFile === null) {
      await assertLeafNotSymlink(name);
    } else if (!sameValue(await readCurrentFileReceipt(), expectedFile)) {
      throw new HelperError('benchmark_lock_identity_changed');
    }
    const temporaryName = `.tmp-${process.pid}-${randomBytes(16).toString('hex')}`;
    let temporaryHandle = null;
    let published = false;
    try {
      temporaryHandle = await open(
        temporaryName,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      );
      await temporaryHandle.writeFile(data, 'utf8');
      await temporaryHandle.sync();
      const [temporaryBefore, pathStats] = await Promise.all([
        temporaryHandle.stat({ bigint: true }),
        lstatStableLeaf(temporaryName),
      ]);
      if (
        !temporaryBefore.isFile() ||
        pathStats.isSymbolicLink() ||
        !sameFileMetadata(temporaryBefore, pathStats) ||
        temporaryBefore.size !== BigInt(bytes)
      ) {
        throw new HelperError('confined_file_changed');
      }
      const temporaryBytes = await readHandleBytes(temporaryHandle, temporaryBefore.size);
      const temporaryAfter = await temporaryHandle.stat({ bigint: true });
      const intendedSha256 = `sha256:${createHash('sha256').update(data, 'utf8').digest('hex')}`;
      if (
        !sameFileMetadata(temporaryBefore, temporaryAfter) ||
        `sha256:${createHash('sha256').update(temporaryBytes).digest('hex')}` !== intendedSha256
      ) {
        throw new HelperError('confined_file_changed');
      }
      if (expectedFile !== null && !sameValue(await readCurrentFileReceipt(), expectedFile)) {
        throw new HelperError('benchmark_lock_identity_changed');
      }
      await assertCurrentDirectory(currentReceipt, directoryHandle);
      await rename(temporaryName, name);
      published = true;
      await directoryHandle.sync();
      const [publishedBefore, publishedPathStats] = await Promise.all([
        temporaryHandle.stat({ bigint: true }),
        lstatStableLeaf(name),
      ]);
      if (
        publishedPathStats.isSymbolicLink() ||
        !sameFileMetadata(publishedBefore, publishedPathStats)
      ) {
        throw new HelperError('confined_file_changed');
      }
      const publishedBytes = await readHandleBytes(temporaryHandle, publishedBefore.size);
      const publishedAfter = await temporaryHandle.stat({ bigint: true });
      const publishedSha256 = `sha256:${createHash('sha256').update(publishedBytes).digest('hex')}`;
      if (
        !sameFileMetadata(publishedBefore, publishedAfter) ||
        publishedSha256 !== intendedSha256
      ) {
        throw new HelperError('confined_file_changed');
      }
      await assertCurrentDirectory(currentReceipt, directoryHandle);
      return fileReceipt(publishedAfter, publishedSha256);
    } finally {
      await temporaryHandle?.close().catch(() => {});
      if (!published) await unlink(temporaryName).catch(() => {});
    }
  });
}

async function createExclusiveStableFile(relativePath, data) {
  if (typeof data !== 'string') throw new HelperError('manifest_store_data_required');
  const bytes = Buffer.byteLength(data, 'utf8');
  if (bytes > MAX_FILE_BYTES) throw new HelperError('manifest_store_file_too_large');
  const components = parseRelativePath(relativePath, { file: true });
  const name = components.pop();
  return withDirectory(components, { create: true }, async (directoryHandle) => {
    const temporaryName = `.lock-publish-${process.pid}-${randomBytes(16).toString('hex')}`;
    let handle;
    let linked = false;
    try {
      handle = await open(
        temporaryName,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600,
      );
      await handle.writeFile(data, 'utf8');
      await handle.sync();
      const before = await handle.stat({ bigint: true });
      const pathBefore = await lstatStableLeaf(temporaryName);
      if (
        !before.isFile() ||
        pathBefore.isSymbolicLink() ||
        !sameFileMetadata(before, pathBefore) ||
        before.size !== BigInt(bytes)
      ) {
        throw new HelperError('confined_file_changed');
      }
      const persisted = await readHandleBytes(handle, before.size);
      const after = await handle.stat({ bigint: true });
      const sha256 = `sha256:${createHash('sha256').update(persisted).digest('hex')}`;
      const expectedSha256 = `sha256:${createHash('sha256').update(data, 'utf8').digest('hex')}`;
      if (!sameFileMetadata(before, after) || sha256 !== expectedSha256) {
        throw new HelperError('confined_file_changed');
      }
      try {
        await link(temporaryName, name);
        linked = true;
      } catch (error) {
        if (error?.code === 'EEXIST') throw new HelperError('benchmark_lock_exists');
        throw error;
      }
      await directoryHandle.sync();
      const [linkedStats, linkedPathStats] = await Promise.all([
        handle.stat({ bigint: true }),
        lstatStableLeaf(name),
      ]);
      if (
        linkedPathStats.isSymbolicLink() ||
        !sameFileMetadata(linkedStats, linkedPathStats)
      ) {
        throw new HelperError('confined_file_changed');
      }
      await unlink(temporaryName);
      await directoryHandle.sync();
      const [publishedStats, publishedPathStats] = await Promise.all([
        handle.stat({ bigint: true }),
        lstatStableLeaf(name),
      ]);
      const publishedBytes = await readHandleBytes(handle, publishedStats.size);
      const finalStats = await handle.stat({ bigint: true });
      if (
        publishedPathStats.isSymbolicLink() ||
        !sameFileMetadata(publishedStats, publishedPathStats) ||
        !sameFileMetadata(publishedStats, finalStats) ||
        `sha256:${createHash('sha256').update(publishedBytes).digest('hex')}` !== sha256
      ) {
        throw new HelperError('confined_file_changed');
      }
      await assertCurrentDirectory(currentReceipt, directoryHandle);
      return fileReceipt(finalStats, sha256);
    } finally {
      await handle?.close().catch(() => {});
      if (!linked) await unlink(temporaryName).catch(() => {});
    }
  });
}

async function readStableFile(relativePath, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FILE_BYTES) {
    throw new HelperError('manifest_store_read_bound_invalid');
  }
  const components = parseRelativePath(relativePath, { file: true });
  const name = components.pop();
  try {
    return await withDirectory(components, { create: false }, async (directoryHandle) => {
      let handle;
      try {
        handle = await open(name, constants.O_RDONLY | noFollow);
      } catch (error) {
        if (error?.code === 'ENOENT') throw new HelperError('confined_file_missing');
        throw new HelperError('confined_file_changed');
      }
      try {
        const [before, pathBefore] = await Promise.all([
          handle.stat({ bigint: true }),
          lstatStableLeaf(name),
        ]);
        if (!before.isFile()) throw new HelperError('confined_file_changed');
        if (pathBefore.isSymbolicLink() || !sameFileMetadata(before, pathBefore)) {
          throw new HelperError('confined_file_changed');
        }
        if (before.size > BigInt(maxBytes)) {
          throw new HelperError('manifest_store_file_too_large');
        }
        const data = await readHandleBytes(handle, before.size);
        const [after, pathAfter] = await Promise.all([
          handle.stat({ bigint: true }),
          lstatStableLeaf(name),
        ]);
        if (
          pathAfter.isSymbolicLink() ||
          !sameFileMetadata(before, after) ||
          !sameFileMetadata(after, pathAfter) ||
          data.length !== Number(after.size)
        ) {
          throw new HelperError('confined_file_changed');
        }
        await assertCurrentDirectory(currentReceipt, directoryHandle);
        return {
          data: data.toString('base64'),
          file: fileReceipt(
            after,
            `sha256:${createHash('sha256').update(data).digest('hex')}`,
          ),
        };
      } finally {
        await handle?.close().catch(() => {});
      }
    });
  } catch (error) {
    if (error?.code === 'confined_file_missing') return null;
    throw error;
  }
}

async function renameStableFile(sourcePath, destinationPath, expectedFile = null) {
  const source = parseRelativePath(sourcePath, { file: true });
  const destination = parseRelativePath(destinationPath, { file: true });
  const sourceName = source.pop();
  const destinationName = destination.pop();
  if (JSON.stringify(source) !== JSON.stringify(destination)) {
    throw new HelperError('manifest_store_same_directory_rename_required');
  }
  return withDirectory(source, { create: false }, async (directoryHandle) => {
    await assertLeafNotSymlink(destinationName);
    let handle;
    try {
      handle = await open(sourceName, constants.O_RDONLY | noFollow);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new HelperError('confined_file_missing');
      throw new HelperError('confined_file_changed');
    }
    try {
      const descriptor = await handle.stat({ bigint: true });
      let sourceStats;
      try {
        sourceStats = await lstat(sourceName, { bigint: true });
      } catch (error) {
        if (expectedFile !== null && error?.code === 'ENOENT') {
          throw new HelperError('benchmark_lock_identity_changed');
        }
        throw new HelperError('confined_file_changed');
      }
      if (
        !descriptor.isFile() ||
        sourceStats.isSymbolicLink() ||
        !sameFileMetadata(descriptor, sourceStats)
      ) {
        throw new HelperError(
          expectedFile === null
            ? 'confined_file_changed'
            : 'benchmark_lock_identity_changed',
        );
      }
      const sourceBytes = await readHandleBytes(handle, descriptor.size);
      const sourceAfterRead = await handle.stat({ bigint: true });
      const sourceSha256 = `sha256:${createHash('sha256').update(sourceBytes).digest('hex')}`;
      const observedSource = fileReceipt(sourceAfterRead, sourceSha256);
      if (!sameFileMetadata(descriptor, sourceAfterRead)) {
        throw new HelperError(
          expectedFile === null
            ? 'confined_file_changed'
            : 'benchmark_lock_identity_changed',
        );
      }
      if (expectedFile !== null && !sameValue(observedSource, expectedFile)) {
        throw new HelperError('benchmark_lock_identity_changed');
      }
      await assertCurrentDirectory(currentReceipt, directoryHandle);
      try {
        await rename(sourceName, destinationName);
      } catch (error) {
        if (error?.code === 'ENOENT') throw new HelperError('confined_file_missing');
        if (error?.code === 'EEXIST') throw new HelperError('benchmark_lock_identity_changed');
        throw new HelperError('confined_file_changed');
      }
      await directoryHandle.sync();
      const [destinationBefore, destinationPathStats] = await Promise.all([
        handle.stat({ bigint: true }),
        lstatStableLeaf(destinationName),
      ]);
      if (
        destinationPathStats.isSymbolicLink() ||
        !sameFileMetadata(destinationBefore, destinationPathStats)
      ) {
        throw new HelperError('confined_file_changed');
      }
      const destinationBytes = await readHandleBytes(handle, destinationBefore.size);
      const destinationAfter = await handle.stat({ bigint: true });
      if (
        !sameFileMetadata(destinationBefore, destinationAfter) ||
        `sha256:${createHash('sha256').update(destinationBytes).digest('hex')}` !== sourceSha256
      ) {
        throw new HelperError('confined_file_changed');
      }
      await assertCurrentDirectory(currentReceipt, directoryHandle);
      return fileReceipt(destinationAfter, sourceSha256);
    } finally {
      await handle?.close().catch(() => {});
    }
  });
}

async function removeStableFile(relativePath, expectedFile) {
  const components = parseRelativePath(relativePath, { file: true });
  const name = components.pop();
  return withDirectory(components, { create: false }, async (directoryHandle) => {
    let handle;
    try {
      handle = await open(name, constants.O_RDONLY | noFollow);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new HelperError('confined_file_missing');
      throw new HelperError('confined_file_changed');
    }
    try {
      const before = await handle.stat({ bigint: true });
      const pathBefore = await lstatStableLeaf(name);
      if (
        !before.isFile() ||
        pathBefore.isSymbolicLink() ||
        !sameFileMetadata(before, pathBefore)
      ) {
        throw new HelperError('confined_file_changed');
      }
      const bytes = await readHandleBytes(handle, before.size);
      const after = await handle.stat({ bigint: true });
      const observed = fileReceipt(
        after,
        `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      );
      if (!sameFileMetadata(before, after) || !sameValue(observed, expectedFile)) {
        throw new HelperError('benchmark_lock_identity_changed');
      }
      await assertCurrentDirectory(currentReceipt, directoryHandle);
      await unlink(name);
      await directoryHandle.sync();
      return observed;
    } finally {
      await handle.close();
    }
  });
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

emit({
  protocolVersion: PROTOCOL_VERSION,
  type: 'ready',
  root: rootReceipt,
});

function assertRequest(request) {
  if (
    request === null ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    request.protocolVersion !== PROTOCOL_VERSION ||
    !Number.isInteger(request.requestId) ||
    request.requestId < 1 ||
    typeof request.type !== 'string'
  ) {
    throw new HelperError('manifest_store_protocol_invalid');
  }
  const keys = {
    'confirm-ready': ['protocolVersion', 'requestId', 'type'],
    'ensure-directory': ['protocolVersion', 'requestId', 'type', 'path'],
    write: ['protocolVersion', 'requestId', 'type', 'path', 'data'],
    replace: ['protocolVersion', 'requestId', 'type', 'path', 'data', 'expectedFile'],
    'create-exclusive': ['protocolVersion', 'requestId', 'type', 'path', 'data'],
    read: ['protocolVersion', 'requestId', 'type', 'path', 'maxBytes'],
    rename: [
      'protocolVersion',
      'requestId',
      'type',
      'sourcePath',
      'destinationPath',
      'expectedFile',
    ],
    remove: ['protocolVersion', 'requestId', 'type', 'path', 'expectedFile'],
    'shutdown-and-release': [
      'protocolVersion',
      'requestId',
      'type',
      'lockPath',
      'guardPath',
      'expectedLock',
    ],
    shutdown: ['protocolVersion', 'requestId', 'type'],
  }[request.type];
  if (keys === undefined || !exactKeys(request, keys)) {
    throw new HelperError('manifest_store_protocol_invalid');
  }
}

async function handleRequest(request) {
  assertRequest(request);
  const base = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: request.requestId,
  };
  if (request.type === 'confirm-ready') {
    return { ...base, type: 'ready-confirmed' };
  }
  if (request.type === 'ensure-directory') {
    const directory = await ensureDirectory(request.path);
    return { ...base, type: 'directory-ready', path: request.path, directory };
  }
  if (request.type === 'write') {
    const file = await writeStableFile(request.path, request.data);
    return { ...base, type: 'write-complete', path: request.path, file };
  }
  if (request.type === 'replace') {
    const file = await writeStableFile(
      request.path,
      request.data,
      request.expectedFile,
    );
    return { ...base, type: 'replace-complete', path: request.path, file };
  }
  if (request.type === 'create-exclusive') {
    const file = await createExclusiveStableFile(request.path, request.data);
    return { ...base, type: 'create-exclusive-complete', path: request.path, file };
  }
  if (request.type === 'read') {
    const result = await readStableFile(request.path, request.maxBytes);
    return result === null
      ? { ...base, type: 'file-missing', path: request.path }
      : { ...base, type: 'read-complete', path: request.path, ...result };
  }
  if (request.type === 'rename') {
    const file = await renameStableFile(
      request.sourcePath,
      request.destinationPath,
      request.expectedFile,
    );
    return {
      ...base,
      type: 'rename-complete',
      sourcePath: request.sourcePath,
      destinationPath: request.destinationPath,
      file,
    };
  }
  if (request.type === 'remove') {
    const file = await removeStableFile(request.path, request.expectedFile);
    return { ...base, type: 'remove-complete', path: request.path, file };
  }
  if (request.type === 'shutdown-and-release') {
    const firstGuard = await readStableFile(request.guardPath, 64 * 1024);
    if (firstGuard !== null) throw new HelperError('benchmark_lock_cleanup_pending');
    const lock = await readStableFile(request.lockPath, 64 * 1024);
    if (lock === null || !sameValue(lock.file, request.expectedLock)) {
      throw new HelperError('benchmark_lock_identity_changed');
    }
    const finalGuard = await readStableFile(request.guardPath, 64 * 1024);
    if (finalGuard !== null) throw new HelperError('benchmark_lock_cleanup_pending');
    if (queuedRequests !== 1 || input.length !== 0) {
      throw new HelperError('manifest_store_trailing_output');
    }
    shuttingDown = true;
    const removed = await removeStableFile(request.lockPath, request.expectedLock);
    return {
      ...base,
      type: 'shutdown-release-complete',
      lockPath: request.lockPath,
      file: removed,
    };
  }
  shuttingDown = true;
  return { ...base, type: 'shutdown-complete' };
}

let input = Buffer.alloc(0);
let active = Promise.resolve();
let queuedRequests = 0;
process.stdin.on('data', (chunk) => {
  if (shuttingDown) process.exit(98);
  input = Buffer.concat([input, chunk]);
  if (input.length > MAX_FRAME_BYTES) process.exit(99);
  while (true) {
    const newline = input.indexOf(0x0a);
    if (newline === -1) break;
    const line = input.subarray(0, newline);
    input = input.subarray(newline + 1);
    queuedRequests += 1;
    active = active.then(async () => {
      let request;
      try {
        request = JSON.parse(line.toString('utf8'));
        const response = await handleRequest(request);
        emit(response);
        if (['shutdown-complete', 'shutdown-release-complete'].includes(response.type)) {
          for (const retained of [...retainedDirectories.values()].reverse()) {
            await retained.handle.close();
          }
          retainedDirectories.clear();
          process.stdin.pause();
        }
      } catch (error) {
        if (error?.silent === true) process.exit(96);
        const requestId = Number.isInteger(request?.requestId) ? request.requestId : 0;
        const response = {
          protocolVersion: PROTOCOL_VERSION,
          requestId,
          type: 'error',
          code: typeof error?.code === 'string' ? error.code : 'manifest_store_helper_failed',
        };
        if (RECOVERABLE_ERROR_CODES.has(response.code)) {
          emit(response);
          return;
        }
        process.stdout.write(`${JSON.stringify(response)}\n`, async () => {
          for (const retained of [...retainedDirectories.values()].reverse()) {
            await retained.handle.close().catch(() => {});
          }
          retainedDirectories.clear();
          process.exit(95);
        });
      } finally {
        queuedRequests -= 1;
      }
    });
  }
});

process.stdin.on('end', () => {
  if (!shuttingDown || input.length !== 0) process.exitCode = 94;
});
