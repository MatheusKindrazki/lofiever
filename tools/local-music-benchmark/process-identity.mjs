import { execFile as nodeExecFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(nodeExecFile);

const PROCESS_IDENTITY_ENVIRONMENT = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  TZ: 'UTC',
});

const PROCESS_IDENTITY_TIMEOUT_MS = 5_000;
const PROCESS_IDENTITY_MAX_BUFFER_BYTES = 16 * 1024;

const PYTHON_PROCESS_IDENTITY_PROBE = String.raw`
import ctypes
import json
import sys


class ProcBsdInfo(ctypes.Structure):
    _fields_ = [
        ("pbi_flags", ctypes.c_uint32),
        ("pbi_status", ctypes.c_uint32),
        ("pbi_xstatus", ctypes.c_uint32),
        ("pbi_pid", ctypes.c_uint32),
        ("pbi_ppid", ctypes.c_uint32),
        ("pbi_uid", ctypes.c_uint32),
        ("pbi_gid", ctypes.c_uint32),
        ("pbi_ruid", ctypes.c_uint32),
        ("pbi_rgid", ctypes.c_uint32),
        ("pbi_svuid", ctypes.c_uint32),
        ("pbi_svgid", ctypes.c_uint32),
        ("rfu_1", ctypes.c_uint32),
        ("pbi_comm", ctypes.c_char * 16),
        ("pbi_name", ctypes.c_char * 32),
        ("pbi_nfiles", ctypes.c_uint32),
        ("pbi_pgid", ctypes.c_uint32),
        ("pbi_pjobc", ctypes.c_uint32),
        ("e_tdev", ctypes.c_uint32),
        ("e_tpgid", ctypes.c_uint32),
        ("pbi_nice", ctypes.c_int32),
        ("pbi_start_tvsec", ctypes.c_uint64),
        ("pbi_start_tvusec", ctypes.c_uint64),
    ]


pid = int(sys.argv[1])
info = ProcBsdInfo()
expected_size = 136
if ctypes.sizeof(info) != expected_size:
    raise SystemExit(3)
libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
libproc.proc_pidinfo.argtypes = [
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_uint64,
    ctypes.c_void_p,
    ctypes.c_int,
]
libproc.proc_pidinfo.restype = ctypes.c_int
ctypes.set_errno(0)
result = libproc.proc_pidinfo(
    pid,
    3,
    0,
    ctypes.byref(info),
    expected_size,
)
error_number = ctypes.get_errno()
if result != expected_size or error_number != 0:
    raise SystemExit(2)
sys.stdout.write(json.dumps({
    "pid": info.pbi_pid,
    "startMicroseconds": info.pbi_start_tvusec,
    "startSeconds": info.pbi_start_tvsec,
    "uid": info.pbi_uid,
}, separators=(",", ":"), sort_keys=True) + "\n")
`;

function sha256Receipt(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function validRequest(pid, hostname) {
  return (
    Number.isInteger(pid) &&
    pid > 0 &&
    typeof hostname === 'string' &&
    /^[^\0\r\n]{1,255}$/u.test(hostname)
  );
}

function canonicalUtcProcessStart(startSeconds) {
  const observed = new Date(startSeconds * 1_000);
  if (!Number.isFinite(observed.valueOf())) return null;

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const year = String(observed.getUTCFullYear());
  if (!/^\d{4}$/u.test(year)) return null;

  return `${weekdays[observed.getUTCDay()]} ${months[observed.getUTCMonth()]} ${String(observed.getUTCDate()).padStart(2, ' ')} ${String(observed.getUTCHours()).padStart(2, '0')}:${String(observed.getUTCMinutes()).padStart(2, '0')}:${String(observed.getUTCSeconds()).padStart(2, '0')} ${year}`;
}

function identityReceipt(pid, hostname, startedAt) {
  return sha256Receipt(`${hostname}\0${pid}\0${startedAt}`);
}

/**
 * Preserves the historical, non-confined `/bin/ps` process-start observer.
 * Any uncertainty remains fail-closed as a null observation.
 */
export async function observeProcessStartIdentityWithPs(
  pid,
  hostname,
  { execFile = execFileAsync } = {},
) {
  if (!validRequest(pid, hostname) || typeof execFile !== 'function') return null;
  try {
    const { stdout, stderr = '' } = await execFile(
      '/bin/ps',
      ['-o', 'lstart=', '-p', String(pid)],
      {
        encoding: 'utf8',
        env: PROCESS_IDENTITY_ENVIRONMENT,
        maxBuffer: PROCESS_IDENTITY_MAX_BUFFER_BYTES,
        shell: false,
        timeout: PROCESS_IDENTITY_TIMEOUT_MS,
      },
    );
    if (typeof stdout !== 'string' || stderr !== '') return null;
    const startedAt = stdout.trim();
    return startedAt.length === 0 ? null : identityReceipt(pid, hostname, startedAt);
  } catch {
    return null;
  }
}

/**
 * Creates a sandbox-compatible observer backed by a previously verified,
 * absolute Python executable and Darwin's libproc process metadata.
 */
export function createPinnedPythonProcessIdentityObserver({
  pythonExecutable,
  execFile = execFileAsync,
  expectedUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  if (
    typeof pythonExecutable !== 'string' ||
    !path.isAbsolute(pythonExecutable) ||
    pythonExecutable.includes('\0') ||
    typeof execFile !== 'function' ||
    !Number.isInteger(expectedUid) ||
    expectedUid < 0
  ) {
    throw new TypeError(
      'A pinned absolute Python executable, execFile function, and current numeric uid are required.',
    );
  }

  return async function observeProcessStartIdentity(pid, hostname) {
    if (!validRequest(pid, hostname)) return null;

    let result;
    try {
      result = await execFile(
        pythonExecutable,
        ['-I', '-S', '-B', '-P', '-c', PYTHON_PROCESS_IDENTITY_PROBE, String(pid)],
        {
          encoding: 'utf8',
          env: PROCESS_IDENTITY_ENVIRONMENT,
          maxBuffer: PROCESS_IDENTITY_MAX_BUFFER_BYTES,
          shell: false,
          timeout: PROCESS_IDENTITY_TIMEOUT_MS,
        },
      );
    } catch {
      return null;
    }

    if (
      result === null ||
      typeof result !== 'object' ||
      typeof result.stdout !== 'string' ||
      (result.stderr ?? '') !== '' ||
      (result.exitCode !== undefined && result.exitCode !== 0) ||
      (result.status !== undefined && result.status !== 0) ||
      (result.code !== undefined && result.code !== 0)
    ) {
      return null;
    }

    let frame;
    try {
      frame = JSON.parse(result.stdout);
    } catch {
      return null;
    }
    if (
      !exactKeys(frame, ['pid', 'startMicroseconds', 'startSeconds', 'uid']) ||
      frame.pid !== pid ||
      frame.uid !== expectedUid ||
      !Number.isSafeInteger(frame.startSeconds) ||
      frame.startSeconds <= 0 ||
      !Number.isInteger(frame.startMicroseconds) ||
      frame.startMicroseconds < 0 ||
      frame.startMicroseconds > 999_999
    ) {
      return null;
    }

    const startedAt = canonicalUtcProcessStart(frame.startSeconds);
    return startedAt === null ? null : identityReceipt(pid, hostname, startedAt);
  };
}

/**
 * Selects the execute-mode backend without allowing a Darwin fallback. Linux
 * CI remains on the portable legacy observer because libproc is macOS-only.
 */
export function createExecutionProcessIdentityObserver({
  platform = process.platform,
  pythonExecutable,
  execFile = execFileAsync,
  expectedUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  if (platform === 'darwin') {
    return createPinnedPythonProcessIdentityObserver({
      pythonExecutable,
      execFile,
      expectedUid,
    });
  }
  return (pid, hostname) => observeProcessStartIdentityWithPs(
    pid,
    hostname,
    { execFile },
  );
}
