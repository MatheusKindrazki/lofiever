import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { serializeManifest } from './manifest.mjs';
import { spikeManifestSchema } from './schema.mjs';
import {
  assertExecutableClosureConfined,
  assertMachOExecutableClosure,
  assertRelocatablePythonClosure,
  captureExecutableClosure,
  revalidateExecutableClosure,
} from './dynamic-linker.mjs';

const execFileAsync = promisify(execFile);

const HOST_IDENTITY_COMPONENT_MAX_LENGTH = 255;
const HOST_IDENTITY_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function normalizeHostIdentityComponent(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > HOST_IDENTITY_COMPONENT_MAX_LENGTH ||
    HOST_IDENTITY_CONTROL_CHARACTERS.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export async function observeHostIdentity({
  platform = process.platform,
  hostname = os.hostname,
  cpus = os.cpus,
  totalmem = os.totalmem,
  type = os.type,
  release = os.release,
  version = os.version,
  execFile: executeFile = execFileAsync,
} = {}) {
  const machine = normalizeHostIdentityComponent(hostname());
  const chip = normalizeHostIdentityComponent(cpus()[0]?.model ?? null);
  const memoryBytes = totalmem();
  let osVersion;
  if (platform === 'darwin') {
    const options = {
      encoding: 'utf8',
      env: { LC_ALL: 'C', LANG: 'C' },
      maxBuffer: 64 * 1024,
      shell: false,
      timeout: 10_000,
    };
    let product;
    let build;
    try {
      [{ stdout: product }, { stdout: build }] = await Promise.all([
        executeFile('/usr/bin/sw_vers', ['-productVersion'], options),
        executeFile('/usr/bin/sw_vers', ['-buildVersion'], options),
      ]);
    } catch (error) {
      throw new BenchmarkIntegrityError(
        'host_identity_unavailable',
        'Could not observe the canonical macOS product and build identity.',
        { cause: error?.message ?? String(error) },
      );
    }
    const productVersion = normalizeHostIdentityComponent(product);
    const buildVersion = normalizeHostIdentityComponent(build);
    if (productVersion === null || buildVersion === null) {
      throw new BenchmarkIntegrityError(
        'host_identity_unavailable',
        'The canonical macOS product or build identity is invalid.',
      );
    }
    osVersion = `macOS ${productVersion} (${buildVersion})`;
  } else {
    const systemType = normalizeHostIdentityComponent(type());
    const systemRelease = normalizeHostIdentityComponent(release());
    const systemVersion = normalizeHostIdentityComponent(version());
    if (systemType === null || systemRelease === null || systemVersion === null) {
      throw new BenchmarkIntegrityError(
        'host_identity_unavailable',
        'The canonical operating-system identity is invalid.',
      );
    }
    osVersion = `${systemType} ${systemRelease} (${systemVersion})`;
  }
  if (
    machine === null ||
    chip === null ||
    !Number.isSafeInteger(memoryBytes) ||
    memoryBytes <= 0 ||
    HOST_IDENTITY_CONTROL_CHARACTERS.test(osVersion)
  ) {
    throw new BenchmarkIntegrityError(
      'host_identity_unavailable',
      'The benchmark host identity could not be observed completely.',
    );
  }
  return { machine, chip, memoryBytes, osVersion };
}

export class BenchmarkIntegrityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BenchmarkIntegrityError';
    this.code = code;
    this.details = details;
  }
}

function receipt(digest) {
  return `sha256:${digest}`;
}

function sha256Value(value) {
  return receipt(createHash('sha256').update(value).digest('hex'));
}

function sanitizedEnvironment() {
  return Object.fromEntries(
    ['HOME', 'TMPDIR', 'LANG', 'LC_ALL']
      .filter((name) => typeof process.env[name] === 'string')
      .map((name) => [name, process.env[name]]),
  );
}

const UNSAFE_CHILD_ENVIRONMENT = /^(?:DYLD_|LD_PRELOAD$|LD_LIBRARY_PATH$)/u;

export function assertSafeChildEnvironment(environment, label = 'child process') {
  if (environment === null || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new BenchmarkIntegrityError(
      'unsafe_process_environment',
      `${label} environment must be an explicit string map.`,
    );
  }
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value !== 'string' || UNSAFE_CHILD_ENVIRONMENT.test(name)) {
      throw new BenchmarkIntegrityError(
        'unsafe_process_environment',
        `${label} environment contains an unsafe or non-string entry: ${name}.`,
      );
    }
  }
  return environment;
}

export function assertProcessEnvironmentReceipt(
  environment,
  expectedReceipt,
  expectedSha256,
) {
  assertSafeChildEnvironment(environment, 'Benchmark');
  const actualReceipt = Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({ name, valueSha256: sha256Value(value) }));
  const actualSha256 = sha256Value(serializeManifest(actualReceipt));
  if (
    serializeManifest(actualReceipt) !== serializeManifest(expectedReceipt) ||
    actualSha256 !== expectedSha256
  ) {
    throw new BenchmarkIntegrityError(
      'process_environment_receipt_mismatch',
      'Benchmark child environment does not match the verified manifest receipt.',
    );
  }
  return environment;
}

export function resolvePinnedPath(value) {
  if (value === '$HOME') return os.homedir();
  if (value.startsWith('$HOME/')) return path.join(os.homedir(), value.slice(6));
  return path.resolve(value);
}

async function digestFile(filePath) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(filePath, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new BenchmarkIntegrityError(
        'unsupported_pinned_path',
        `Pinned path is not a regular file: ${filePath}`,
      );
    }
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
    }
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new BenchmarkIntegrityError(
        'path_changed_while_hashing',
        `Pinned file changed while it was being hashed: ${filePath}`,
      );
    }
    return receipt(hash.digest('hex'));
  } finally {
    await handle.close();
  }
}

async function readPinnedFileBytes(pin, { executable = false, label = 'path' } = {}) {
  const requestedPath = resolvePinnedPath(pin.path);
  const canonicalPath = await realpath(requestedPath);
  if (canonicalPath !== pin.realpath) {
    throw new BenchmarkIntegrityError(
      'pin_mismatch',
      `${label} realpath does not match its pin.`,
      { expected: pin.realpath, actual: canonicalPath },
    );
  }
  const handle = await open(
    canonicalPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || (executable && (before.mode & 0o111) === 0)) {
      throw new BenchmarkIntegrityError(
        executable ? 'pinned_executable_not_executable' : 'unsupported_pinned_path',
        `${label} must be a regular${executable ? ' executable' : ''} file.`,
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new BenchmarkIntegrityError(
        'path_changed_while_hashing',
        `${label} changed while its execution snapshot was being read.`,
      );
    }
    const actualSha256 = sha256Value(bytes);
    if (actualSha256 !== pin.sha256) {
      throw new BenchmarkIntegrityError('pin_mismatch', `${label} digest does not match its pin.`, {
        expected: pin.sha256,
        actual: actualSha256,
      });
    }
    const currentCanonicalPath = await realpath(requestedPath);
    const pathStats = await lstat(currentCanonicalPath);
    if (
      currentCanonicalPath !== canonicalPath ||
      pathStats.dev !== after.dev ||
      pathStats.ino !== after.ino
    ) {
      throw new BenchmarkIntegrityError(
        'path_changed_while_hashing',
        `${label} path changed while its execution snapshot was being read.`,
      );
    }
    return bytes;
  } finally {
    await handle.close();
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

async function snapshotPinnedFile(
  pin,
  runDirectoryIdentity,
  { executable = false, label },
) {
  const currentRunIdentity = await verifyPrivateDirectory(runDirectoryIdentity.realpath);
  if (serializeManifest(currentRunIdentity) !== serializeManifest(runDirectoryIdentity)) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_identity_changed',
      'The pinned run directory changed before the execution TCB snapshot was created.',
    );
  }
  const bytes = await readPinnedFileBytes(pin, { executable, label });
  const safeLabel = label.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase();
  const snapshotPath = path.join(
    runDirectoryIdentity.realpath,
    `.lofiever-tcb-${safeLabel}-${pin.sha256.slice('sha256:'.length)}`,
  );
  const snapshotPin = { ...pin, path: snapshotPath, realpath: snapshotPath };
  try {
    const verified = await verifyPinnedPath(snapshotPin, { executable, label: `${label} snapshot` });
    return { ...pin, ...verified };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new BenchmarkIntegrityError(
        'tcb_snapshot_mismatch',
        `Existing ${label} execution snapshot does not match its verified bytes.`,
        { cause: error?.message ?? String(error), snapshotPath },
      );
    }
  }

  const temporaryPath = `${snapshotPath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  const mode = executable ? 0o500 : 0o400;
  const handle = await open(temporaryPath, 'wx', mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, snapshotPath);
    await syncDirectory(runDirectoryIdentity.realpath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
  try {
    const verified = await verifyPinnedPath(snapshotPin, { executable, label: `${label} snapshot` });
    return { ...pin, ...verified };
  } catch (error) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_mismatch',
      `Created ${label} execution snapshot does not match its verified bytes.`,
      { cause: error?.message ?? String(error), snapshotPath },
    );
  }
}

function isInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function listRuntimeTree(rootPath, relativeDirectory = '', pathImports = []) {
  const directoryPath = path.join(rootPath, relativeDirectory);
  const directory = await opendir(directoryPath);
  const entries = [];
  for await (const entry of directory) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  const result = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(rootPath, relativePath);
    const stats = await lstat(absolutePath);
    const receiptPath = relativePath.split(path.sep).join('/');
    if (stats.isSymbolicLink()) {
      const resolvedTarget = await realpath(absolutePath);
      if (!isInside(rootPath, resolvedTarget)) {
        throw new BenchmarkIntegrityError(
          'runtime_symlink_escape',
          `Python runtime symlink escapes its pinned tree: ${receiptPath}`,
        );
      }
      if (entry.name.toLowerCase().endsWith('.pth')) {
        const imports = await validatePythonPathFile(
          rootPath,
          resolvedTarget,
          receiptPath,
          path.dirname(absolutePath),
        );
        pathImports.push(
          ...imports.map((moduleName) => ({
            moduleName,
            resolutionDirectory: path.dirname(absolutePath),
          })),
        );
      }
      result.push({
        path: receiptPath,
        type: 'symlink',
        target: path.relative(rootPath, resolvedTarget).split(path.sep).join('/'),
      });
    } else if (stats.isDirectory()) {
      result.push({ path: receiptPath, type: 'directory' });
      result.push(...(await listRuntimeTree(rootPath, relativePath, pathImports)));
    } else if (stats.isFile()) {
      if (entry.name.toLowerCase().endsWith('.pth')) {
        const imports = await validatePythonPathFile(
          rootPath,
          absolutePath,
          receiptPath,
          path.dirname(absolutePath),
        );
        pathImports.push(
          ...imports.map((moduleName) => ({
            moduleName,
            resolutionDirectory: path.dirname(absolutePath),
          })),
        );
      }
      result.push({
        path: receiptPath,
        type: 'file',
        executable: (stats.mode & 0o111) !== 0,
        sha256: await digestFile(absolutePath),
      });
    } else {
      throw new BenchmarkIntegrityError(
        'unsupported_python_runtime_entry',
        `Python runtime contains an unsupported entry: ${receiptPath}`,
      );
    }
  }
  return result;
}

async function validatePythonPathFile(
  rootPath,
  filePath,
  receiptPath,
  resolutionDirectory,
) {
  const { bytes } = await readStableFileBytes(filePath, `Python path file ${receiptPath}`);
  let contents;
  const imports = [];
  try {
    contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new BenchmarkIntegrityError(
      'python_path_configuration_invalid',
      `Python path file must be valid UTF-8: ${receiptPath}`,
    );
  }
  for (const [index, rawLine] of contents.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const importMatch =
      /^import[\t ]+([A-Za-z_][A-Za-z0-9_]*)$/u.exec(
        line,
      );
    if (importMatch !== null) {
      if (
        !(await resolvesInsidePinnedSitePackages(
          rootPath,
          resolutionDirectory,
          importMatch[1],
        ))
      ) {
        throw new BenchmarkIntegrityError(
          'python_path_configuration_external',
          `Python path import does not resolve inside its pinned tree: ${receiptPath}:${index + 1}`,
        );
      }
      imports.push(importMatch[1]);
      continue;
    }
    if (/^import(?:[\t ]|$)/u.test(line) || path.isAbsolute(line)) {
      throw new BenchmarkIntegrityError(
        'python_path_configuration_external',
        `Python path file can execute or reference external code: ${receiptPath}:${index + 1}`,
      );
    }
    const resolvedEntry = path.resolve(resolutionDirectory, line);
    if (!isInside(rootPath, resolvedEntry)) {
      throw new BenchmarkIntegrityError(
        'python_path_configuration_external',
        `Python path file escapes its pinned tree: ${receiptPath}:${index + 1}`,
      );
    }
  }
  return imports;
}

async function resolvesInsidePinnedSitePackages(
  rootPath,
  resolutionDirectory,
  moduleName,
) {
  const segments = moduleName.split('.');
  const moduleBase = path.join(resolutionDirectory, ...segments);
  const candidates = [
    `${moduleBase}.py`,
    path.join(moduleBase, '__init__.py'),
  ];
  const parentDirectory = path.dirname(moduleBase);
  const moduleLeaf = path.basename(moduleBase);
  try {
    const directory = await opendir(parentDirectory);
    for await (const entry of directory) {
      if (
        entry.isFile() &&
        entry.name.startsWith(`${moduleLeaf}.`) &&
        /\.(?:so|pyd|dylib)$/u.test(entry.name)
      ) {
        candidates.push(path.join(parentDirectory, entry.name));
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
  }

  for (const candidate of candidates) {
    try {
      const resolved = await realpath(candidate);
      if (!isInside(rootPath, resolved)) continue;
      const stats = await lstat(resolved);
      if (stats.isFile()) return true;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
  }
  return false;
}

async function verifyPythonPathImports(pythonExecutable, pathImports) {
  const executable = await realpath(pythonExecutable);
  const probe = [
    'import importlib.machinery, sys',
    'resolution_directory, module_name = sys.argv[1:3]',
    'spec = importlib.machinery.BuiltinImporter.find_spec(module_name)',
    'spec = spec or importlib.machinery.FrozenImporter.find_spec(module_name)',
    'spec = spec or importlib.machinery.PathFinder.find_spec(module_name, [resolution_directory])',
    'origin = "" if spec is None or spec.origin is None else spec.origin',
    'print(origin.encode("utf-8").hex())',
  ].join('; ');
  const uniqueImports = new Map(
    pathImports.map((entry) => [
      `${entry.resolutionDirectory}\0${entry.moduleName}`,
      entry,
    ]),
  );
  for (const { moduleName, resolutionDirectory } of uniqueImports.values()) {
    let stdout;
    try {
      ({ stdout } = await execFileAsync(
        executable,
        ['-I', '-S', '-c', probe, resolutionDirectory, moduleName],
        {
          cwd: path.dirname(executable),
          encoding: 'utf8',
          env: {
            PYTHONDONTWRITEBYTECODE: '1',
            PYTHONNOUSERSITE: '1',
            PYTHONSAFEPATH: '1',
          },
          maxBuffer: 64 * 1024,
          timeout: 10_000,
        },
      ));
    } catch (error) {
      throw new BenchmarkIntegrityError(
        'python_path_resolution_failed',
        `Could not resolve pinned Python path import ${moduleName}.`,
        { cause: error?.message ?? String(error) },
      );
    }
    const encodedOrigin = stdout.trim();
    if (!/^(?:[a-f0-9]{2})*$/u.test(encodedOrigin)) {
      throw new BenchmarkIntegrityError(
        'python_path_resolution_failed',
        `Python returned an invalid resolution receipt for ${moduleName}.`,
      );
    }
    const origin = Buffer.from(encodedOrigin, 'hex').toString('utf8');
    if (typeof origin !== 'string' || !path.isAbsolute(origin)) {
      throw new BenchmarkIntegrityError(
        'python_path_resolution_external',
        `Python path import ${moduleName} resolves to a builtin, frozen, or missing module.`,
        { origin: origin ?? null },
      );
    }
    const resolvedOrigin = await realpath(origin);
    const canonicalResolutionDirectory = await realpath(resolutionDirectory);
    if (!isInside(canonicalResolutionDirectory, resolvedOrigin)) {
      throw new BenchmarkIntegrityError(
        'python_path_resolution_external',
        `Python path import ${moduleName} resolves outside its pinned site-packages tree.`,
        { origin: resolvedOrigin, sitePackages: canonicalResolutionDirectory },
      );
    }
  }
}

export async function pinPythonRuntimeDirectory(
  directoryPath,
  { pythonExecutable = null } = {},
) {
  const canonicalPath = await realpath(directoryPath);
  const stats = await lstat(canonicalPath);
  if (!stats.isDirectory()) {
    throw new BenchmarkIntegrityError(
      'python_runtime_directory_required',
      `Python runtime path is not a directory: ${directoryPath}`,
    );
  }
  const pathImports = [];
  const tree = await listRuntimeTree(canonicalPath, '', pathImports);
  if (pathImports.length > 0) {
    if (pythonExecutable === null) {
      throw new BenchmarkIntegrityError(
        'python_path_resolution_unverified',
        'Python path imports require the pinned interpreter for resolution proof.',
      );
    }
    await verifyPythonPathImports(pythonExecutable, pathImports);
  }
  return {
    path: directoryPath,
    realpath: canonicalPath,
    sha256: sha256Value(JSON.stringify(tree)),
    device: String(stats.dev),
    inode: String(stats.ino),
  };
}

async function detectVirtualEnvironment(executable, pythonVersion) {
  const launcherPath = resolvePinnedPath(executable.path);
  const rootPath = path.dirname(path.dirname(launcherPath));
  const configurationPath = path.join(rootPath, 'pyvenv.cfg');
  let configurationStats;
  try {
    configurationStats = await lstat(configurationPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!configurationStats.isFile()) {
    throw new BenchmarkIntegrityError(
      'python_virtual_environment_invalid',
      'Python virtual environment pyvenv.cfg must be a regular file.',
    );
  }
  const rootRealpath = await realpath(rootPath);
  const rootStats = await lstat(rootRealpath);
  const configurationRealpath = await realpath(configurationPath);
  const version = /^Python\s+(\d+)\.(\d+)/u.exec(pythonVersion);
  const sitePackagesPath =
    version === null
      ? null
      : path.join(rootRealpath, 'lib', `python${version[1]}.${version[2]}`, 'site-packages');
  let sitePackages = null;
  if (sitePackagesPath !== null) {
    try {
      sitePackages = await pinPythonRuntimeDirectory(sitePackagesPath, {
        pythonExecutable: executable.realpath,
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return {
    rootRealpath,
    device: String(rootStats.dev),
    inode: String(rootStats.ino),
    launcherPath,
    configuration: {
      path: configurationPath,
      realpath: configurationRealpath,
      sha256: await digestFile(configurationRealpath),
    },
    sitePackages,
  };
}

async function readStableFileBytes(filePath, label) {
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new BenchmarkIntegrityError(
        'unsupported_python_runtime_entry',
        `${label} is not a regular file.`,
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new BenchmarkIntegrityError(
        'path_changed_while_hashing',
        `${label} changed while its execution snapshot was being read.`,
      );
    }
    return { bytes, executable: (before.mode & 0o111) !== 0 };
  } finally {
    await handle.close();
  }
}

async function snapshotRuntimeTree(sourceRoot, destinationRoot, relativeDirectory = '') {
  const sourceDirectory = path.join(sourceRoot, relativeDirectory);
  const destinationDirectory = path.join(destinationRoot, relativeDirectory);
  await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  const directory = await opendir(sourceDirectory);
  const entries = [];
  for await (const entry of directory) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const sourcePath = path.join(sourceRoot, relativePath);
    const destinationPath = path.join(destinationRoot, relativePath);
    const stats = await lstat(sourcePath);
    if (stats.isSymbolicLink()) {
      const resolvedTarget = await realpath(sourcePath);
      if (!isInside(sourceRoot, resolvedTarget)) {
        throw new BenchmarkIntegrityError(
          'runtime_symlink_escape',
          `Python runtime symlink escapes its pinned tree: ${relativePath}`,
        );
      }
      const snapshotTarget = path.join(
        destinationRoot,
        path.relative(sourceRoot, resolvedTarget),
      );
      await symlink(path.relative(path.dirname(destinationPath), snapshotTarget), destinationPath);
    } else if (stats.isDirectory()) {
      await snapshotRuntimeTree(sourceRoot, destinationRoot, relativePath);
    } else if (stats.isFile()) {
      const stable = await readStableFileBytes(sourcePath, `Python runtime ${relativePath}`);
      const handle = await open(destinationPath, 'wx', stable.executable ? 0o500 : 0o400);
      try {
        await handle.writeFile(stable.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else {
      throw new BenchmarkIntegrityError(
        'unsupported_python_runtime_entry',
        `Python runtime contains an unsupported entry: ${relativePath}`,
      );
    }
  }
  await chmod(destinationDirectory, 0o500);
}

function effectiveVirtualEnvironmentConfiguration(bundle, executableName, pythonVersion) {
  const version = /^Python\s+([^\s]+)/u.exec(pythonVersion)?.[1];
  if (version === undefined) {
    throw new BenchmarkIntegrityError(
      'python_virtual_environment_invalid',
      'Cannot derive an effective virtual environment version from the Python pin.',
    );
  }
  const executablePath = path.join(bundle, 'bin', executableName);
  return [
    `home = ${path.join(bundle, 'bin')}`,
    'include-system-site-packages = false',
    `version = ${version}`,
    `executable = ${executablePath}`,
    `command = ${executablePath} -m venv ${path.join(bundle, 'venv')}`,
    '',
  ].join('\n');
}

async function verifyPythonSnapshotLauncher(
  bundle,
  sourceLauncherPath,
  bundledExecutableRealpath,
) {
  const snapshotLauncherPath = path.join(
    bundle,
    'venv',
    'bin',
    path.basename(sourceLauncherPath),
  );
  let snapshotLauncherRealpath;
  let snapshotLauncherStats;
  let snapshotLauncherTarget;
  try {
    [snapshotLauncherRealpath, snapshotLauncherStats, snapshotLauncherTarget] =
      await Promise.all([
        realpath(snapshotLauncherPath),
        lstat(snapshotLauncherPath),
        readlink(snapshotLauncherPath),
      ]);
  } catch (error) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_mismatch',
      'The effective Python virtual-environment launcher is missing.',
      { cause: error?.message ?? String(error) },
    );
  }
  const resolvedLauncherTarget = path.resolve(
    path.dirname(snapshotLauncherPath),
    snapshotLauncherTarget,
  );
  if (
    !snapshotLauncherStats.isSymbolicLink() ||
    !isInside(bundle, resolvedLauncherTarget) ||
    snapshotLauncherRealpath !== bundledExecutableRealpath
  ) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_mismatch',
      'The effective Python virtual-environment launcher does not resolve internally to the bundle executable.',
    );
  }
  return snapshotLauncherPath;
}

async function verifyPythonBundle(
  bundle,
  executable,
  sourceLibrary,
  sourceVirtualEnvironment,
  pythonVersion,
  sourceExecutableRealpath,
) {
  let verifiedExecutable;
  try {
    verifiedExecutable = await verifyPinnedPath(executable, {
      executable: true,
      label: 'adapter Python bundle executable',
    });
    const snapshotLibrary = await pinPythonRuntimeDirectory(path.join(bundle, 'lib'), {
      pythonExecutable: executable.realpath,
    });
    if (snapshotLibrary.sha256 !== sourceLibrary.sha256) {
      throw new Error('Python runtime library snapshot changed.');
    }
    let virtualEnvironment = null;
    if (sourceVirtualEnvironment !== null) {
      const snapshotRoot = path.join(bundle, 'venv');
      const configurationBytes = effectiveVirtualEnvironmentConfiguration(
        bundle,
        path.basename(executable.realpath),
        pythonVersion,
      );
      const configuration = await verifyPinnedPath(
        {
          path: path.join(snapshotRoot, 'pyvenv.cfg'),
          realpath: path.join(snapshotRoot, 'pyvenv.cfg'),
          sha256: sha256Value(configurationBytes),
        },
        { label: 'Python virtual environment configuration snapshot' },
      );
      const sitePackages =
        sourceVirtualEnvironment.sitePackages === null
          ? null
          : await pinPythonRuntimeDirectory(
              path.join(
                snapshotRoot,
                'lib',
                path.basename(path.dirname(sourceVirtualEnvironment.sitePackages.realpath)),
                'site-packages',
              ),
              { pythonExecutable: executable.realpath },
            );
      if (
        sitePackages !== null &&
        sitePackages.sha256 !== sourceVirtualEnvironment.sitePackages.sha256
      ) {
        throw new Error('Python virtual environment package snapshot changed.');
      }
      virtualEnvironment = {
        ...sourceVirtualEnvironment,
        snapshotRootRealpath: snapshotRoot,
        snapshotConfiguration: configuration,
        snapshotSitePackages: sitePackages,
      };
      await verifyPythonSnapshotLauncher(
        bundle,
        sourceVirtualEnvironment.launcherPath,
        executable.realpath,
      );
    }
    const currentSourceLibrary = await pinPythonRuntimeDirectory(sourceLibrary.realpath, {
      pythonExecutable: sourceExecutableRealpath,
    });
    if (serializeManifest(currentSourceLibrary) !== serializeManifest(sourceLibrary)) {
      throw new Error('Python runtime library source changed.');
    }
    if (sourceVirtualEnvironment !== null) {
      const currentRoot = await realpath(
        path.dirname(path.dirname(sourceVirtualEnvironment.launcherPath)),
      );
      const currentRootStats = await lstat(currentRoot);
      if (
        currentRoot !== sourceVirtualEnvironment.rootRealpath ||
        String(currentRootStats.dev) !== sourceVirtualEnvironment.device ||
        String(currentRootStats.ino) !== sourceVirtualEnvironment.inode ||
        (await realpath(sourceVirtualEnvironment.launcherPath)) !== sourceExecutableRealpath
      ) {
        throw new Error('Python virtual environment source identity changed.');
      }
      await verifyPinnedPath(sourceVirtualEnvironment.configuration, {
        label: 'Python virtual environment configuration source',
      });
    }
    if (sourceVirtualEnvironment !== null && sourceVirtualEnvironment.sitePackages !== null) {
      const currentSitePackages = await pinPythonRuntimeDirectory(
        sourceVirtualEnvironment.sitePackages.realpath,
        { pythonExecutable: sourceExecutableRealpath },
      );
      if (
        serializeManifest(currentSitePackages) !==
        serializeManifest(sourceVirtualEnvironment.sitePackages)
      ) {
        throw new Error('Python virtual environment package source changed.');
      }
    }
    return { verifiedExecutable, snapshotLibrary, virtualEnvironment };
  } catch (error) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_mismatch',
      'Python execution bundle does not match its verified runtime.',
      { cause: error?.message ?? String(error), bundle },
    );
  }
}

async function preparePythonExecutionBundle(executable, pythonVersion, runDirectoryIdentity) {
  const runtimeRoot = path.dirname(path.dirname(executable.realpath));
  const libraryPath = path.join(runtimeRoot, 'lib');
  let libraryStats;
  try {
    libraryStats = await lstat(libraryPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (!libraryStats?.isDirectory()) {
    const snapshot = await snapshotPinnedFile(executable, runDirectoryIdentity, {
      executable: true,
      label: 'adapter executable',
    });
    const dynamicLinker = await captureExecutableClosure(snapshot);
    assertRelocatablePythonClosure(dynamicLinker);
    assertExecutableClosureConfined(dynamicLinker, runDirectoryIdentity.realpath);
    return {
      executable: snapshot,
      pythonRuntime: null,
      dynamicLinker,
      environment: {
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONNOUSERSITE: '1',
        PYTHONSAFEPATH: '1',
      },
    };
  }

  const currentRunIdentity = await verifyPrivateDirectory(runDirectoryIdentity.realpath);
  if (serializeManifest(currentRunIdentity) !== serializeManifest(runDirectoryIdentity)) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_identity_changed',
      'The pinned run directory changed before the Python bundle was created.',
    );
  }
  const [sourceLibrary, sourceVirtualEnvironment, executableBytes] = await Promise.all([
    pinPythonRuntimeDirectory(libraryPath, { pythonExecutable: executable.realpath }),
    detectVirtualEnvironment(executable, pythonVersion),
    readPinnedFileBytes(executable, { executable: true, label: 'adapter executable' }),
  ]);
  const bundleIdentity = sha256Value(
    serializeManifest({
      executableSha256: executable.sha256,
      sourceLibrary,
      sourceVirtualEnvironment,
    }),
  ).slice('sha256:'.length);
  const bundle = path.join(runDirectoryIdentity.realpath, `.lofiever-python-${bundleIdentity}`);
  const executableName = path.basename(executable.realpath);
  const bundledExecutablePath = path.join(bundle, 'bin', executableName);
  const bundledExecutable = {
    ...executable,
    path: bundledExecutablePath,
    realpath: bundledExecutablePath,
  };

  try {
    await lstat(bundle);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const temporaryBundle = `${bundle}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
    await mkdir(path.join(temporaryBundle, 'bin'), { recursive: true, mode: 0o700 });
    const handle = await open(path.join(temporaryBundle, 'bin', executableName), 'wx', 0o500);
    try {
      await handle.writeFile(executableBytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await snapshotRuntimeTree(sourceLibrary.realpath, path.join(temporaryBundle, 'lib'));
    if (sourceVirtualEnvironment !== null) {
      const virtualRoot = path.join(temporaryBundle, 'venv');
      const launcherDirectory = path.join(virtualRoot, 'bin');
      await mkdir(launcherDirectory, { recursive: true, mode: 0o700 });
      await readPinnedFileBytes(sourceVirtualEnvironment.configuration, {
        label: 'Python virtual environment configuration',
      });
      const configurationBytes = effectiveVirtualEnvironmentConfiguration(
        bundle,
        executableName,
        pythonVersion,
      );
      const configurationHandle = await open(
        path.join(virtualRoot, 'pyvenv.cfg'),
        'wx',
        0o400,
      );
      try {
        await configurationHandle.writeFile(configurationBytes);
        await configurationHandle.sync();
      } finally {
        await configurationHandle.close();
      }
      const launcherName = path.basename(sourceVirtualEnvironment.launcherPath);
      await symlink(
        path.relative(launcherDirectory, path.join(temporaryBundle, 'bin', executableName)),
        path.join(launcherDirectory, launcherName),
      );
      if (sourceVirtualEnvironment.sitePackages !== null) {
        const versionDirectory = path.basename(
          path.dirname(sourceVirtualEnvironment.sitePackages.realpath),
        );
        await snapshotRuntimeTree(
          sourceVirtualEnvironment.sitePackages.realpath,
          path.join(virtualRoot, 'lib', versionDirectory, 'site-packages'),
        );
      }
      await chmod(launcherDirectory, 0o500);
      await chmod(virtualRoot, 0o500);
    }
    await chmod(path.join(temporaryBundle, 'bin'), 0o500);
    await chmod(temporaryBundle, 0o500);
    try {
      await rename(temporaryBundle, bundle);
      await syncDirectory(runDirectoryIdentity.realpath);
    } catch (publishError) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(publishError?.code)) throw publishError;
    } finally {
      await rm(temporaryBundle, { recursive: true, force: true });
    }
  }
  const verified = await verifyPythonBundle(
    bundle,
    bundledExecutable,
    sourceLibrary,
    sourceVirtualEnvironment,
    pythonVersion,
    executable.realpath,
  );
  const dynamicLinker = await captureExecutableClosure(verified.verifiedExecutable);
  assertRelocatablePythonClosure(dynamicLinker);
  assertExecutableClosureConfined(dynamicLinker, bundle);
  const virtualEnvironment = verified.virtualEnvironment;
  const environment = {
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONSAFEPATH: '1',
    ...(virtualEnvironment === null
      ? {}
      : {
          VIRTUAL_ENV: virtualEnvironment.snapshotRootRealpath,
          __PYVENV_LAUNCHER__: path.join(
            virtualEnvironment.snapshotRootRealpath,
            'bin',
            path.basename(virtualEnvironment.launcherPath),
          ),
        }),
  };
  return {
    executable: { ...executable, ...verified.verifiedExecutable },
    pythonRuntime: {
      sourceLibrary,
      snapshotLibrary: verified.snapshotLibrary,
      virtualEnvironment,
    },
    dynamicLinker,
    environment,
  };
}

function assertSameIntegrityReceipt(actual, expected, code, message) {
  if (serializeManifest(actual) !== serializeManifest(expected)) {
    throw new BenchmarkIntegrityError(code, message);
  }
  return actual;
}

function sourceVirtualEnvironmentReceipt(virtualEnvironment) {
  if (virtualEnvironment === null) return null;
  return {
    rootRealpath: virtualEnvironment.rootRealpath,
    device: virtualEnvironment.device,
    inode: virtualEnvironment.inode,
    launcherPath: virtualEnvironment.launcherPath,
    configuration: virtualEnvironment.configuration,
    sitePackages: virtualEnvironment.sitePackages,
  };
}

function expectedSnapshotPath(runDirectoryIdentity, label, sourcePin) {
  const safeLabel = label.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase();
  return path.join(
    runDirectoryIdentity.realpath,
    `.lofiever-tcb-${safeLabel}-${sourcePin.sha256.slice('sha256:'.length)}`,
  );
}

async function revalidateSnapshotPin(
  sourcePin,
  expectedPin,
  runDirectoryIdentity,
  { executable = false, label },
) {
  const expectedPath = expectedSnapshotPath(runDirectoryIdentity, label, sourcePin);
  if (
    expectedPin?.path !== expectedPath ||
    expectedPin?.realpath !== expectedPath ||
    expectedPin?.sha256 !== sourcePin.sha256
  ) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_mismatch',
      `${label} receipt is not the deterministic snapshot of the trusted source pin.`,
    );
  }
  try {
    return await verifyPinnedPath(expectedPin, {
      executable,
      label: `${label} snapshot`,
    });
  } catch (error) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_mismatch',
      `${label} snapshot is missing or changed.`,
      { cause: error?.message ?? String(error) },
    );
  }
}

async function revalidatePythonExecutionBundle(
  sourceExecutable,
  pythonVersion,
  runDirectoryIdentity,
  expectedAdapter,
) {
  if (
    expectedAdapter?.executable?.sha256 !== sourceExecutable.sha256 ||
    !isInside(runDirectoryIdentity.realpath, expectedAdapter?.executable?.realpath ?? '')
  ) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_mismatch',
      'The effective adapter executable is not a confined snapshot of trusted Python bytes.',
    );
  }

  const runtimeRoot = path.dirname(path.dirname(sourceExecutable.realpath));
  const libraryPath = path.join(runtimeRoot, 'lib');
  let libraryStats;
  try {
    libraryStats = await lstat(libraryPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  let sourceLibrary = null;
  let sourceVirtualEnvironment = null;
  let expectedBundle;
  if (libraryStats?.isDirectory()) {
    sourceLibrary = await pinPythonRuntimeDirectory(libraryPath, {
      pythonExecutable: sourceExecutable.realpath,
    });
    sourceVirtualEnvironment = await detectVirtualEnvironment(sourceExecutable, pythonVersion);
    const bundleIdentity = sha256Value(
      serializeManifest({
        executableSha256: sourceExecutable.sha256,
        sourceLibrary,
        sourceVirtualEnvironment,
      }),
    ).slice('sha256:'.length);
    expectedBundle = path.join(
      runDirectoryIdentity.realpath,
      `.lofiever-python-${bundleIdentity}`,
    );
  } else {
    expectedBundle = runDirectoryIdentity.realpath;
  }

  const actualBundle = path.dirname(path.dirname(expectedAdapter.executable.realpath));
  const expectedExecutablePath = libraryStats?.isDirectory()
    ? path.join(expectedBundle, 'bin', path.basename(sourceExecutable.realpath))
    : expectedSnapshotPath(runDirectoryIdentity, 'adapter executable', sourceExecutable);
  if (
    (libraryStats?.isDirectory() && actualBundle !== expectedBundle) ||
    expectedAdapter.executable.path !== expectedExecutablePath ||
    expectedAdapter.executable.realpath !== expectedExecutablePath
  ) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_mismatch',
      'The effective adapter executable path does not match the trusted snapshot identity.',
    );
  }

  const executable = await verifyPinnedPath(expectedAdapter.executable, {
    executable: true,
    label: 'adapter Python bundle executable',
  });
  const dynamicLinker = await revalidateExecutableClosure({
    ...executable,
    dynamicLinker: expectedAdapter.dynamicLinker,
  });
  if (
    dynamicLinker.root.path !== executable.path ||
    dynamicLinker.root.realpath !== executable.realpath ||
    dynamicLinker.root.sha256 !== executable.sha256
  ) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_mismatch',
      'The adapter dynamic-linker closure root is not the effective bundle executable.',
    );
  }
  assertRelocatablePythonClosure(dynamicLinker);
  assertExecutableClosureConfined(dynamicLinker, expectedBundle);

  let pythonRuntime = null;
  if (libraryStats?.isDirectory()) {
    const expectedRuntime = expectedAdapter.pythonRuntime;
    if (expectedRuntime === null) {
      throw new BenchmarkIntegrityError(
        'tcb_snapshot_mismatch',
        'The trusted Python runtime requires an effective bundle receipt.',
      );
    }
    assertSameIntegrityReceipt(
      sourceLibrary,
      expectedRuntime.sourceLibrary,
      'tcb_snapshot_mismatch',
      'The trusted Python source library changed after snapshot creation.',
    );
    assertSameIntegrityReceipt(
      sourceVirtualEnvironment,
      sourceVirtualEnvironmentReceipt(expectedRuntime.virtualEnvironment),
      'tcb_snapshot_mismatch',
      'The trusted Python virtual environment changed after snapshot creation.',
    );
    const expectedSnapshotLibraryPath = path.join(expectedBundle, 'lib');
    if (
      expectedRuntime.snapshotLibrary.path !== expectedSnapshotLibraryPath ||
      expectedRuntime.snapshotLibrary.realpath !== expectedSnapshotLibraryPath
    ) {
      throw new BenchmarkIntegrityError(
        'tcb_snapshot_mismatch',
        'The effective Python library receipt is not anchored inside its bundle.',
      );
    }
    const snapshotLibrary = await pinPythonRuntimeDirectory(
      expectedRuntime.snapshotLibrary.path,
      { pythonExecutable: sourceExecutable.realpath },
    );
    assertSameIntegrityReceipt(
      snapshotLibrary,
      expectedRuntime.snapshotLibrary,
      'tcb_snapshot_mismatch',
      'The effective Python library snapshot changed.',
    );
    if (snapshotLibrary.sha256 !== sourceLibrary.sha256) {
      throw new BenchmarkIntegrityError(
        'tcb_snapshot_mismatch',
        'The effective Python library snapshot differs from its trusted source.',
      );
    }

    let virtualEnvironment = null;
    if (sourceVirtualEnvironment !== null) {
      const expectedVirtualEnvironment = expectedRuntime.virtualEnvironment;
      if (
        expectedVirtualEnvironment === null ||
        expectedVirtualEnvironment.snapshotRootRealpath !== path.join(expectedBundle, 'venv')
      ) {
        throw new BenchmarkIntegrityError(
          'tcb_snapshot_mismatch',
          'The effective Python virtual environment is not confined to its bundle.',
        );
      }
      const expectedSnapshotConfigurationPath = path.join(
        expectedBundle,
        'venv',
        'pyvenv.cfg',
      );
      const expectedSnapshotConfigurationSha256 = sha256Value(
        effectiveVirtualEnvironmentConfiguration(
          expectedBundle,
          path.basename(sourceExecutable.realpath),
          pythonVersion,
        ),
      );
      if (
        expectedVirtualEnvironment.snapshotConfiguration.path !==
          expectedSnapshotConfigurationPath ||
        expectedVirtualEnvironment.snapshotConfiguration.realpath !==
          expectedSnapshotConfigurationPath ||
        expectedVirtualEnvironment.snapshotConfiguration.sha256 !==
          expectedSnapshotConfigurationSha256
      ) {
        throw new BenchmarkIntegrityError(
          'tcb_snapshot_mismatch',
          'The effective Python configuration receipt is not anchored inside its bundle.',
        );
      }
      const snapshotConfiguration = await verifyPinnedPath(
        expectedVirtualEnvironment.snapshotConfiguration,
        { label: 'Python virtual environment configuration snapshot' },
      );
      let snapshotSitePackages = null;
      if (sourceVirtualEnvironment.sitePackages !== null) {
        if (expectedVirtualEnvironment.snapshotSitePackages === null) {
          throw new BenchmarkIntegrityError(
            'tcb_snapshot_mismatch',
            'The effective Python environment is missing its package snapshot.',
          );
        }
        const expectedSitePackagesPath = path.join(
          expectedBundle,
          'venv',
          'lib',
          path.basename(path.dirname(sourceVirtualEnvironment.sitePackages.realpath)),
          'site-packages',
        );
        if (
          expectedVirtualEnvironment.snapshotSitePackages.path !== expectedSitePackagesPath ||
          expectedVirtualEnvironment.snapshotSitePackages.realpath !== expectedSitePackagesPath
        ) {
          throw new BenchmarkIntegrityError(
            'tcb_snapshot_mismatch',
            'The effective Python package receipt is not anchored inside its bundle.',
          );
        }
        snapshotSitePackages = await pinPythonRuntimeDirectory(
          expectedVirtualEnvironment.snapshotSitePackages.path,
          { pythonExecutable: sourceExecutable.realpath },
        );
        assertSameIntegrityReceipt(
          snapshotSitePackages,
          expectedVirtualEnvironment.snapshotSitePackages,
          'tcb_snapshot_mismatch',
          'The effective Python package snapshot changed.',
        );
        if (snapshotSitePackages.sha256 !== sourceVirtualEnvironment.sitePackages.sha256) {
          throw new BenchmarkIntegrityError(
            'tcb_snapshot_mismatch',
            'The effective Python package snapshot differs from its trusted source.',
          );
        }
      } else if (expectedVirtualEnvironment.snapshotSitePackages !== null) {
        throw new BenchmarkIntegrityError(
          'tcb_snapshot_mismatch',
          'The effective Python receipt contains an unexpected package snapshot.',
        );
      }
      await verifyPythonSnapshotLauncher(
        expectedBundle,
        sourceVirtualEnvironment.launcherPath,
        executable.realpath,
      );
      virtualEnvironment = {
        ...sourceVirtualEnvironment,
        snapshotRootRealpath: expectedVirtualEnvironment.snapshotRootRealpath,
        snapshotConfiguration,
        snapshotSitePackages,
      };
      assertSameIntegrityReceipt(
        virtualEnvironment,
        expectedVirtualEnvironment,
        'tcb_snapshot_mismatch',
        'The effective Python virtual environment receipt changed.',
      );
    } else if (expectedRuntime.virtualEnvironment !== null) {
      throw new BenchmarkIntegrityError(
        'tcb_snapshot_mismatch',
        'The effective Python receipt contains an unexpected virtual environment.',
      );
    }
    pythonRuntime = { sourceLibrary, snapshotLibrary, virtualEnvironment };
    assertSameIntegrityReceipt(
      pythonRuntime,
      expectedRuntime,
      'tcb_snapshot_mismatch',
      'The effective Python runtime receipt changed.',
    );
  } else if (expectedAdapter.pythonRuntime !== null) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_mismatch',
      'The effective adapter receipt contains an unexpected Python runtime tree.',
    );
  }

  return {
    executable,
    pythonRuntime,
    dynamicLinker,
    environment: {
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONSAFEPATH: '1',
      ...(pythonRuntime?.virtualEnvironment === null || pythonRuntime === null
        ? {}
        : {
            VIRTUAL_ENV: pythonRuntime.virtualEnvironment.snapshotRootRealpath,
            __PYVENV_LAUNCHER__: path.join(
              pythonRuntime.virtualEnvironment.snapshotRootRealpath,
              'bin',
              path.basename(pythonRuntime.virtualEnvironment.launcherPath),
            ),
          }),
    },
  };
}

async function listTree(rootPath, relativeDirectory = '') {
  const directoryPath = path.join(rootPath, relativeDirectory);
  const directory = await opendir(directoryPath);
  const entries = [];
  for await (const entry of directory) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  const result = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(rootPath, relativePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new BenchmarkIntegrityError(
        'symlink_forbidden',
        `Pinned directory trees cannot contain symlinks: ${relativePath}`,
      );
    }
    if (stats.isDirectory()) {
      result.push({ path: relativePath.split(path.sep).join('/'), type: 'directory' });
      result.push(...(await listTree(rootPath, relativePath)));
    } else if (stats.isFile()) {
      result.push({
        path: relativePath.split(path.sep).join('/'),
        type: 'file',
        sha256: await digestFile(absolutePath),
      });
    } else {
      throw new BenchmarkIntegrityError(
        'unsupported_pinned_path',
        `Pinned directory contains a non-regular entry: ${relativePath}`,
      );
    }
  }
  return result;
}

export async function digestPath(inputPath) {
  const resolvedPath = resolvePinnedPath(inputPath);
  const stats = await lstat(resolvedPath);
  if (stats.isSymbolicLink()) {
    throw new BenchmarkIntegrityError(
      'symlink_forbidden',
      `Pinned path must not be a symlink: ${inputPath}`,
    );
  }
  if (stats.isFile()) return digestFile(resolvedPath);
  if (stats.isDirectory()) {
    const tree = await listTree(resolvedPath);
    return receipt(createHash('sha256').update(JSON.stringify(tree)).digest('hex'));
  }
  throw new BenchmarkIntegrityError(
    'unsupported_pinned_path',
    `Pinned path must be a regular file or directory: ${inputPath}`,
  );
}

export async function verifyPinnedPath(pin, { executable = false, label = 'path' } = {}) {
  const requestedPath = resolvePinnedPath(pin.path);
  const canonicalPath = await realpath(requestedPath);
  if (canonicalPath !== pin.realpath) {
    throw new BenchmarkIntegrityError('pin_mismatch', `${label} realpath does not match its pin.`, {
      expected: pin.realpath,
      actual: canonicalPath,
    });
  }
  const actualSha256 = await digestPath(canonicalPath);
  if (actualSha256 !== pin.sha256) {
    throw new BenchmarkIntegrityError('pin_mismatch', `${label} digest does not match its pin.`, {
      expected: pin.sha256,
      actual: actualSha256,
    });
  }
  if (executable) {
    const stats = await lstat(canonicalPath);
    if (!stats.isFile() || (stats.mode & 0o111) === 0) {
      throw new BenchmarkIntegrityError(
        'pinned_executable_not_executable',
        `${label} must be a regular executable file.`,
      );
    }
  }
  return { ...pin, path: pin.path, realpath: canonicalPath, sha256: actualSha256 };
}

async function verifyGitRepository(
  repository,
  {
    commitField,
    invalidCode,
    mismatchCode,
    dirtyCode,
    label,
    gitExecutable = 'git',
    environment = process.env,
  },
) {
  const repositoryPath = await realpath(resolvePinnedPath(repository.repositoryPath));
  const gitEnvironment = {
    HOME: environment.HOME ?? os.homedir(),
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/usr/bin:/bin',
    TZ: 'UTC',
    ...(typeof environment.TMPDIR === 'string' ? { TMPDIR: environment.TMPDIR } : {}),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
  };
  const gitArguments = ['-c', 'core.fsmonitor=false', '-C', repositoryPath];
  let head;
  let status;
  try {
    ({ stdout: head } = await execFileAsync(
      gitExecutable,
      [...gitArguments, 'rev-parse', '--verify', 'HEAD'],
      {
        encoding: 'utf8',
        env: gitEnvironment,
        maxBuffer: 1024 * 1024,
        shell: false,
        timeout: 10_000,
      },
    ));
    ({ stdout: status } = await execFileAsync(
      gitExecutable,
      [
        ...gitArguments,
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ],
      {
        encoding: 'utf8',
        env: gitEnvironment,
        maxBuffer: 1024 * 1024,
        shell: false,
        timeout: 10_000,
      },
    ));
  } catch (error) {
    throw new BenchmarkIntegrityError(
      invalidCode,
      `Could not verify the ${label} repository: ${error?.message ?? String(error)}`,
    );
  }
  const repoCommit = head.trim();
  if (repoCommit !== repository[commitField]) {
    throw new BenchmarkIntegrityError(
      mismatchCode,
      `${label} repository HEAD does not match the configured commit.`,
      { expected: repository[commitField], actual: repoCommit },
    );
  }
  if (status.length > 0) {
    throw new BenchmarkIntegrityError(
      dirtyCode,
      `${label} repository contains tracked or untracked changes.`,
    );
  }
  return {
    repositoryPath,
    repoCommit,
    clean: true,
  };
}

export async function verifyEngineRepository(engine, options = {}) {
  return verifyGitRepository(engine, {
    commitField: 'repoCommit',
    invalidCode: 'engine_repository_invalid',
    mismatchCode: 'engine_commit_mismatch',
    dirtyCode: 'engine_worktree_dirty',
    label: 'Engine',
    gitExecutable: options.gitExecutable,
    environment: options.environment,
  });
}

export async function verifyHarnessRepository(runtime, options = {}) {
  return verifyGitRepository(
    {
      repositoryPath: runtime.harnessRepositoryPath,
      harnessCommit: runtime.harnessCommit,
    },
    {
      commitField: 'harnessCommit',
      invalidCode: 'harness_repository_invalid',
      mismatchCode: 'harness_commit_mismatch',
      dirtyCode: 'harness_worktree_dirty',
      label: 'Harness',
      gitExecutable: options.gitExecutable,
      environment: options.environment,
    },
  );
}

export async function verifyPrivateDirectory(directoryPath, { label = 'run directory' } = {}) {
  const requestedPath = resolvePinnedPath(directoryPath);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const directoryOnly = constants.O_DIRECTORY ?? 0;
  const handle = await open(requestedPath, constants.O_RDONLY | noFollow | directoryOnly);
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory()) {
      throw new BenchmarkIntegrityError(
        'private_directory_required',
        `${label} must be a directory.`,
      );
    }
    if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
      throw new BenchmarkIntegrityError(
        'private_directory_owner_mismatch',
        `${label} must be owned by the benchmark user.`,
      );
    }
    if ((stats.mode & 0o077) !== 0) {
      throw new BenchmarkIntegrityError(
        'private_directory_permissions',
        `${label} must not grant group or world permissions.`,
      );
    }
    const canonicalPath = await realpath(requestedPath);
    const pathStats = await lstat(canonicalPath);
    if (pathStats.dev !== stats.dev || pathStats.ino !== stats.ino) {
      throw new BenchmarkIntegrityError(
        'private_directory_changed',
        `${label} changed while it was being pinned.`,
      );
    }
    const parentPath = path.dirname(canonicalPath);
    const parentHandle = await open(
      parentPath,
      constants.O_RDONLY | noFollow | directoryOnly,
    );
    try {
      const parentStats = await parentHandle.stat();
      if (!parentStats.isDirectory()) {
        throw new BenchmarkIntegrityError(
          'private_directory_parent_required',
          `${label} parent must be a directory.`,
        );
      }
      if (
        typeof process.getuid === 'function' &&
        parentStats.uid !== process.getuid()
      ) {
        throw new BenchmarkIntegrityError(
          'private_directory_parent_owner_mismatch',
          `${label} parent must be owned by the benchmark user.`,
        );
      }
      if ((parentStats.mode & 0o077) !== 0) {
        throw new BenchmarkIntegrityError(
          'private_directory_parent_permissions',
          `${label} parent must not grant group or world permissions.`,
        );
      }
      const parentRealpath = await realpath(parentPath);
      const parentPathStats = await lstat(parentRealpath);
      if (
        parentPathStats.dev !== parentStats.dev ||
        parentPathStats.ino !== parentStats.ino
      ) {
        throw new BenchmarkIntegrityError(
          'private_directory_parent_changed',
          `${label} parent changed while it was being pinned.`,
        );
      }
      return {
        realpath: canonicalPath,
        device: String(stats.dev),
        inode: String(stats.ino),
        parent: {
          realpath: parentRealpath,
          device: String(parentStats.dev),
          inode: String(parentStats.ino),
        },
      };
    } finally {
      await parentHandle.close();
    }
  } finally {
    await handle.close();
  }
}

async function verifyTool(name, pin, environment) {
  const verified = await verifyPinnedPath(pin, {
    executable: true,
    label: `${name} executable`,
  });
  const args = ['ffmpeg', 'ffprobe'].includes(name) ? ['-version'] : ['--version'];
  let stdout;
  let stderr;
  try {
    ({ stdout, stderr } = await execFileAsync(verified.realpath, args, {
      encoding: 'utf8',
      env: environment,
      maxBuffer: 64 * 1024,
      timeout: 10_000,
    }));
  } catch (error) {
    throw new BenchmarkIntegrityError(
      'toolchain_probe_failed',
      `Could not query the pinned ${name} executable: ${error?.message ?? String(error)}`,
    );
  }
  const actualVersion = `${stdout ?? ''}\n${stderr ?? ''}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (actualVersion !== pin.version) {
    throw new BenchmarkIntegrityError(
      'toolchain_version_mismatch',
      `${name} version does not match its pin.`,
      { expected: pin.version, actual: actualVersion ?? null },
    );
  }
  return { ...verified, version: actualVersion };
}

async function verifyNativeTool(name, pin, environment, { code, label }) {
  const preflightPin = await verifyPinnedPath(pin, {
    executable: true,
    label: `${name} executable`,
  });
  const dynamicLinker = await captureExecutableClosure(preflightPin);
  assertMachOExecutableClosure(dynamicLinker, { code, label });
  const tool = await verifyTool(name, pin, environment);
  return { tool, dynamicLinker };
}

async function verifyUvManagedPython(uv, python, pythonVersion, environment) {
  if (process.platform !== 'darwin') return;
  const closure = await revalidateExecutableClosure(uv);
  assertMachOExecutableClosure(closure, {
    code: 'uv_not_macho',
    label: 'uv',
  });
  const version = `${pythonVersion[1]}.${pythonVersion[2]}.${pythonVersion[3]}`;
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      uv.realpath,
      [
        'python',
        'find',
        '--managed-python',
        '--no-python-downloads',
        '--no-project',
        version,
      ],
      {
        encoding: 'utf8',
        env: environment,
        maxBuffer: 64 * 1024,
        timeout: 10_000,
      },
    ));
  } catch (error) {
    throw new BenchmarkIntegrityError(
      'python_runtime_not_uv_managed',
      'Could not resolve the pinned interpreter through pinned uv.',
      { cause: error?.message ?? String(error) },
    );
  }
  let managedPython;
  try {
    managedPython = await realpath(stdout.trim());
  } catch (error) {
    throw new BenchmarkIntegrityError(
      'python_runtime_not_uv_managed',
      'Pinned uv did not return a valid managed Python path.',
      { cause: error?.message ?? String(error) },
    );
  }
  if (managedPython !== python.realpath) {
    throw new BenchmarkIntegrityError(
      'python_runtime_not_uv_managed',
      'The pinned Python executable is not the pinned uv-managed runtime.',
      { expected: managedPython, actual: python.realpath },
    );
  }
}

function requireExecutionPins(config) {
  const missing = [];
  const required = [
    ['engine.repositoryPath', config.identity?.engine?.repositoryPath],
    ['runtime.harnessRepositoryPath', config.identity?.runtime?.harnessRepositoryPath],
    ['runtime.runDirectory', config.identity?.runtime?.runDirectory],
    ['model.weights', config.identity?.model?.weights],
    ['model.lm.weights', config.identity?.model?.lm?.weights],
    ['adapter.workingDirectory', config.adapter?.workingDirectory],
    ['adapter.executable', config.adapter?.executable],
    ['adapter.script', config.adapter?.script],
    ['toolchain.git', config.identity?.toolchain?.git],
    ['toolchain.node', config.identity?.toolchain?.node],
    ['toolchain.python', config.identity?.toolchain?.python],
    ['toolchain.uv', config.identity?.toolchain?.uv],
    ['toolchain.ffmpeg', config.identity?.toolchain?.ffmpeg],
    ['toolchain.ffprobe', config.identity?.toolchain?.ffprobe],
  ];
  for (const [name, value] of required) {
    if (value === null || value === undefined) missing.push(name);
  }
  if (missing.length > 0) {
    throw new BenchmarkIntegrityError(
      'execution_pins_missing',
      `Execution pins are missing: ${missing.join(', ')}`,
      { missing },
    );
  }
}

export async function verifyExecutionEnvironment(
  config,
  {
    observeHostIdentity: observeHost = observeHostIdentity,
    revalidateExpected = null,
  } = {},
) {
  const observedHost = await observeHost();
  if (
    serializeManifest(config.identity?.host ?? null) !==
    serializeManifest(observedHost)
  ) {
    throw new BenchmarkIntegrityError(
      'host_identity_mismatch',
      'Configured benchmark host identity does not match local observation.',
      { configured: config.identity?.host ?? null, observed: observedHost },
    );
  }
  requireExecutionPins(config);
  if (config.adapter.kind !== 'persistent-jsonl-v1') {
    throw new BenchmarkIntegrityError(
      'adapter_not_allowlisted',
      `Unsupported benchmark adapter: ${String(config.adapter.kind)}`,
    );
  }

  const environment = sanitizedEnvironment();
  const git = await verifyTool('git', config.identity.toolchain.git, environment);
  const [
    engine,
    harness,
    runDirectoryIdentity,
    modelWeights,
    lmWeights,
    node,
    pythonVerification,
    uvVerification,
    ffmpeg,
    ffprobeVerification,
    executable,
    script,
  ] =
    await Promise.all([
      verifyEngineRepository(config.identity.engine, {
        gitExecutable: git.realpath,
        environment,
      }),
      verifyHarnessRepository(config.identity.runtime, {
        gitExecutable: git.realpath,
        environment,
      }),
      verifyPrivateDirectory(config.identity.runtime.runDirectory),
      verifyPinnedPath(config.identity.model.weights, { label: 'model weights' }),
      verifyPinnedPath(config.identity.model.lm.weights, { label: 'LM weights' }),
      verifyTool('node', config.identity.toolchain.node, environment),
      verifyNativeTool('python', config.identity.toolchain.python, environment, {
        code: 'python_runtime_not_macho',
        label: 'Python runtime',
      }),
      verifyNativeTool('uv', config.identity.toolchain.uv, environment, {
        code: 'uv_not_macho',
        label: 'uv',
      }),
      verifyTool('ffmpeg', config.identity.toolchain.ffmpeg, environment),
      verifyNativeTool('ffprobe', config.identity.toolchain.ffprobe, environment, {
        code: 'ffprobe_not_macho',
        label: 'ffprobe',
      }),
      verifyPinnedPath(config.adapter.executable, {
        executable: true,
        label: 'adapter executable',
      }),
      verifyPinnedPath(config.adapter.script, { label: 'adapter script' }),
    ]);
  const python = pythonVerification.tool;
  const uv = {
    ...uvVerification.tool,
    dynamicLinker: uvVerification.dynamicLinker,
  };
  const ffprobe = ffprobeVerification.tool;
  assertRelocatablePythonClosure(pythonVerification.dynamicLinker);
  const executableName = path.basename(executable.realpath);
  const runtimeNodeRealpath = await realpath(process.execPath);
  if (node.realpath !== runtimeNodeRealpath || node.version !== process.version) {
    throw new BenchmarkIntegrityError(
      'harness_node_mismatch',
      'The pinned Node executable/version must be the runtime executing the harness.',
      {
        expectedRealpath: runtimeNodeRealpath,
        actualRealpath: node.realpath,
        expectedVersion: process.version,
        actualVersion: node.version,
      },
    );
  }
  if (!/^python(?:3(?:\.\d+)*)?$/u.test(executableName)) {
    throw new BenchmarkIntegrityError(
      'adapter_executable_not_allowlisted',
      `The persistent adapter must run directly under pinned Python, not ${executableName}.`,
    );
  }
  if (
    executable.realpath !== python.realpath ||
    executable.sha256 !== python.sha256
  ) {
    throw new BenchmarkIntegrityError(
      'adapter_python_mismatch',
      'The adapter executable must be the pinned Python toolchain executable.',
    );
  }
  const pythonVersion = /^Python\s+(\d+)\.(\d+)\.(\d+)(?:\s|$)/u.exec(python.version);
  if (
    pythonVersion === null ||
    Number(pythonVersion[1]) !== 3 ||
    Number(pythonVersion[2]) < 11 ||
    Number(pythonVersion[2]) >= 13
  ) {
    throw new BenchmarkIntegrityError(
      'unsupported_python_version',
      'The persistent adapter requires Python >=3.11 and <3.13.',
      { actual: python.version },
    );
  }
  await verifyUvManagedPython(uv, python, pythonVersion, environment);
  const workingDirectory = await realpath(resolvePinnedPath(config.adapter.workingDirectory));
  if (workingDirectory !== engine.repositoryPath) {
    throw new BenchmarkIntegrityError(
      'adapter_working_directory_mismatch',
      'The persistent adapter working directory must be the verified engine repository.',
      { expected: engine.repositoryPath, actual: workingDirectory },
    );
  }
  let pythonExecution;
  let scriptSnapshot;
  let ffprobeSnapshot;
  let ffprobeDynamicLinker;
  if (revalidateExpected === null) {
    [pythonExecution, scriptSnapshot, ffprobeSnapshot] = await Promise.all([
      preparePythonExecutionBundle(executable, python.version, runDirectoryIdentity),
      snapshotPinnedFile(script, runDirectoryIdentity, {
        label: 'adapter script',
      }),
      snapshotPinnedFile(ffprobe, runDirectoryIdentity, {
        executable: true,
        label: 'ffprobe executable',
      }),
    ]);
    ffprobeDynamicLinker = await captureExecutableClosure(ffprobeSnapshot);
    assertMachOExecutableClosure(ffprobeDynamicLinker, {
      code: 'ffprobe_not_macho',
      label: 'ffprobe',
    });
  } else {
    const expectedAdapter = revalidateExpected.adapter;
    const expectedFfprobe = revalidateExpected.identity?.toolchain?.ffprobe;
    [pythonExecution, scriptSnapshot, ffprobeSnapshot] = await Promise.all([
      revalidatePythonExecutionBundle(
        executable,
        python.version,
        runDirectoryIdentity,
        expectedAdapter,
      ).catch((error) => {
        if (error?.code === 'tcb_snapshot_mismatch') throw error;
        throw new BenchmarkIntegrityError(
          'tcb_snapshot_mismatch',
          'The effective Python execution bundle is missing or changed.',
          { cause: error?.message ?? String(error) },
        );
      }),
      revalidateSnapshotPin(
        script,
        expectedAdapter?.script,
        runDirectoryIdentity,
        { label: 'adapter script' },
      ),
      revalidateSnapshotPin(
        ffprobe,
        expectedFfprobe,
        runDirectoryIdentity,
        { executable: true, label: 'ffprobe executable' },
      ),
    ]);
    ffprobeDynamicLinker = await revalidateExecutableClosure({
      ...ffprobeSnapshot,
      dynamicLinker: expectedFfprobe.dynamicLinker,
    });
    assertMachOExecutableClosure(ffprobeDynamicLinker, {
      code: 'ffprobe_not_macho',
      label: 'ffprobe',
    });
  }
  Object.assign(environment, pythonExecution.environment);
  const finalRunDirectoryIdentity = await verifyPrivateDirectory(
    config.identity.runtime.runDirectory,
  );
  if (
    serializeManifest(finalRunDirectoryIdentity) !==
    serializeManifest(runDirectoryIdentity)
  ) {
    throw new BenchmarkIntegrityError(
      'tcb_snapshot_identity_changed',
      'The pinned run directory changed while execution snapshots were being verified.',
    );
  }
  const environmentReceipt = Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({ name, valueSha256: sha256Value(value) }));
  const environmentSha256 = sha256Value(serializeManifest(environmentReceipt));

  return {
    ...config,
    identity: {
      ...config.identity,
      host: observedHost,
      engine: { ...config.identity.engine, ...engine },
      model: {
        ...config.identity.model,
        weights: modelWeights,
        lm: { ...config.identity.model.lm, weights: lmWeights },
      },
      runtime: {
        ...config.identity.runtime,
        harnessRepositoryPath: harness.repositoryPath,
        harnessClean: harness.clean,
        runDirectory: runDirectoryIdentity.realpath,
        runDirectoryIdentity,
      },
      toolchain: {
        git,
        node,
        python,
        uv,
        ffmpeg,
        ffprobe: { ...ffprobeSnapshot, dynamicLinker: ffprobeDynamicLinker },
      },
      environment: environmentReceipt,
      environmentSha256,
    },
    adapter: {
      ...config.adapter,
      workingDirectory,
      executable: pythonExecution.executable,
      script: scriptSnapshot,
      pythonRuntime: pythonExecution.pythonRuntime,
      dynamicLinker: pythonExecution.dynamicLinker,
    },
    processEnvironment: environment,
    environmentSha256,
  };
}

function executionIdentityFromManifest(manifest) {
  return {
    benchmarkId: manifest.benchmarkId,
    host: manifest.host,
    engine: manifest.engine,
    model: manifest.model,
    runtime: manifest.runtime,
    toolchain: manifest.toolchain,
    environment: manifest.environment,
    environmentSha256: manifest.environmentSha256,
  };
}

export async function revalidatePreparedExecutionEnvironment(
  config,
  expectedEffective,
  options = {},
) {
  const verified = await verifyExecutionEnvironment(config, {
    ...options,
    revalidateExpected: expectedEffective,
  });
  const expected = serializeManifest({
    identity: expectedEffective.identity,
    adapter: expectedEffective.adapter,
    environmentSha256:
      expectedEffective.environmentSha256 ??
      expectedEffective.identity?.environmentSha256 ??
      null,
  });
  const actual = serializeManifest({
    identity: verified.identity,
    adapter: verified.adapter,
    environmentSha256: verified.environmentSha256,
  });
  if (actual !== expected) {
    throw new BenchmarkIntegrityError(
      'evidence_provenance_mismatch',
      'Current execution provenance does not reproduce the trusted effective pins.',
    );
  }
  return verified;
}

export async function revalidateExecutionEnvironment(
  config,
  manifest,
  options = {},
) {
  if (manifest?.executionMode !== 'execute') {
    throw new BenchmarkIntegrityError(
      'evidence_manifest_not_executable',
      'Only execute manifests carry revalidatable execution provenance.',
    );
  }
  const parsed = spikeManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new BenchmarkIntegrityError(
      'evidence_manifest_invalid',
      'Execution provenance requires a structurally valid canonical manifest.',
      { issues: parsed.error.issues },
    );
  }
  manifest = parsed.data;
  const expectedEffective = {
    identity: executionIdentityFromManifest(manifest),
    adapter: manifest.adapter,
    environmentSha256: manifest.environmentSha256,
  };
  return revalidatePreparedExecutionEnvironment(config, expectedEffective, options);
}
