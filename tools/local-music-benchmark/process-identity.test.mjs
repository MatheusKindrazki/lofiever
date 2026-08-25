import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  createExecutionProcessIdentityObserver,
  createPinnedPythonProcessIdentityObserver,
  observeProcessStartIdentityWithPs,
} from './process-identity.mjs';

const execFileAsync = promisify(execFile);

function receipt(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function validFrame(overrides = {}) {
  return {
    pid: 1234,
    startMicroseconds: 123_456,
    startSeconds: 1_777_390_592,
    uid: 501,
    ...overrides,
  };
}

function observerWithResult(result, calls = []) {
  return createPinnedPythonProcessIdentityObserver({
    pythonExecutable: '/verified/python3.12',
    expectedUid: 501,
    execFile: async (...args) => {
      calls.push(args);
      return result;
    },
  });
}

test('accepts an exact libproc frame and preserves the legacy UTC/C identity', async () => {
  const calls = [];
  const frame = validFrame();
  const observer = observerWithResult({
    stdout: `${JSON.stringify(frame)}\n`,
    stderr: '',
  }, calls);

  const actual = await observer(frame.pid, 'm5max.local');
  const canonicalStart = 'Tue Apr 28 15:36:32 2026';
  assert.equal(actual, receipt(`m5max.local\0${frame.pid}\0${canonicalStart}`));

  const legacy = await observeProcessStartIdentityWithPs(frame.pid, 'm5max.local', {
    execFile: async () => ({ stdout: ` ${canonicalStart}\n`, stderr: '' }),
  });
  assert.equal(actual, legacy);

  assert.equal(calls.length, 1);
  const [file, args, options] = calls[0];
  assert.equal(file, '/verified/python3.12');
  assert.deepEqual(args.slice(0, 6), ['-I', '-S', '-B', '-P', '-c', args[5]]);
  assert.match(args[5], /proc_pidinfo/u);
  assert.match(args[5], /expected_size = 136/u);
  assert.equal(args[6], String(frame.pid));
  assert.deepEqual(options, {
    encoding: 'utf8',
    env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    maxBuffer: 16 * 1024,
    shell: false,
    timeout: 5_000,
  });
});

test('rejects forged, malformed, or non-canonical libproc frames', async () => {
  const cases = [
    validFrame({ pid: 4321 }),
    validFrame({ uid: 502 }),
    { ...validFrame(), extra: true },
    { pid: 1234, startSeconds: 1_777_390_592, uid: 501 },
    validFrame({ pid: '1234' }),
    validFrame({ uid: '501' }),
    validFrame({ startSeconds: 0 }),
    validFrame({ startSeconds: 1.5 }),
    validFrame({ startSeconds: Number.MAX_SAFE_INTEGER + 1 }),
    validFrame({ startMicroseconds: -1 }),
    validFrame({ startMicroseconds: 1_000_000 }),
    validFrame({ startMicroseconds: 0.5 }),
    null,
    [],
  ];

  for (const frame of cases) {
    const observer = observerWithResult({ stdout: JSON.stringify(frame), stderr: '' });
    assert.equal(await observer(1234, 'm5max.local'), null);
  }
});

test('rejects stderr, invalid JSON, extra output, nonzero status, and probe failures', async () => {
  const frame = JSON.stringify(validFrame());
  const invalidResults = [
    { stdout: frame, stderr: 'warning\n' },
    { stdout: '{', stderr: '' },
    { stdout: `${frame}\n${frame}\n`, stderr: '' },
    { stdout: frame, stderr: '', exitCode: 2 },
    { stdout: frame, stderr: '', status: 2 },
    { stdout: frame, stderr: '', code: 2 },
    { stdout: Buffer.from(frame), stderr: '' },
    null,
  ];
  for (const result of invalidResults) {
    const observer = observerWithResult(result);
    assert.equal(await observer(1234, 'm5max.local'), null);
  }

  for (const error of [
    Object.assign(new Error('exit 2'), { code: 2 }),
    Object.assign(new Error('timed out'), { code: 'ETIMEDOUT', killed: true }),
    new Error('spawn failed'),
  ]) {
    const observer = createPinnedPythonProcessIdentityObserver({
      pythonExecutable: '/verified/python3.12',
      expectedUid: 501,
      execFile: async () => { throw error; },
    });
    assert.equal(await observer(1234, 'm5max.local'), null);
  }
});

test('fails closed for invalid requests and invalid factory capabilities', async () => {
  let calls = 0;
  const observer = createPinnedPythonProcessIdentityObserver({
    pythonExecutable: '/verified/python3.12',
    expectedUid: 501,
    execFile: async () => {
      calls += 1;
      return { stdout: JSON.stringify(validFrame()), stderr: '' };
    },
  });
  for (const [pid, hostname] of [
    [0, 'host'],
    [-1, 'host'],
    [1.5, 'host'],
    [1234, ''],
    [1234, 'host\0forged'],
    [1234, 'host\nforged'],
    [1234, 'h'.repeat(256)],
  ]) {
    assert.equal(await observer(pid, hostname), null);
  }
  assert.equal(calls, 0);

  assert.throws(() => createPinnedPythonProcessIdentityObserver(), TypeError);
  assert.throws(
    () => createPinnedPythonProcessIdentityObserver({
      pythonExecutable: 'relative/python',
      expectedUid: 501,
    }),
    TypeError,
  );
  assert.throws(
    () => createPinnedPythonProcessIdentityObserver({
      pythonExecutable: '/verified/python',
      expectedUid: null,
    }),
    TypeError,
  );
});

test('legacy observer remains bounded, absolute, shell-free, and fail-closed', async () => {
  const calls = [];
  const actual = await observeProcessStartIdentityWithPs(1234, 'm5max.local', {
    execFile: async (...args) => {
      calls.push(args);
      return { stdout: 'Tue Apr 28 10:16:32 2026\n', stderr: '' };
    },
  });
  assert.equal(
    actual,
    receipt('m5max.local\0' + '1234\0Tue Apr 28 10:16:32 2026'),
  );
  assert.deepEqual(calls, [[
    '/bin/ps',
    ['-o', 'lstart=', '-p', '1234'],
    {
      encoding: 'utf8',
      env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
      maxBuffer: 16 * 1024,
      shell: false,
      timeout: 5_000,
    },
  ]]);

  assert.equal(await observeProcessStartIdentityWithPs(0, 'host'), null);
  assert.equal(await observeProcessStartIdentityWithPs(1234, 'host', {
    execFile: async () => { throw new Error('ps unavailable'); },
  }), null);
  assert.equal(await observeProcessStartIdentityWithPs(1234, 'host', {
    execFile: async () => ({ stdout: '', stderr: '' }),
  }), null);
});

test('execute backend uses ps off Darwin and never falls back from Darwin', async () => {
  const calls = [];
  const linuxObserver = createExecutionProcessIdentityObserver({
    platform: 'linux',
    pythonExecutable: '/unused/python',
    expectedUid: 501,
    execFile: async (...args) => {
      calls.push(args);
      return { stdout: 'Tue Apr 28 10:16:32 2026\n', stderr: '' };
    },
  });
  assert.match(await linuxObserver(1234, 'linux.local'), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(calls[0][0], '/bin/ps');

  const darwinCalls = [];
  const darwinObserver = createExecutionProcessIdentityObserver({
    platform: 'darwin',
    pythonExecutable: '/verified/python3.12',
    expectedUid: 501,
    execFile: async (...args) => {
      darwinCalls.push(args);
      throw Object.assign(new Error('probe failed'), { code: 2 });
    },
  });
  assert.equal(await darwinObserver(1234, 'darwin.local'), null);
  assert.equal(darwinCalls.length, 1);
  assert.equal(darwinCalls[0][0], '/verified/python3.12');
  assert.notEqual(darwinCalls[0][0], '/bin/ps');
});

test(
  'backs both benchmark locks inside the no-network sandbox',
  { skip: process.platform !== 'darwin', timeout: 20_000 },
  async (t) => {
    let pathPython = null;
    try {
      pathPython = (await execFileAsync('/usr/bin/which', ['python3'], {
        encoding: 'utf8',
      })).stdout.trim();
    } catch {
      // Explicit candidates below remain authoritative.
    }
    const candidates = [
      process.env.LOFIGEN_TEST_PINNED_PYTHON,
      pathPython,
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/usr/bin/python3',
    ].filter(Boolean);
    let pythonExecutable = null;
    for (const candidate of candidates) {
      try {
        await access(candidate);
        const resolved = await realpath(candidate);
        await execFileAsync(resolved, ['-I', '-S', '-B', '-P', '-c', 'pass'], {
          encoding: 'utf8',
          env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
          timeout: 5_000,
        });
        pythonExecutable = resolved;
        break;
      } catch {
        // Try the next explicit absolute runtime.
      }
    }
    if (pythonExecutable === null) {
      t.skip('No real Python runtime with isolated-path support is available.');
      return;
    }

    const temporaryDirectory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'process-identity-')),
    );
    const runner = path.join(temporaryDirectory, 'runner.mjs');
    const outputDirectory = path.join(temporaryDirectory, 'output');
    const machineLockTarget = path.join(temporaryDirectory, 'machine-metal');
    await mkdir(outputDirectory, { mode: 0o700 });
    const moduleUrl = pathToFileURL(
      path.join(import.meta.dirname, 'process-identity.mjs'),
    ).href;
    const confinedStoreUrl = pathToFileURL(
      path.join(import.meta.dirname, 'confined-output-store.mjs'),
    ).href;
    const confinedLockUrl = pathToFileURL(
      path.join(import.meta.dirname, 'confined-run-lock.mjs'),
    ).href;
    const storageUrl = pathToFileURL(
      path.join(import.meta.dirname, 'storage.mjs'),
    ).href;
    await writeFile(runner, `
import net from 'node:net';
import { createPinnedPythonProcessIdentityObserver } from ${JSON.stringify(moduleUrl)};
import { createConfinedOutputStore } from ${JSON.stringify(confinedStoreUrl)};
import { acquireConfinedRunLock } from ${JSON.stringify(confinedLockUrl)};
import { acquireRunLock } from ${JSON.stringify(storageUrl)};
const observe = createPinnedPythonProcessIdentityObserver({
  pythonExecutable: process.argv[2],
});
const identity = await observe(process.pid, 'sandbox.local');
const store = await createConfinedOutputStore(process.argv[3]);
let sessionLock = null;
let machineLock = null;
try {
  sessionLock = await acquireConfinedRunLock(store, 'benchmark-run', {
    observeHostname: () => 'sandbox.local',
    observeProcessStartIdentity: observe,
  });
  machineLock = await acquireRunLock(process.argv[4], {
    observeHostname: () => 'sandbox.local',
    observeProcessStartIdentity: observe,
  });
  const networkError = await new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 9 });
    socket.once('connect', () => {
      socket.destroy();
      resolve('CONNECTED');
    });
    socket.once('error', (error) => resolve(error.code ?? error.message));
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolve('TIMEOUT');
    });
  });
  process.stdout.write(JSON.stringify({
    helperPid: store.helperProcessId,
    identity,
    machineIdentity: machineLock.owner.processStartIdentity,
    networkError,
    sessionHelperIdentity: sessionLock.owner.helperProcessStartIdentity,
    sessionIdentity: sessionLock.owner.processStartIdentity,
  }) + '\\n');
} finally {
  await machineLock?.release();
  if (sessionLock !== null) {
    store.bindTerminalRelease(await sessionLock.prepareTerminalRelease());
  }
  await store.close();
}
`, { mode: 0o600 });

    try {
      const { stdout, stderr } = await execFileAsync(
        '/usr/bin/sandbox-exec',
        [
          '-p',
          '(version 1)\n(allow default)\n(deny network*)',
          process.execPath,
          runner,
          pythonExecutable,
          outputDirectory,
          machineLockTarget,
        ],
        {
          encoding: 'utf8',
          env: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
          maxBuffer: 64 * 1024,
          shell: false,
          timeout: 15_000,
        },
      );
      assert.equal(stderr, '');
      const frame = JSON.parse(stdout);
      assert.match(frame.identity, /^sha256:[a-f0-9]{64}$/u);
      assert.match(frame.machineIdentity, /^sha256:[a-f0-9]{64}$/u);
      assert.match(frame.sessionIdentity, /^sha256:[a-f0-9]{64}$/u);
      assert.match(frame.sessionHelperIdentity, /^sha256:[a-f0-9]{64}$/u);
      assert.equal(frame.machineIdentity, frame.identity);
      assert.equal(frame.sessionIdentity, frame.identity);
      assert.equal(Number.isInteger(frame.helperPid), true);
      assert.equal(frame.helperPid > 0, true);
      assert.equal(frame.networkError, 'EPERM');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  },
);
