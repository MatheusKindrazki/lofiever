import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openPrivateDirectory } from './storage.mjs';
import {
  MAX_ADAPTER_OUTPUT_BYTES,
  MAX_CONFINED_PROTOCOL_BYTES,
} from './limits.mjs';

const PROTOCOL_VERSION = 'lofiever-confined-output-v1';
const MAX_PROTOCOL_BUFFER_BYTES = MAX_CONFINED_PROTOCOL_BYTES;
const MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const DEFAULT_STARTUP_TIMEOUT_MILLISECONDS = 10_000;
const helperPath = fileURLToPath(new URL('./manifest-store-helper.mjs', import.meta.url));
const EXPECTED_HELPER_SHA256 =
  'sha256:8e5c803b3962a57eab60bb8c176545fb04193e2cd95b2e5f8c33b949eb9c3c2f';
const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export class ConfinedOutputStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ConfinedOutputStoreError';
    this.code = code;
    this.details = details;
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

function assertIdentity(identity, label = 'directory identity') {
  if (
    !exactKeys(identity, ['device', 'inode', 'uid', 'mode']) ||
    !/^[0-9]+$/u.test(identity.device) ||
    !/^[0-9]+$/u.test(identity.inode) ||
    !Number.isInteger(identity.uid) ||
    identity.uid < 0 ||
    !Number.isInteger(identity.mode) ||
    identity.mode < 0 ||
    identity.mode > 0o7777
  ) {
    throw new ConfinedOutputStoreError(
      'manifest_store_protocol_invalid',
      `Confined output helper returned an invalid ${label}.`,
    );
  }
  return identity;
}

function sameIdentity(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.uid === right.uid &&
    left.mode === right.mode
  );
}

function expectedRootIdentity(storageRoot) {
  return {
    device: storageRoot.device,
    inode: storageRoot.inode,
    uid: storageRoot.uid,
    mode: storageRoot.mode,
  };
}

export function validateConfinedOutputReadyFrame(frame, expectedIdentity) {
  if (
    !exactKeys(frame, ['protocolVersion', 'type', 'root']) ||
    frame.protocolVersion !== PROTOCOL_VERSION ||
    frame.type !== 'ready'
  ) {
    throw new ConfinedOutputStoreError(
      'manifest_store_handshake_invalid',
      'Confined output helper did not return the exact ready handshake.',
    );
  }
  const observed = assertIdentity(frame.root, 'root identity');
  if (!sameIdentity(observed, expectedIdentity)) {
    throw new ConfinedOutputStoreError(
      'manifest_store_root_mismatch',
      'Confined output helper cwd does not match the retained output root.',
      { expected: expectedIdentity, observed },
    );
  }
  return frame;
}

function assertRelativePath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length < 1 ||
    relativePath.length > 4096 ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    path.isAbsolute(relativePath)
  ) {
    throw new ConfinedOutputStoreError(
      'confined_relative_path_required',
      'Confined output operations require a relative path.',
    );
  }
  const components = relativePath.split('/');
  if (
    components.some(
      (component) =>
        !SAFE_COMPONENT.test(component) || component === '.' || component === '..',
    )
  ) {
    throw new ConfinedOutputStoreError(
      'confined_relative_path_required',
      'Confined output path contains a forbidden component.',
    );
  }
  return components.join('/');
}

function boundedTextBytes(data) {
  if (typeof data !== 'string') {
    throw new TypeError('Confined output text data must be a string.');
  }
  const bytes = Buffer.byteLength(data, 'utf8');
  if (bytes > MAX_ADAPTER_OUTPUT_BYTES) {
    throw new ConfinedOutputStoreError(
      'manifest_store_file_too_large',
      'Confined text output exceeds the 16 MiB manifest/sidecar bound.',
      { bytes, maxBytes: MAX_ADAPTER_OUTPUT_BYTES },
    );
  }
  return bytes;
}

function validateFileReceipt(value, { sha256 }) {
  const keys = [
    'bytes',
    'device',
    'inode',
    'uid',
    'mode',
    'size',
    'mtimeNs',
    'ctimeNs',
    'sha256',
  ];
  if (
    !exactKeys(value, keys) ||
    !Number.isInteger(value.bytes) ||
    value.bytes < 0 ||
    !/^[0-9]+$/u.test(value.device) ||
    !/^[0-9]+$/u.test(value.inode) ||
    !Number.isInteger(value.uid) ||
    value.uid < 0 ||
    !Number.isInteger(value.mode) ||
    value.mode < 0 ||
    value.mode > 0o7777 ||
    !/^[0-9]+$/u.test(value.size) ||
    !/^[0-9]+$/u.test(value.mtimeNs) ||
    !/^[0-9]+$/u.test(value.ctimeNs) ||
    Number(value.size) !== value.bytes ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.sha256)
  ) {
    throw new ConfinedOutputStoreError(
      'manifest_store_protocol_invalid',
      'Confined output helper returned an invalid file receipt.',
    );
  }
  return value;
}

function validateResponse(frame, requestId, expectedTypes) {
  if (
    frame === null ||
    typeof frame !== 'object' ||
    Array.isArray(frame) ||
    frame.protocolVersion !== PROTOCOL_VERSION ||
    frame.requestId !== requestId ||
    typeof frame.type !== 'string'
  ) {
    throw new ConfinedOutputStoreError(
      'manifest_store_protocol_invalid',
      'Confined output helper returned an uncorrelated response.',
    );
  }
  if (frame.type === 'error') {
    if (
      !exactKeys(frame, ['protocolVersion', 'requestId', 'type', 'code']) ||
      !/^[a-z][a-z0-9_]{0,127}$/u.test(frame.code)
    ) {
      throw new ConfinedOutputStoreError(
        'manifest_store_protocol_invalid',
        'Confined output helper returned an invalid error receipt.',
        {
          observedCode:
            typeof frame.code === 'string' ? frame.code.slice(0, 128) : null,
          keyCount: Object.keys(frame).length,
        },
      );
    }
    throw new ConfinedOutputStoreError(
      frame.code,
      `Confined output helper rejected request ${requestId}.`,
    );
  }
  if (!expectedTypes.includes(frame.type)) {
    throw new ConfinedOutputStoreError(
      'manifest_store_protocol_invalid',
      'Confined output helper returned an unexpected response type.',
      { expectedTypes, actualType: frame.type },
    );
  }
  if (frame.type === 'directory-ready') {
    if (!exactKeys(frame, ['protocolVersion', 'requestId', 'type', 'path', 'directory'])) {
      throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid directory receipt.');
    }
    assertRelativePath(frame.path);
    assertIdentity(frame.directory);
  } else if (frame.type === 'write-complete') {
    if (!exactKeys(frame, ['protocolVersion', 'requestId', 'type', 'path', 'file'])) {
      throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid write receipt.');
    }
    assertRelativePath(frame.path);
    validateFileReceipt(frame.file, { sha256: true });
  } else if (frame.type === 'replace-complete') {
    if (!exactKeys(frame, ['protocolVersion', 'requestId', 'type', 'path', 'file'])) {
      throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid replace receipt.');
    }
    assertRelativePath(frame.path);
    validateFileReceipt(frame.file, { sha256: true });
  } else if (frame.type === 'create-exclusive-complete') {
    if (!exactKeys(frame, ['protocolVersion', 'requestId', 'type', 'path', 'file'])) {
      throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid exclusive-create receipt.');
    }
    assertRelativePath(frame.path);
    validateFileReceipt(frame.file, { sha256: true });
  } else if (frame.type === 'read-complete') {
    if (!exactKeys(frame, ['protocolVersion', 'requestId', 'type', 'path', 'data', 'file'])) {
      throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid read receipt.');
    }
    assertRelativePath(frame.path);
    if (typeof frame.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/u.test(frame.data)) {
      throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid read payload.');
    }
    validateFileReceipt(frame.file, { sha256: true });
  } else if (frame.type === 'file-missing') {
    if (!exactKeys(frame, ['protocolVersion', 'requestId', 'type', 'path'])) {
      throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid missing-file receipt.');
    }
    assertRelativePath(frame.path);
  } else if (frame.type === 'rename-complete') {
    if (
      !exactKeys(frame, [
        'protocolVersion',
        'requestId',
        'type',
        'sourcePath',
        'destinationPath',
        'file',
      ])
    ) {
      throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid rename receipt.');
    }
    assertRelativePath(frame.sourcePath);
    assertRelativePath(frame.destinationPath);
    validateFileReceipt(frame.file, { sha256: true });
  } else if (frame.type === 'remove-complete') {
    if (!exactKeys(frame, ['protocolVersion', 'requestId', 'type', 'path', 'file'])) {
      throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid remove receipt.');
    }
    assertRelativePath(frame.path);
    validateFileReceipt(frame.file, { sha256: true });
  } else if (
    frame.type === 'ready-confirmed' &&
    !exactKeys(frame, ['protocolVersion', 'requestId', 'type'])
  ) {
    throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid ready boundary receipt.');
  } else if (
    frame.type === 'shutdown-complete' &&
    !exactKeys(frame, ['protocolVersion', 'requestId', 'type'])
  ) {
    throw new ConfinedOutputStoreError('manifest_store_protocol_invalid', 'Invalid shutdown receipt.');
  } else if (frame.type === 'shutdown-release-complete') {
    if (!exactKeys(frame, ['protocolVersion', 'requestId', 'type', 'lockPath', 'file'])) {
      throw new ConfinedOutputStoreError(
        'manifest_store_protocol_invalid',
        'Invalid terminal lock-release receipt.',
      );
    }
    assertRelativePath(frame.lockPath);
    validateFileReceipt(frame.file, { sha256: true });
  }
  return frame;
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

export function assertBundledHelperSource(source) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8');
  const observed = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (observed !== EXPECTED_HELPER_SHA256) {
    throw new ConfinedOutputStoreError(
      'manifest_store_helper_digest_mismatch',
      'Bundled confined-output helper does not match the parent module trust anchor.',
      { expected: EXPECTED_HELPER_SHA256, observed },
    );
  }
  return observed;
}

async function captureBundledHelper() {
  const handle = await open(
    helperPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > 256n * 1024n) {
      throw new ConfinedOutputStoreError(
        'manifest_store_helper_invalid',
        'Bundled confined-output helper is missing or exceeds its source bound.',
      );
    }
    const source = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      source.length !== Number(after.size)
    ) {
      throw new ConfinedOutputStoreError(
        'manifest_store_helper_changed',
        'Bundled confined-output helper changed while it was captured.',
      );
    }
    return {
      source: source.toString('utf8'),
      sha256: assertBundledHelperSource(source),
    };
  } finally {
    await handle.close();
  }
}

export async function createConfinedOutputStore(
  outputDirectory,
  {
    lifecycleObserver = null,
    testOnlyCaptureHelper = null,
    testOnlyHelperSource = null,
    requestTimeoutMilliseconds = DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
    startupTimeoutMilliseconds = DEFAULT_STARTUP_TIMEOUT_MILLISECONDS,
  } = {},
) {
  if (lifecycleObserver !== null && typeof lifecycleObserver !== 'function') {
    throw new TypeError('Confined output lifecycle observer must be a function.');
  }
  if (testOnlyCaptureHelper !== null && typeof testOnlyCaptureHelper !== 'function') {
    throw new TypeError('Test-only confined output helper capture must be a function.');
  }
  if (testOnlyCaptureHelper !== null && testOnlyHelperSource !== null) {
    throw new TypeError('Confined output helper test seams are mutually exclusive.');
  }
  if (
    testOnlyHelperSource !== null &&
    (typeof testOnlyHelperSource !== 'string' ||
      testOnlyHelperSource.length < 1 ||
      Buffer.byteLength(testOnlyHelperSource, 'utf8') > 256 * 1024)
  ) {
    throw new TypeError('Test-only confined output helper source is invalid.');
  }
  for (const [label, value] of [
    ['request timeout', requestTimeoutMilliseconds],
    ['startup timeout', startupTimeoutMilliseconds],
  ]) {
    if (!Number.isFinite(value) || value < 10 || value > 60_000) {
      throw new TypeError(`Confined output ${label} is outside its bounded range.`);
    }
  }
  const requestedRoot = path.resolve(outputDirectory);
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(requestedRoot);
  } catch (cause) {
    throw new ConfinedOutputStoreError(
      'confined_output_root_required',
      'Confined output root must already exist and be private.',
      { cause: cause?.code ?? null },
    );
  }
  if (canonicalRoot !== requestedRoot) {
    throw new ConfinedOutputStoreError(
      'confined_output_root_not_canonical',
      'Confined output root cannot contain symlinked path components.',
    );
  }
  const storageRoot = await openPrivateDirectory(requestedRoot);
  if (storageRoot.canonicalPath !== requestedRoot) {
    await storageRoot.close();
    throw new ConfinedOutputStoreError(
      'confined_output_root_not_canonical',
      'Confined output root changed while it was pinned.',
    );
  }
  const rootIdentity = expectedRootIdentity(storageRoot);
  let bundledHelper;
  let child;
  try {
    bundledHelper = testOnlyHelperSource === null
      ? await (testOnlyCaptureHelper ?? captureBundledHelper)()
      : {
          source: testOnlyHelperSource,
          sha256: `sha256:${createHash('sha256')
            .update(testOnlyHelperSource, 'utf8')
            .digest('hex')}`,
        };
    child = spawn(
      process.execPath,
      [
        '--disable-proto=throw',
        '--input-type=module',
        '--eval',
        bundledHelper.source,
      ],
      {
        cwd: storageRoot.canonicalPath,
        env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    await storageRoot.close();
    throw error;
  }

  let stdoutChunks = [];
  let stdoutBufferedBytes = 0;
  let stderrBytes = 0;
  let nextRequestId = 1;
  let pending = null;
  let ready = false;
  let closed = false;
  let closing = false;
  let fatalError = null;
  let terminalRelease = null;
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let exitResolve;
  const exitPromise = new Promise((resolve) => {
    exitResolve = resolve;
  });

  const fail = (error) => {
    if (fatalError !== null) return;
    fatalError = error instanceof ConfinedOutputStoreError
      ? error
      : new ConfinedOutputStoreError(
          'manifest_store_helper_failed',
          'Confined output helper failed.',
        );
    if (!ready) readyReject(fatalError);
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.reject(fatalError);
      pending = null;
    }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };

  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > MAX_STDERR_BYTES) {
      fail(new ConfinedOutputStoreError(
        'manifest_store_stderr_overflow',
        'Confined output helper exceeded its stderr bound.',
      ));
    }
  });
  const appendProtocolBytes = (bytes) => {
    if (bytes.length === 0) return true;
    stdoutBufferedBytes += bytes.length;
    if (stdoutBufferedBytes > MAX_PROTOCOL_BUFFER_BYTES) {
      fail(new ConfinedOutputStoreError(
        'manifest_store_stdout_overflow',
        'Confined output helper exceeded its protocol bound.',
      ));
      return false;
    }
    stdoutChunks.push(bytes);
    return true;
  };
  const acceptProtocolLine = () => {
    const line = stdoutChunks.length === 1
      ? stdoutChunks[0]
      : Buffer.concat(stdoutChunks, stdoutBufferedBytes);
    stdoutChunks = [];
    stdoutBufferedBytes = 0;
    if (fatalError !== null) return;
    let frame;
    try {
      frame = JSON.parse(line.toString('utf8'));
    } catch {
      fail(new ConfinedOutputStoreError(
        'manifest_store_protocol_invalid',
        'Confined output helper returned non-JSON protocol bytes.',
      ));
      return;
    }
    if (!ready) {
      try {
        validateConfinedOutputReadyFrame(frame, rootIdentity);
        ready = true;
        readyResolve(frame);
      } catch (error) {
        fail(error);
      }
    } else if (pending === null) {
      fail(new ConfinedOutputStoreError(
        'manifest_store_unexpected_output',
        'Confined output helper emitted an unsolicited response.',
      ));
    } else {
      const current = pending;
      pending = null;
      clearTimeout(current.timer);
      current.resolve(frame);
    }
  };
  child.stdout.on('data', (chunk) => {
    let offset = 0;
    while (fatalError === null && offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset);
      if (newline === -1) {
        appendProtocolBytes(chunk.subarray(offset));
        break;
      }
      if (!appendProtocolBytes(chunk.subarray(offset, newline))) break;
      acceptProtocolLine();
      offset = newline + 1;
    }
  });
  child.once('error', (error) => {
    fail(new ConfinedOutputStoreError(
      'manifest_store_helper_spawn_failed',
      'Confined output helper could not be spawned.',
      { cause: error?.code ?? null },
    ));
  });
  child.once('close', (exitCode, signalCode) => {
    exitResolve({ exitCode, signalCode });
    if (!closing || pending !== null) {
      fail(new ConfinedOutputStoreError(
        'manifest_store_helper_exited',
        'Confined output helper exited before its pending request was acknowledged.',
        { exitCode, signalCode },
      ));
    }
  });

  const startupTimer = setTimeout(() => {
    fail(new ConfinedOutputStoreError(
      'manifest_store_startup_timeout',
      'Confined output helper did not complete its bounded startup handshake.',
    ));
  }, startupTimeoutMilliseconds);

  async function request(
    type,
    payload,
    expectedTypes,
    { recoverableErrorCodes = [] } = {},
  ) {
    if (closed) {
      throw new ConfinedOutputStoreError(
        'manifest_store_closed',
        'Confined output store is already closed.',
      );
    }
    if (terminalRelease !== null && type !== 'shutdown-and-release') {
      throw new ConfinedOutputStoreError(
        'manifest_store_terminal_release_bound',
        'No filesystem request is permitted after terminal lock release is bound.',
      );
    }
    if (fatalError !== null) throw fatalError;
    if (stdoutBufferedBytes !== 0) {
      fail(new ConfinedOutputStoreError(
        'manifest_store_trailing_output',
        'Confined output helper left an unterminated protocol fragment.',
      ));
      throw fatalError;
    }
    if (pending !== null) {
      throw new ConfinedOutputStoreError(
        'manifest_store_concurrent_request',
        'Confined output store serializes filesystem requests.',
      );
    }
    storageRoot.verifyCurrent();
    const requestId = nextRequestId;
    nextRequestId += 1;
    const frame = { protocolVersion: PROTOCOL_VERSION, requestId, type, ...payload };
    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        fail(new ConfinedOutputStoreError(
          'manifest_store_request_timeout',
          'Confined output helper did not acknowledge a bounded request.',
        ));
      }, requestTimeoutMilliseconds);
      pending = { resolve, reject, timer };
      child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (error) {
          fail(new ConfinedOutputStoreError(
            'manifest_store_request_write_failed',
            'Could not write to confined output helper.',
            { cause: error?.code ?? null },
          ));
        }
      });
    });
    const response = await responsePromise;
    await nextTurn();
    if (fatalError !== null) throw fatalError;
    if (stdoutBufferedBytes !== 0) {
      fail(new ConfinedOutputStoreError(
        'manifest_store_trailing_output',
        'Confined output helper left an unterminated protocol fragment.',
      ));
      throw fatalError;
    }
    storageRoot.verifyCurrent();
    try {
      const validated = validateResponse(response, requestId, expectedTypes);
      if (lifecycleObserver !== null) {
        await lifecycleObserver(Object.freeze({
          requestId,
          type: validated.type,
          path: validated.path ?? null,
          sourcePath: validated.sourcePath ?? null,
          destinationPath: validated.destinationPath ?? null,
        }));
        storageRoot.verifyCurrent();
      }
      return validated;
    } catch (error) {
      if (
        response?.type === 'error' &&
        recoverableErrorCodes.includes(response.code)
      ) {
        throw error;
      }
      fail(error);
      throw error;
    }
  }

  async function readOnce(safe, maxBytes) {
    const response = await request(
      'read',
      { path: safe, maxBytes },
      ['read-complete', 'file-missing'],
      { recoverableErrorCodes: ['confined_file_changed'] },
    );
    if (response.path !== safe) {
      throw new ConfinedOutputStoreError(
        'manifest_store_protocol_invalid',
        'Read receipt path disagrees with its request.',
      );
    }
    if (response.type === 'file-missing') return null;
    const bytes = Buffer.from(response.data, 'base64');
    if (bytes.length !== response.file.bytes) {
      throw new ConfinedOutputStoreError(
        'manifest_store_protocol_invalid',
        'Read payload length disagrees with its receipt.',
      );
    }
    const actualSha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (actualSha256 !== response.file.sha256) {
      throw new ConfinedOutputStoreError(
        'manifest_store_protocol_invalid',
        'Read payload digest disagrees with its receipt.',
      );
    }
    return { bytes, receipt: response.file };
  }

  async function readStable(safe, maxBytes) {
    const first = await readOnce(safe, maxBytes);
    const second = await readOnce(safe, maxBytes);
    if (first === null || second === null) {
      if (first === null && second === null) return null;
      throw new ConfinedOutputStoreError(
        'confined_file_changed',
        'Confined output file appeared or disappeared between stable reads.',
      );
    }
    if (
      JSON.stringify(first.receipt) !== JSON.stringify(second.receipt) ||
      !first.bytes.equals(second.bytes)
    ) {
      throw new ConfinedOutputStoreError(
        'confined_file_changed',
        'Confined output file changed between stable reads.',
      );
    }
    return second;
  }

  try {
    await readyPromise;
    clearTimeout(startupTimer);
    const boundary = await request('confirm-ready', {}, ['ready-confirmed']);
    if (boundary.type !== 'ready-confirmed') {
      throw new ConfinedOutputStoreError(
        'manifest_store_handshake_invalid',
        'Confined output helper did not confirm its ready response boundary.',
      );
    }
    storageRoot.verifyCurrent();
  } catch (error) {
    clearTimeout(startupTimer);
    closing = true;
    child.kill('SIGKILL');
    await exitPromise.catch(() => {});
    await storageRoot.close();
    throw error;
  }

  return {
    storageRoot,
    helperSourceSha256: bundledHelper.sha256,
    helperProcessId: child.pid,
    relativePath(filePath) {
      const relative = path.relative(storageRoot.canonicalPath, path.resolve(filePath));
      if (
        relative === '' ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new ConfinedOutputStoreError(
          'confined_relative_path_required',
          'Output file must be confined below the retained output root.',
        );
      }
      return assertRelativePath(relative.split(path.sep).join('/'));
    },
    resolve(relativePath) {
      const safe = assertRelativePath(relativePath);
      return storageRoot.resolve(safe.split('/').join(path.sep));
    },
    verifyCurrent() {
      if (fatalError !== null) throw fatalError;
      storageRoot.verifyCurrent();
    },
    async ensureDirectory(relativePath) {
      const safe = assertRelativePath(relativePath);
      const response = await request(
        'ensure-directory',
        { path: safe },
        ['directory-ready'],
      );
      if (response.path !== safe) {
        throw new ConfinedOutputStoreError(
          'manifest_store_protocol_invalid',
          'Directory receipt path disagrees with its request.',
        );
      }
      return response.directory;
    },
    async writeFile(relativePath, data) {
      const safe = assertRelativePath(relativePath);
      const expectedBytes = boundedTextBytes(data);
      const response = await request('write', { path: safe, data }, ['write-complete']);
      if (response.path !== safe) {
        throw new ConfinedOutputStoreError(
          'manifest_store_protocol_invalid',
          'Write receipt path disagrees with its request.',
        );
      }
      const expectedSha256 = `sha256:${createHash('sha256').update(data, 'utf8').digest('hex')}`;
      if (response.file.bytes !== expectedBytes || response.file.sha256 !== expectedSha256) {
        throw new ConfinedOutputStoreError(
          'manifest_store_protocol_invalid',
          'Write receipt does not prove the exact requested bytes.',
        );
      }
      const persisted = await readStable(safe, Math.max(1, expectedBytes));
      if (
        persisted === null ||
        JSON.stringify(persisted.receipt) !== JSON.stringify(response.file) ||
        persisted.receipt.sha256 !== expectedSha256 ||
        persisted.bytes.toString('utf8') !== data
      ) {
        throw new ConfinedOutputStoreError(
          'confined_file_changed',
          'Published output does not match its acknowledged write receipt.',
        );
      }
      return response.file;
    },
    async createExclusiveFile(relativePath, data) {
      const safe = assertRelativePath(relativePath);
      const expectedBytes = boundedTextBytes(data);
      const response = await request(
        'create-exclusive',
        { path: safe, data },
        ['create-exclusive-complete'],
        { recoverableErrorCodes: ['benchmark_lock_exists'] },
      );
      if (response.path !== safe) {
        throw new ConfinedOutputStoreError(
          'manifest_store_protocol_invalid',
          'Exclusive-create receipt path disagrees with its request.',
        );
      }
      const expectedSha256 = `sha256:${createHash('sha256').update(data, 'utf8').digest('hex')}`;
      if (response.file.bytes !== expectedBytes || response.file.sha256 !== expectedSha256) {
        throw new ConfinedOutputStoreError(
          'manifest_store_protocol_invalid',
          'Exclusive-create receipt does not prove the requested bytes.',
        );
      }
      const persisted = await readStable(safe, Math.max(1, expectedBytes));
      if (
        persisted === null ||
        JSON.stringify(persisted.receipt) !== JSON.stringify(response.file) ||
        !persisted.bytes.equals(Buffer.from(data, 'utf8'))
      ) {
        throw new ConfinedOutputStoreError(
          'confined_file_changed',
          'Exclusive-created output changed before acknowledgement.',
        );
      }
      return response.file;
    },
    async replaceFile(relativePath, expectedReceipt, data) {
      const safe = assertRelativePath(relativePath);
      validateFileReceipt(expectedReceipt, { sha256: true });
      const expectedBytes = boundedTextBytes(data);
      const response = await request(
        'replace',
        { path: safe, data, expectedFile: expectedReceipt },
        ['replace-complete'],
        {
          recoverableErrorCodes: [
            'confined_file_missing',
            'benchmark_lock_identity_changed',
          ],
        },
      );
      const expectedSha256 = `sha256:${createHash('sha256').update(data, 'utf8').digest('hex')}`;
      if (
        response.path !== safe ||
        response.file.bytes !== expectedBytes ||
        response.file.sha256 !== expectedSha256
      ) {
        throw new ConfinedOutputStoreError(
          'manifest_store_protocol_invalid',
          'Replace receipt does not prove the requested bytes.',
        );
      }
      const persisted = await readStable(safe, Math.max(1, expectedBytes));
      if (
        persisted === null ||
        JSON.stringify(persisted.receipt) !== JSON.stringify(response.file) ||
        !persisted.bytes.equals(Buffer.from(data, 'utf8'))
      ) {
        throw new ConfinedOutputStoreError(
          'confined_file_changed',
          'Replaced output changed before acknowledgement.',
        );
      }
      return response.file;
    },
    async readFile(relativePath, { maxBytes = 32 * 1024 * 1024 } = {}) {
      const safe = assertRelativePath(relativePath);
      return readStable(safe, maxBytes);
    },
    async renameFile(sourcePath, destinationPath, expectedReceipt = null) {
      const source = assertRelativePath(sourcePath);
      const destination = assertRelativePath(destinationPath);
      if (expectedReceipt !== null) {
        validateFileReceipt(expectedReceipt, { sha256: true });
      }
      const sourceSnapshot = expectedReceipt === null
        ? await readStable(source, 32 * 1024 * 1024)
        : { receipt: expectedReceipt };
      if (sourceSnapshot === null) {
        throw new ConfinedOutputStoreError(
          'confined_file_missing',
          'Rename source does not exist.',
        );
      }
      const response = await request(
        'rename',
        {
          sourcePath: source,
          destinationPath: destination,
          expectedFile: sourceSnapshot.receipt,
        },
        ['rename-complete'],
        { recoverableErrorCodes: ['confined_file_missing', 'benchmark_lock_identity_changed'] },
      );
      if (
        response.sourcePath !== source ||
        response.destinationPath !== destination
      ) {
        throw new ConfinedOutputStoreError(
          'manifest_store_protocol_invalid',
          'Rename receipt paths disagree with their request.',
        );
      }
      const persisted = await readStable(destination, 32 * 1024 * 1024);
      if (
        persisted === null ||
        JSON.stringify(persisted.receipt) !== JSON.stringify(response.file)
      ) {
        throw new ConfinedOutputStoreError(
          'confined_file_changed',
          'Renamed output does not match its acknowledged receipt.',
        );
      }
      return response.file;
    },
    async removeFile(relativePath, expectedReceipt = null) {
      const safe = assertRelativePath(relativePath);
      const snapshot = expectedReceipt === null
        ? await readStable(safe, 32 * 1024 * 1024)
        : { receipt: expectedReceipt };
      if (snapshot === null) {
        throw new ConfinedOutputStoreError(
          'confined_file_missing',
          'Remove target does not exist.',
        );
      }
      const response = await request(
        'remove',
        { path: safe, expectedFile: snapshot.receipt },
        ['remove-complete'],
        { recoverableErrorCodes: ['confined_file_missing', 'benchmark_lock_identity_changed'] },
      );
      if (response.path !== safe || JSON.stringify(response.file) !== JSON.stringify(snapshot.receipt)) {
        throw new ConfinedOutputStoreError(
          'manifest_store_protocol_invalid',
          'Remove receipt disagrees with the expected file identity.',
        );
      }
      const missing = await readStable(safe, 64 * 1024);
      if (missing !== null) {
        throw new ConfinedOutputStoreError(
          'benchmark_lock_identity_changed',
          'Removed output path was recreated before acknowledgement.',
        );
      }
      return response.file;
    },
    bindTerminalRelease(release) {
      if (
        terminalRelease !== null ||
        !exactKeys(release, ['lockPath', 'guardPath', 'expectedLock'])
      ) {
        throw new ConfinedOutputStoreError(
          'manifest_store_terminal_release_invalid',
          'Terminal lock release must be bound exactly once.',
        );
      }
      const lockPath = assertRelativePath(release.lockPath);
      const guardPath = assertRelativePath(release.guardPath);
      validateFileReceipt(release.expectedLock, { sha256: true });
      terminalRelease = Object.freeze({
        lockPath,
        guardPath,
        expectedLock: structuredClone(release.expectedLock),
      });
    },
    async close() {
      if (closed) return;
      let primaryError = null;
      let shutdownAcknowledged = false;
      let exit = null;
      closing = true;
      try {
        if (fatalError === null && child.exitCode === null && child.signalCode === null) {
          const response = terminalRelease === null
            ? await request('shutdown', {}, ['shutdown-complete'])
            : await request(
                'shutdown-and-release',
                terminalRelease,
                ['shutdown-release-complete'],
              );
          if (
            (terminalRelease === null && response.type !== 'shutdown-complete') ||
            (terminalRelease !== null &&
              (response.type !== 'shutdown-release-complete' ||
                response.lockPath !== terminalRelease.lockPath ||
                JSON.stringify(response.file) !== JSON.stringify(terminalRelease.expectedLock)))
          ) {
            throw new ConfinedOutputStoreError(
              'manifest_store_protocol_invalid',
              'Confined output helper did not acknowledge shutdown.',
            );
          }
          shutdownAcknowledged = true;
        }
      } catch (error) {
        primaryError = error;
      } finally {
        closed = true;
        child.stdin.end();
        const timeout = setTimeout(() => child.kill('SIGKILL'), 2_000);
        try {
          exit = await exitPromise;
        } finally {
          clearTimeout(timeout);
          await storageRoot.close();
        }
      }
      if (primaryError === null && fatalError !== null) primaryError = fatalError;
      if (
        primaryError === null &&
        (!shutdownAcknowledged || exit?.exitCode !== 0 || exit?.signalCode !== null)
      ) {
        primaryError = new ConfinedOutputStoreError(
          'manifest_store_shutdown_invalid',
          'Confined output helper did not exit cleanly after its exact shutdown acknowledgement.',
          { exitCode: exit?.exitCode ?? null, signalCode: exit?.signalCode ?? null },
        );
      }
      if (primaryError === null && stdoutBufferedBytes !== 0) {
        primaryError = new ConfinedOutputStoreError(
          'manifest_store_trailing_output',
          'Confined output helper left trailing bytes at shutdown.',
        );
      }
      if (primaryError !== null) throw primaryError;
    },
  };
}
