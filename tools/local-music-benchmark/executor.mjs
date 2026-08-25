import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  assertExecutableClosureConfined,
  assertMachOExecutableClosure,
  assertRelocatablePythonClosure,
  revalidateExecutableClosure,
} from './dynamic-linker.mjs';
import { createConfinedOutputStore } from './confined-output-store.mjs';
import {
  assertProcessEnvironmentReceipt,
  verifyPinnedPath,
} from './integrity.mjs';
import {
  ADAPTER_PROTOCOL,
  createSidecarIdentity,
  recordPaths,
  serializeManifest,
  sha256Receipt,
} from './manifest.mjs';
import { MAX_ADAPTER_OUTPUT_BYTES } from './limits.mjs';
import { executorResultSchema } from './schema.mjs';
const PARENT_LIVENESS_FD = 3;
const OUTPUT_ROOT_FD = 4;
const WORKING_DIRECTORY_FD = 5;

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

class AdapterProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = code === 'execution_interrupted' ? 'AbortError' : 'AdapterProtocolError';
    this.code = code;
    this.details = details;
  }
}

function structuredError(error) {
  const details = error?.message ? sha256Receipt(String(error.message)) : null;
  return {
    code: error?.code ?? 'executor_protocol_failed',
    category:
      error?.code === 'execution_interrupted'
        ? 'interrupted'
        : error?.code === 'allocation_failure'
          ? 'allocation'
          : error?.code?.includes('sidecar') || error?.code?.includes('identity')
            ? 'validation'
            : 'executor',
    message: error?.message ?? String(error),
    retryable: error?.code === 'execution_interrupted',
    allocationFailure: error?.code === 'allocation_failure',
    detailsSha256: details,
  };
}

function runtimeIdentity(identity, adapter) {
  return {
    host: identity.host,
    engine: {
      name: identity.engine.name,
      repoCommit: identity.engine.repoCommit,
      clean: identity.engine.clean,
    },
    model: {
      id: identity.model.id,
      revision: identity.model.revision,
      weightsSha256: identity.model.weights.sha256,
      lm: {
        id: identity.model.lm.id,
        revision: identity.model.lm.revision,
        weightsSha256: identity.model.lm.weights.sha256,
      },
    },
    runtime: {
      device: identity.runtime.device,
      lmBackend: identity.runtime.lmBackend,
      vaeChunk: identity.runtime.vaeChunk,
      harnessCommit: identity.runtime.harnessCommit,
      harnessRepositoryPath: identity.runtime.harnessRepositoryPath,
      harnessClean: identity.runtime.harnessClean,
      serverCommit: identity.runtime.serverCommit,
      runDirectory: identity.runtime.runDirectory,
      runDirectoryIdentity: identity.runtime.runDirectoryIdentity,
    },
    toolchain: Object.fromEntries(
      Object.entries(identity.toolchain).map(([name, pin]) => [
        name,
        {
          realpath: pin.realpath,
          sha256: pin.sha256,
          version: pin.version,
          ...(pin.dynamicLinker === undefined
            ? {}
            : { dynamicLinker: pin.dynamicLinker }),
        },
      ]),
    ),
    adapter: {
      executableRealpath: adapter.executable.realpath,
      executableSha256: adapter.executable.sha256,
      scriptRealpath: adapter.script.realpath,
      scriptSha256: adapter.script.sha256,
      pythonRuntime: adapter.pythonRuntime ?? null,
      dynamicLinker: adapter.dynamicLinker ?? null,
    },
  };
}

function sameValue(left, right) {
  return serializeManifest(left) === serializeManifest(right);
}

function boundedAppend(chunks, chunk, currentBytes, limit) {
  const remaining = Math.max(0, limit - currentBytes);
  if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
  return currentBytes + chunk.length;
}

function processEvidence(error, fallbackStartedAt) {
  const details = error?.details ?? {};
  const wallTimeSeconds =
    Number.isFinite(details.wallTimeSeconds) && details.wallTimeSeconds > 0
      ? details.wallTimeSeconds
      : null;
  return {
    startedAt: details.startedAt ?? fallbackStartedAt,
    finishedAt: details.finishedAt ?? new Date().toISOString(),
    exitCode: details.exitCode ?? null,
    signal: details.signal ?? null,
    stdout: details.stdout ?? Buffer.alloc(0),
    stderr: details.stderr ?? Buffer.alloc(0),
    wallTimeSeconds,
  };
}

function failureResult(error, fallbackStartedAt, resultJsonPath) {
  return {
    status: 'failure',
    ...processEvidence(error, fallbackStartedAt),
    metrics: {
      peakMemoryBytes: null,
      energyWh: null,
    },
    metricUnavailableReason: {
      peakMemoryBytes: 'execution_failed',
      energyWh: 'execution_failed',
    },
    candidates: [],
    sidecar: null,
    resultJsonPath,
    error: structuredError(error),
    fatalPreflight: error?.preSpawnFailure === true,
  };
}

export function createPersistentAdapter({
  adapter,
  cleanupGuards = [],
  identity,
  outputDirectory,
  outputStore: configuredOutputStore = null,
  processEnvironment,
  preSpawnVerify,
}) {
  if (typeof preSpawnVerify !== 'function') {
    throw new AdapterProtocolError(
      'executor_pre_spawn_verifier_required',
      'Persistent adapter construction requires an explicit pre-spawn verifier.',
    );
  }
  if (!Array.isArray(cleanupGuards)) {
    throw new AdapterProtocolError(
      'executor_cleanup_guards_invalid',
      'Persistent adapter cleanup guards must be an array.',
    );
  }
  if (
    !Number.isInteger(adapter?.maxOutputBytes) ||
    adapter.maxOutputBytes < 1 ||
    adapter.maxOutputBytes > MAX_ADAPTER_OUTPUT_BYTES
  ) {
    throw new AdapterProtocolError(
      'executor_output_bound_invalid',
      `Persistent adapter output bound must be between 1 and ${MAX_ADAPTER_OUTPUT_BYTES} bytes.`,
    );
  }
  const registeredCleanupGuards = [...cleanupGuards];
  for (const cleanupGuard of registeredCleanupGuards) {
    if (typeof cleanupGuard?.recordCleanupProcessGroup !== 'function') {
      throw new AdapterProtocolError(
        'executor_cleanup_guard_invalid',
        'Each persistent adapter cleanup guard must record a process group.',
      );
    }
  }
  adapter = deepFreeze(structuredClone(adapter));
  identity = deepFreeze(structuredClone(identity));
  const adapterEnvironment = Object.freeze({ ...processEnvironment });
  assertProcessEnvironmentReceipt(
    adapterEnvironment,
    identity.environment,
    identity.environmentSha256,
  );
  const virtualEnvironment = adapter.pythonRuntime?.virtualEnvironment ?? null;
  const allowedEnvironmentNames = new Set([
    'HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'PYTHONDONTWRITEBYTECODE',
    'PYTHONNOUSERSITE',
    'PYTHONSAFEPATH',
    ...(virtualEnvironment === null
      ? []
      : ['VIRTUAL_ENV', '__PYVENV_LAUNCHER__']),
  ]);
  if (
    Object.keys(adapterEnvironment).some((name) => !allowedEnvironmentNames.has(name)) ||
    adapterEnvironment.PYTHONDONTWRITEBYTECODE !== '1' ||
    adapterEnvironment.PYTHONNOUSERSITE !== '1' ||
    adapterEnvironment.PYTHONSAFEPATH !== '1' ||
    (virtualEnvironment === null &&
      ['VIRTUAL_ENV', '__PYVENV_LAUNCHER__', 'PYTHONPATH', 'PYTHONHOME']
        .some((name) => name in adapterEnvironment)) ||
    (virtualEnvironment !== null &&
      (adapterEnvironment.VIRTUAL_ENV !== virtualEnvironment.snapshotRootRealpath ||
        adapterEnvironment.__PYVENV_LAUNCHER__ !== path.join(
          virtualEnvironment.snapshotRootRealpath,
          'bin',
          path.basename(virtualEnvironment.launcherPath),
        ) ||
        'PYTHONPATH' in adapterEnvironment))
  ) {
    throw new AdapterProtocolError(
      'adapter_environment_not_allowlisted',
      'Persistent adapter environment is not the verified Python snapshot environment.',
    );
  }
  let child = null;
  let childProcessGroupId = null;
  let childCloseObserved = false;
  let childClosePromise = null;
  let terminationPromise = null;
  let initialized = false;
  let starting = null;
  let pending = null;
  let stdoutBuffer = Buffer.alloc(0);
  let closed = false;
  let closing = false;
  let protocolError = null;
  let unreportedProtocolError = null;
  let protocolState = 'stopped';
  let shutdownRequested = false;
  let shutdownAcknowledged = false;
  let nextProtocolRequestId = 0;
  let ownedOutputStorePromise = null;
  let activeOutputStore = null;
  let activeOutputRootIdentity = null;
  let workingDirectoryHandle = null;
  let workingDirectoryIdentity = null;

  async function pinWorkingDirectory(directoryPath) {
    const handle = await open(
      directoryPath,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_DIRECTORY ?? 0),
    );
    try {
      const [descriptor, pathStats] = await Promise.all([
        handle.stat({ bigint: true }),
        lstat(directoryPath, { bigint: true }),
      ]);
      if (
        !descriptor.isDirectory() ||
        pathStats.isSymbolicLink() ||
        descriptor.dev !== pathStats.dev ||
        descriptor.ino !== pathStats.ino ||
        (typeof process.getuid === 'function' && descriptor.uid !== BigInt(process.getuid()))
      ) {
        throw new AdapterProtocolError(
          'adapter_working_directory_changed',
          'Persistent adapter working directory could not be pinned safely.',
        );
      }
      return {
        handle,
        identity: {
          fileDescriptor: WORKING_DIRECTORY_FD,
          device: String(descriptor.dev),
          inode: String(descriptor.ino),
          uid: Number(descriptor.uid),
          mode: Number(descriptor.mode & 0o7777n),
        },
      };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async function verifyWorkingDirectory() {
    if (workingDirectoryHandle === null || workingDirectoryIdentity === null) return;
    const [descriptor, pathStats] = await Promise.all([
      workingDirectoryHandle.stat({ bigint: true }),
      lstat(adapter.workingDirectory, { bigint: true }),
    ]);
    const observed = {
      fileDescriptor: WORKING_DIRECTORY_FD,
      device: String(descriptor.dev),
      inode: String(descriptor.ino),
      uid: Number(descriptor.uid),
      mode: Number(descriptor.mode & 0o7777n),
    };
    if (
      pathStats.isSymbolicLink() ||
      descriptor.dev !== pathStats.dev ||
      descriptor.ino !== pathStats.ino ||
      !sameValue(observed, workingDirectoryIdentity)
    ) {
      throw new AdapterProtocolError(
        'adapter_working_directory_changed',
        'Persistent adapter working directory changed after it was pinned.',
      );
    }
  }

  async function closeWorkingDirectory() {
    if (workingDirectoryHandle === null) return;
    const handle = workingDirectoryHandle;
    workingDirectoryHandle = null;
    await handle.close();
  }

  async function resolveOutputStore(contextOutputStore = null) {
    let candidate;
    if (configuredOutputStore !== null) {
      if (contextOutputStore !== null && contextOutputStore !== configuredOutputStore) {
        throw new AdapterProtocolError(
          'executor_output_store_mismatch',
          'Persistent adapter cannot override its constructor-bound confined output store.',
        );
      }
      candidate = configuredOutputStore;
    } else if (contextOutputStore !== null) {
      candidate = contextOutputStore;
    } else {
      ownedOutputStorePromise ??= createConfinedOutputStore(outputDirectory);
      candidate = await ownedOutputStorePromise;
    }
    if (activeOutputStore === null) {
      activeOutputStore = candidate;
      activeOutputRootIdentity = serializeManifest({
        canonicalPath: candidate.storageRoot.canonicalPath,
        device: candidate.storageRoot.device,
        inode: candidate.storageRoot.inode,
        uid: candidate.storageRoot.uid,
        mode: candidate.storageRoot.mode,
      });
    }
    if (candidate !== activeOutputStore) {
      throw new AdapterProtocolError(
        'executor_output_store_mismatch',
        'Persistent adapter is already bound to a different confined output store.',
      );
    }
    candidate.verifyCurrent();
    const currentIdentity = serializeManifest({
      canonicalPath: candidate.storageRoot.canonicalPath,
      device: candidate.storageRoot.device,
      inode: candidate.storageRoot.inode,
      uid: candidate.storageRoot.uid,
      mode: candidate.storageRoot.mode,
    });
    if (currentIdentity !== activeOutputRootIdentity) {
      throw new AdapterProtocolError(
        'executor_output_store_mismatch',
        'Persistent adapter output-root identity changed after binding.',
      );
    }
    return candidate;
  }

  async function closeOwnedOutputStore() {
    if (ownedOutputStorePromise === null) return;
    const owned = await ownedOutputStorePromise;
    await owned.close();
  }

  function signalProcessGroup(signal) {
    if (!child) return false;
    if (process.platform === 'win32') {
      if (child.exitCode !== null || child.signalCode !== null) return false;
      child.kill(signal);
      return true;
    }
    if (childProcessGroupId === null) return false;
    try {
      process.kill(-childProcessGroupId, signal);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      throw new AdapterProtocolError(
        'executor_process_group_signal_failed',
        `Could not signal persistent adapter process group: ${error.message}`,
      );
    }
  }

  function processGroupAlive() {
    if (process.platform === 'win32') {
      return child !== null && child.exitCode === null && child.signalCode === null;
    }
    if (childProcessGroupId === null) return false;
    try {
      process.kill(-childProcessGroupId, 0);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      if (error?.code === 'EPERM') return true;
      throw error;
    }
  }

  function terminateProcessGroup() {
    if (terminationPromise !== null) return terminationPromise;
    terminationPromise = (async () => {
      try {
        if (!signalProcessGroup('SIGTERM')) return null;
        const graceDeadline =
          Date.now() + adapter.terminateGraceSeconds * 1000;
        while (Date.now() < graceDeadline) {
          await new Promise((resolve) => {
            setTimeout(resolve, Math.min(10, graceDeadline - Date.now()));
          });
          if (!processGroupAlive()) return null;
        }
        if (!processGroupAlive()) return null;
        if (!signalProcessGroup('SIGKILL')) return null;
        const deadline = Date.now() + 1_000;
        let alive = true;
        while (alive && Date.now() < deadline) {
          alive = processGroupAlive();
          if (!alive) return null;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (alive) {
          return new AdapterProtocolError(
            'executor_process_group_alive',
            'Persistent adapter process group remained alive after SIGKILL.',
          );
        }
        return null;
      } catch (error) {
        return error;
      }
    })();
    return terminationPromise;
  }

  function completePending(error, response = null) {
    const current = pending;
    if (!current) return;
    pending = null;
    clearTimeout(current.timer);
    if (current.responseTimer !== null) clearImmediate(current.responseTimer);
    current.signal?.removeEventListener('abort', current.abort);
    const finishedAt = new Date().toISOString();
    const elapsedSeconds = (performance.now() - current.startedPerformance) / 1000;
    const evidence = {
      startedAt: current.startedAt,
      finishedAt,
      exitCode: child?.exitCode ?? null,
      signal: child?.signalCode ?? null,
      stdout: Buffer.concat(current.stdoutChunks),
      stderr: Buffer.concat(current.stderrChunks),
      wallTimeSeconds:
        Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : null,
    };
    protocolState = error === null ? 'between-requests' : 'fatal';
    if (error) {
      error.details = { ...error.details, ...evidence };
      current.reject(error);
    } else {
      current.resolve({ response, ...evidence });
    }
  }

  function failForLimit(stream) {
    const error = new AdapterProtocolError(
      'executor_output_limit',
      `Persistent adapter ${stream} exceeded ${adapter.maxOutputBytes} bytes.`,
    );
    completePending(error);
    terminateProcessGroup();
  }

  function onStdout(chunk) {
    if (!pending) {
      if (protocolState === 'fatal') {
        terminateProcessGroup();
        return;
      }
      protocolError = new AdapterProtocolError(
        'unexpected_adapter_output',
        'Persistent adapter emitted output without an active request.',
      );
      unreportedProtocolError = protocolError;
      protocolState = 'fatal';
      terminateProcessGroup();
      return;
    }
    const activeRequest = pending;
    pending.stdoutBytes = boundedAppend(
      pending.stdoutChunks,
      chunk,
      pending.stdoutBytes,
      adapter.maxOutputBytes,
    );
    if (pending.stdoutBytes > adapter.maxOutputBytes) {
      failForLimit('stdout');
      return;
    }
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    if (stdoutBuffer.length > adapter.maxOutputBytes) {
      failForLimit('stdout');
      stdoutBuffer = Buffer.alloc(0);
      return;
    }
    if (activeRequest.responseBoundarySeen) {
      const error = new AdapterProtocolError(
        'unexpected_adapter_output',
        'Persistent adapter emitted output after the confirmed response boundary.',
      );
      protocolError = error;
      completePending(error);
      terminateProcessGroup();
      stdoutBuffer = Buffer.alloc(0);
      return;
    }
    while (pending) {
      const newline = stdoutBuffer.indexOf(0x0a);
      if (newline === -1) return;
      const line = stdoutBuffer.subarray(0, newline);
      stdoutBuffer = stdoutBuffer.subarray(newline + 1);
      let response;
      try {
        response = JSON.parse(line.toString('utf8'));
      } catch {
        const error = new AdapterProtocolError(
          'invalid_adapter_response',
          'Persistent adapter emitted invalid JSON.',
        );
        completePending(error);
        terminateProcessGroup();
        return;
      }
      const current = pending;
      if (current.responseCandidate === null) {
        if (
          response?.type === 'response-boundary' ||
          response?.protocolRequestId !== current.protocolRequestId
        ) {
          const error = new AdapterProtocolError(
            'invalid_adapter_response',
            'Persistent adapter response does not match the active protocol request.',
          );
          completePending(error);
          terminateProcessGroup();
          return;
        }
        current.responseCandidate = response;
        child.stdin.write(
          `${JSON.stringify({
            type: 'confirm-response-boundary',
            protocolVersion: '1.0.0',
            protocolRequestId: current.protocolRequestId,
          })}\n`,
          (error) => {
            if (error && pending === current) {
              completePending(
                new AdapterProtocolError(
                  'executor_request_write_failed',
                  `Could not confirm the adapter response boundary: ${error.message}`,
                ),
              );
            }
          },
        );
        continue;
      }
      if (
        current.responseBoundarySeen ||
        !sameValue(response, {
          type: 'response-boundary',
          protocolVersion: '1.0.0',
          protocolRequestId: current.protocolRequestId,
        }) ||
        stdoutBuffer.length > 0
      ) {
        const error = new AdapterProtocolError(
          'unexpected_adapter_output',
          'Persistent adapter emitted output outside the confirmed response boundary.',
        );
        protocolError = error;
        completePending(error);
        terminateProcessGroup();
        stdoutBuffer = Buffer.alloc(0);
        return;
      }
      current.responseBoundarySeen = true;
      current.responseTimer = setImmediate(() => {
        if (pending !== current || !current.responseBoundarySeen) return;
        if (
          stdoutBuffer.length > 0 ||
          protocolError !== null ||
          protocolState !== 'request-active'
        ) {
          const error = protocolError ?? new AdapterProtocolError(
            'unexpected_adapter_output',
            'Persistent adapter emitted trailing output before response resolution.',
          );
          protocolError = error;
          completePending(error);
          terminateProcessGroup();
          stdoutBuffer = Buffer.alloc(0);
          return;
        }
        const { protocolRequestId: _protocolRequestId, ...publicResponse } =
          current.responseCandidate;
        completePending(null, publicResponse);
      });
      return;
    }
  }

  function onStderr(chunk) {
    if (!pending) return;
    pending.stderrBytes = boundedAppend(
      pending.stderrChunks,
      chunk,
      pending.stderrBytes,
      adapter.maxOutputBytes,
    );
    if (pending.stderrBytes > adapter.maxOutputBytes) failForLimit('stderr');
  }

  function sendRequest(request, { signal, timeoutSeconds = adapter.requestTimeoutSeconds } = {}) {
    if (protocolError !== null) {
      const error = protocolError;
      unreportedProtocolError = null;
      return Promise.reject(error);
    }
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return Promise.reject(
        new AdapterProtocolError('executor_process_unavailable', 'Persistent adapter is not running.'),
      );
    }
    if (pending) {
      return Promise.reject(
        new AdapterProtocolError(
          'executor_concurrent_request',
          'The persistent adapter accepts one request at a time.',
        ),
      );
    }
    if (protocolState !== 'between-requests') {
      return Promise.reject(
        new AdapterProtocolError(
          'executor_protocol_state_invalid',
          'Persistent adapter is not between protocol requests.',
        ),
      );
    }
    return new Promise((resolve, reject) => {
      nextProtocolRequestId += 1;
      const protocolRequestId = nextProtocolRequestId;
      const startedAt = new Date().toISOString();
      const startedPerformance = performance.now();
      const abort = () => {
        const error = new AdapterProtocolError(
          'execution_interrupted',
          'Benchmark execution was interrupted.',
        );
        completePending(error);
        terminateProcessGroup();
      };
      const timer = setTimeout(() => {
        const error = new AdapterProtocolError(
          'executor_timeout',
          `Persistent adapter request exceeded ${timeoutSeconds} seconds.`,
        );
        completePending(error);
        terminateProcessGroup();
      }, timeoutSeconds * 1000);
      pending = {
        resolve,
        reject,
        startedAt,
        startedPerformance,
        stdoutChunks: [],
        stderrChunks: [],
        stdoutBytes: 0,
        stderrBytes: 0,
        signal,
        abort,
        timer,
        responseCandidate: null,
        responseBoundarySeen: false,
        responseTimer: null,
        protocolRequestId,
      };
      protocolState = 'request-active';
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      child.stdin.write(`${JSON.stringify({ ...request, protocolRequestId })}\n`, (error) => {
        if (error && pending) {
          completePending(
            new AdapterProtocolError(
              'executor_request_write_failed',
              `Could not write to persistent adapter: ${error.message}`,
            ),
          );
        }
      });
    });
  }

  async function start(manifest, signal, outputStore) {
    if (initialized) return;
    if (starting) return starting;
    starting = (async () => {
      let verifiedExecutable;
      let verifiedScript;
      let verifiedWorkingDirectory;
      try {
        assertProcessEnvironmentReceipt(
          adapterEnvironment,
          identity.environment,
          identity.environmentSha256,
        );
        verifiedExecutable = await verifyPinnedPath(adapter.executable, {
          executable: true,
          label: 'persistent adapter Python executable',
        });
        verifiedScript = await verifyPinnedPath(adapter.script, {
          label: 'persistent adapter script',
        });
        verifiedWorkingDirectory = await realpath(adapter.workingDirectory);
        if (verifiedWorkingDirectory !== adapter.workingDirectory) {
          throw new AdapterProtocolError(
            'adapter_working_directory_not_canonical',
            'Persistent adapter working directory changed or is not canonical.',
          );
        }
        const pinnedWorkingDirectory = await pinWorkingDirectory(
          verifiedWorkingDirectory,
        );
        workingDirectoryHandle = pinnedWorkingDirectory.handle;
        workingDirectoryIdentity = pinnedWorkingDirectory.identity;
        const closure = await revalidateExecutableClosure({
          ...verifiedExecutable,
          dynamicLinker: adapter.dynamicLinker,
        });
        assertMachOExecutableClosure(closure, {
          code: 'python_runtime_not_macho',
          label: 'Persistent adapter Python',
        });
        assertRelocatablePythonClosure(closure);
        assertExecutableClosureConfined(
          closure,
          identity.runtime.runDirectory,
        );
        await preSpawnVerify();
      } catch (error) {
        error.preSpawnFailure = true;
        throw error;
      }
      outputStore.verifyCurrent();
      const storageRoot = outputStore.storageRoot;
      const outputRootIdentity = {
        fileDescriptor: OUTPUT_ROOT_FD,
        device: storageRoot.device,
        inode: storageRoot.inode,
        uid: storageRoot.uid,
        mode: storageRoot.mode,
      };
      child = spawn(
        verifiedExecutable.realpath,
        ['-P', verifiedScript.realpath, '--protocol', ADAPTER_PROTOCOL],
        {
          cwd: '/',
          env: adapterEnvironment,
          shell: false,
          detached: process.platform !== 'win32',
          // The reviewed adapter must block on fd 3 in a watchdog thread. The
          // kernel closes the other end if this harness exits, including
          // SIGKILL, so an abandoned Metal workload cannot outlive its lock.
          stdio: [
            'pipe',
            'pipe',
            'pipe',
            'pipe',
            storageRoot.handle.fd,
            workingDirectoryHandle.fd,
          ],
        },
      );
      childProcessGroupId = process.platform === 'win32' ? null : child.pid;
      protocolState = 'between-requests';
      child.stdout.on('data', onStdout);
      child.stderr.on('data', onStderr);
      child.once('error', (error) => {
        if (pending) {
          completePending(
            new AdapterProtocolError(
              'executor_spawn_failed',
              `Persistent adapter failed to start: ${error.message}`,
            ),
          );
        }
      });
      childClosePromise = new Promise((resolve) => {
        child.once('close', (exitCode, signalCode) => {
          childCloseObserved = true;
          if (pending) {
            completePending(
              new AdapterProtocolError(
                'executor_process_exit',
                'Persistent adapter exited before returning a complete response.',
                { exitCode, signal: signalCode },
              ),
            );
            terminateProcessGroup();
          } else if (
            protocolState === 'between-requests' &&
            !(closing && (shutdownRequested || shutdownAcknowledged))
          ) {
            protocolError = new AdapterProtocolError(
              'executor_process_exit',
              'Persistent adapter exited between protocol requests.',
              { exitCode, signal: signalCode },
            );
            unreportedProtocolError = protocolError;
            protocolState = 'fatal';
            terminateProcessGroup();
          }
          resolve();
        });
      });
      if (childProcessGroupId !== null) {
        try {
          for (const cleanupGuard of registeredCleanupGuards) {
            await cleanupGuard.recordCleanupProcessGroup(childProcessGroupId);
          }
        } catch (error) {
          error.preSpawnFailure = true;
          throw error;
        }
      }
      const expectedIdentity = runtimeIdentity(identity, adapter);
      const parentLiveness = {
        harnessPid: process.pid,
        fileDescriptor: PARENT_LIVENESS_FD,
      };
      const result = await sendRequest(
        {
          type: 'initialize',
          protocolVersion: '1.0.0',
          outputRoot: outputRootIdentity,
          workingDirectory: workingDirectoryIdentity,
          benchmarkId: manifest.benchmarkId,
          expectedIdentity,
          parentLiveness,
        },
        { signal },
      );
      if (
        result.response?.type !== 'initialized' ||
        result.response?.protocolVersion !== '1.0.0' ||
        result.response?.parentLiveness?.armed !== true ||
        !sameValue(result.response.parentLiveness, {
          ...parentLiveness,
          armed: true,
        })
      ) {
        throw new AdapterProtocolError(
          'adapter_initialize_invalid',
          'Persistent adapter did not complete the versioned initialization handshake.',
          result,
        );
      }
      if (!sameValue(result.response.outputRoot, outputRootIdentity)) {
        throw new AdapterProtocolError(
          'adapter_output_root_mismatch',
          'Persistent adapter did not prove the inherited output-root capability.',
          result,
        );
      }
      if (!sameValue(result.response.workingDirectory, workingDirectoryIdentity)) {
        throw new AdapterProtocolError(
          'adapter_working_directory_mismatch',
          'Persistent adapter did not prove the inherited working-directory capability.',
          result,
        );
      }
      await verifyWorkingDirectory();
      if (!sameValue(result.response.identity, expectedIdentity)) {
        throw new AdapterProtocolError(
          'adapter_identity_mismatch',
          'Persistent adapter effective identity does not match verified pins.',
          result,
        );
      }
      initialized = true;
    })();
    try {
      await starting;
    } catch (error) {
      const terminationError = await terminateProcessGroup();
      if (terminationError !== null) {
        const cleanupError = terminationError instanceof AdapterProtocolError
          ? terminationError
          : new AdapterProtocolError(
            'executor_process_group_cleanup_failed',
            `Persistent adapter process-group cleanup failed: ${terminationError.message}`,
          );
        cleanupError.cleanupUnproven = true;
        cleanupError.preSpawnFailure = true;
        cleanupError.details = {
          ...cleanupError.details,
          processGroupId: childProcessGroupId,
          priorErrorCode: error?.code ?? null,
        };
        throw cleanupError;
      }
      throw error;
    } finally {
      starting = null;
    }
  }

  async function quarantineSidecar(outputStore, resultPath, reason) {
    const evidence = await outputStore.readFile(resultPath, {
      maxBytes: adapter.maxOutputBytes,
    });
    if (evidence === null) {
      const missing = new Error('Executor sidecar does not exist.');
      missing.code = 'ENOENT';
      throw missing;
    }
    const quarantinePath = `${resultPath}.quarantine-${reason}-${sha256Receipt(evidence.bytes).slice(-12)}`;
    await outputStore.renameFile(resultPath, quarantinePath);
    return evidence;
  }

  async function execute({ manifest, record, signal, outputStore: contextOutputStore = null }) {
    const fallbackStartedAt = new Date().toISOString();
    const paths = recordPaths({
      cell: {
        durationSeconds: manifest.factors.durationSeconds,
        batchSizeRequested: manifest.factors.batchSizeRequested,
      },
      phase: record.phase,
      index: record.index,
      attempt: record.attempt,
    });
    const outputStore = await resolveOutputStore(contextOutputStore);
    const resultPath = paths.resultJsonPath;
    try {
      const recordDirectoryIdentity = await outputStore.ensureDirectory(
        paths.recordDirectory,
      );
      const artifactDirectoryIdentity = await outputStore.ensureDirectory(
        paths.artifactDirectory,
      );
      await start(manifest, signal, outputStore);
      await verifyWorkingDirectory();
      const sidecarIdentity = createSidecarIdentity(manifest, record);
      const processResult = await sendRequest(
        {
          type: 'execute',
          identity: sidecarIdentity,
          resultPath,
          artifactDirectory: paths.artifactDirectory,
          recordDirectoryIdentity,
          artifactDirectoryIdentity,
          durationSeconds: manifest.factors.durationSeconds,
          batchSizeRequested: manifest.factors.batchSizeRequested,
          phase: record.phase,
          index: record.index,
          attempt: record.attempt,
        },
        { signal },
      );
      await verifyWorkingDirectory();
      if (
        processResult.response?.type !== 'completed' ||
        processResult.response?.requestSha256 !== sidecarIdentity.requestSha256
      ) {
        throw new AdapterProtocolError(
          'invalid_adapter_response',
          'Persistent adapter completion acknowledgement does not match the request.',
          processResult,
        );
      }
      let raw;
      let sidecarFileIdentity;
      try {
        const evidence = await outputStore.readFile(resultPath, {
          maxBytes: adapter.maxOutputBytes,
        });
        if (evidence === null) {
          throw Object.assign(new Error('missing sidecar'), { code: 'ENOENT' });
        }
        raw = evidence.bytes;
        sidecarFileIdentity = evidence.receipt;
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw new AdapterProtocolError(
            'executor_sidecar_missing',
            'Persistent adapter completed without its required sidecar.',
            processResult,
          );
        }
        throw error;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        await quarantineSidecar(outputStore, resultPath, 'invalid-json');
        throw new AdapterProtocolError(
          'invalid_executor_result',
          'Executor sidecar is not valid JSON.',
          processResult,
        );
      }
      const validation = executorResultSchema.safeParse(parsed);
      if (!validation.success) {
        await outputStore.renameFile(
          resultPath,
          `${resultPath}.quarantine-invalid-schema-${sha256Receipt(raw).slice(-12)}`,
        );
        throw new AdapterProtocolError(
          'invalid_executor_result',
          'Executor sidecar does not match schema version 1.0.0.',
          processResult,
        );
      }
      if (!sameValue(validation.data.identity, sidecarIdentity)) {
        await outputStore.renameFile(
          resultPath,
          `${resultPath}.quarantine-identity-${sha256Receipt(raw).slice(-12)}`,
        );
        throw new AdapterProtocolError(
          'executor_sidecar_identity_mismatch',
          'Executor sidecar identity does not match this run/cell/attempt.',
          processResult,
        );
      }
      outputStore.verifyCurrent();
      const consumedPath = paths.consumedResultJsonPath;
      await outputStore.renameFile(resultPath, consumedPath);
      const sidecar = {
        relativePath: paths.consumedResultJsonPath,
        sha256: sha256Receipt(raw),
        bytes: raw.length,
        device: sidecarFileIdentity.device,
        inode: sidecarFileIdentity.inode,
      };
      return {
        status: validation.data.status,
        ...processResult,
        metrics: validation.data.metrics,
        metricUnavailableReason: validation.data.metricUnavailableReason,
        candidates: validation.data.candidates,
        sidecar,
        resultJsonPath: paths.resultJsonPath,
        error: validation.data.error,
      };
    } catch (error) {
      try {
        await quarantineSidecar(outputStore, resultPath, 'request-failed');
      } catch (quarantineError) {
        if (quarantineError?.code !== 'ENOENT') {
          return failureResult(
            new AdapterProtocolError(
              'executor_sidecar_quarantine_failed',
              'A failed request left a sidecar that could not be quarantined.',
              { cause: quarantineError?.message ?? String(quarantineError) },
            ),
            fallbackStartedAt,
            paths.resultJsonPath,
          );
        }
      }
      return failureResult(error, fallbackStartedAt, paths.resultJsonPath);
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    closing = true;
    let closeError = unreportedProtocolError;
    if (closeError === null && workingDirectoryHandle !== null) {
      try {
        await verifyWorkingDirectory();
      } catch (error) {
        closeError = error;
      }
    }
    if (!child) {
      try {
        if (closeError !== null) throw closeError;
      } finally {
        await closeWorkingDirectory();
        await closeOwnedOutputStore();
      }
      return;
    }
    if (
      child.exitCode === null &&
      child.signalCode === null &&
      initialized &&
      !pending &&
      protocolState === 'between-requests' &&
      closeError === null
    ) {
      try {
        shutdownRequested = true;
        const shutdownResult = await sendRequest(
          { type: 'shutdown' },
          { timeoutSeconds: Math.max(0.1, adapter.terminateGraceSeconds) },
        );
        if (!sameValue(shutdownResult.response, { type: 'shutdown-complete' })) {
          throw new AdapterProtocolError(
            'invalid_adapter_response',
            'Persistent adapter shutdown acknowledgement has the wrong type or shape.',
          );
        }
        shutdownAcknowledged = true;
      } catch (error) {
        closeError = error;
      }
    }
    const termination = terminateProcessGroup();
    let closeTimer;
    await Promise.race([
      childClosePromise,
      new Promise((resolve) => {
        closeTimer = setTimeout(
          resolve,
          (adapter.terminateGraceSeconds + 1) * 1000,
        );
        closeTimer.unref();
      }),
    ]);
    clearTimeout(closeTimer);
    const terminationError = await termination;
    if (terminationError !== null) {
      const cleanupError = terminationError instanceof AdapterProtocolError
        ? terminationError
        : new AdapterProtocolError(
          'executor_process_group_cleanup_failed',
          `Persistent adapter process-group cleanup failed: ${terminationError.message}`,
        );
      cleanupError.cleanupUnproven = true;
      cleanupError.details = {
        ...cleanupError.details,
        processGroupId: childProcessGroupId,
        priorErrorCode: closeError?.code ?? null,
      };
      closeError = cleanupError;
    }
    if (!childCloseObserved && closeError === null) {
      closeError = new AdapterProtocolError(
        'executor_shutdown_timeout',
        'Persistent adapter did not close after shutdown and process-group termination.',
      );
    }
    closeError ??= unreportedProtocolError;
    if (closeError === null && workingDirectoryHandle !== null) {
      try {
        await verifyWorkingDirectory();
      } catch (error) {
        closeError = error;
      }
    }
    if (closeError === null && stdoutBuffer.length > 0) {
      closeError = new AdapterProtocolError(
        'unexpected_adapter_output',
        'Persistent adapter closed with trailing partial stdout.',
      );
    }
    protocolState = 'closed';
    try {
      if (closeError !== null) throw closeError;
    } finally {
      await closeWorkingDirectory();
      await closeOwnedOutputStore();
    }
  }

  return {
    execute,
    close,
    registerCleanupGuard(cleanupGuard) {
      if (child !== null || starting !== null || initialized) {
        throw new AdapterProtocolError(
          'executor_cleanup_guard_registration_late',
          'Cleanup guards must be registered before adapter spawn.',
        );
      }
      if (typeof cleanupGuard?.recordCleanupProcessGroup !== 'function') {
        throw new AdapterProtocolError(
          'executor_cleanup_guard_invalid',
          'Persistent adapter cleanup guard must record a process group.',
        );
      }
      registeredCleanupGuards.push(cleanupGuard);
    },
    get pid() {
      return child?.pid ?? null;
    },
  };
}
