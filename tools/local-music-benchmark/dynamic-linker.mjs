import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MACHO_MAGICS = new Set([
  'cafebabe',
  'cafebabf',
  'bebafeca',
  'bfbafeca',
  'cffaedfe',
  'cefaedfe',
  'feedface',
  'feedfacf',
]);
const LOAD_COMMANDS = new Set([
  'LC_LOAD_DYLIB',
  'LC_LOAD_WEAK_DYLIB',
  'LC_REEXPORT_DYLIB',
  'LC_LOAD_UPWARD_DYLIB',
  'LC_LAZY_LOAD_DYLIB',
  'LC_LOAD_DYLINKER',
]);
const MAX_IMAGES = 256;
const MAX_EDGES = 2048;

function machoArchitecture() {
  return process.arch === 'x64' ? 'x86_64' : process.arch;
}

function machoArchitectureCandidates(architecture = machoArchitecture()) {
  if (architecture === 'arm64') return ['arm64', 'arm64e'];
  if (architecture === 'x86_64') return ['x86_64', 'x86_64h'];
  return [];
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function serializeClosure(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256Receipt(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export class ExecutableClosureError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExecutableClosureError';
    this.code = code;
    this.details = details;
  }
}

function isInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSystemInstallName(installName) {
  const normalized = path.normalize(installName);
  return (
    path.isAbsolute(installName) &&
    (normalized.startsWith('/usr/lib/') ||
      normalized.startsWith('/System/Library/'))
  );
}

async function stableImagePin(inputPath, receiptPath = inputPath) {
  const canonicalPath = await realpath(inputPath);
  const handle = await open(canonicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new ExecutableClosureError(
        'dynamic_linker_image_invalid',
        `Dynamic-linker image is not a regular file: ${inputPath}`,
      );
    }
    const magic = Buffer.alloc(4);
    await handle.read(magic, 0, magic.length, 0);
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      hash.update(chunk);
    }
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new ExecutableClosureError(
        'dynamic_linker_image_changed',
        `Dynamic-linker image changed while it was being hashed: ${inputPath}`,
      );
    }
    return {
      path: receiptPath,
      realpath: canonicalPath,
      sha256: `sha256:${hash.digest('hex')}`,
      device: String(before.dev),
      inode: String(before.ino),
      macho: MACHO_MAGICS.has(magic.toString('hex')),
    };
  } finally {
    await handle.close();
  }
}

async function platformIdentity() {
  if (process.platform !== 'darwin') {
    return { platform: process.platform, architecture: machoArchitecture(), osBuild: null };
  }
  const { stdout } = await execFileAsync('/usr/bin/sw_vers', ['-buildVersion'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024,
    timeout: 5_000,
  });
  const osBuild = stdout.trim();
  if (osBuild.length === 0) {
    throw new ExecutableClosureError(
      'dynamic_linker_platform_unavailable',
      'Could not determine the macOS build for the dynamic-linker receipt.',
    );
  }
  return { platform: 'darwin', architecture: machoArchitecture(), osBuild };
}

async function otoolFromDescriptor(
  handle,
  imagePin,
  architecture,
  inspectionArgument,
  maxBytes,
) {
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const child = spawn(
    '/usr/bin/otool',
    ['-arch', architecture, inspectionArgument, '/dev/fd/3'],
    {
      env: {},
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe', handle.fd],
    },
  );
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes <= maxBytes) stdout.push(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= maxBytes) stderr.push(chunk);
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
  timeout.unref();
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(timeout));
  const stderrBytesBuffer = Buffer.concat(stderr);
  const stderrText = stderrBytesBuffer.toString('utf8');
  if (
    result.exitCode !== 0 ||
    stdoutBytes > maxBytes ||
    stderrBytes > maxBytes
  ) {
    throw new ExecutableClosureError(
      'dynamic_linker_inspection_failed',
      `Could not inspect Mach-O ${inspectionArgument} output for ${imagePin.realpath}.`,
      {
        exitCode: result.exitCode,
        signal: result.signal,
        architecture,
        architectureUnavailable:
          result.exitCode !== 0 && /does not contain architecture:/u.test(stderrText),
        stderrSha256: sha256Receipt(stderrBytesBuffer),
        outputLimitExceeded: stdoutBytes > maxBytes || stderrBytes > maxBytes,
      },
    );
  }
  return Buffer.concat(stdout).toString('utf8');
}

async function otoolLoadCommandsFromDescriptor(handle, imagePin, architecture) {
  return otoolFromDescriptor(
    handle,
    imagePin,
    architecture,
    '-l',
    4 * 1024 * 1024,
  );
}

async function otoolHeaderFromDescriptor(handle, imagePin, architecture) {
  return otoolFromDescriptor(
    handle,
    imagePin,
    architecture,
    '-hv',
    16 * 1024,
  );
}

function machoHeaderCommandCount(stdout, imagePin) {
  const lines = stdout.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  const expectedHeading =
    'magic cputype cpusubtype caps filetype ncmds sizeofcmds flags';
  const values = lines.length === 4 ? lines[3].trim().split(/\s+/u) : [];
  const token = /^[A-Z0-9_]+$/u;
  if (
    lines.length !== 4 ||
    lines[0] !== '/dev/fd/3:' ||
    lines[1].trim() !== 'Mach header' ||
    lines[2].trim().split(/\s+/u).join(' ') !== expectedHeading ||
    values.length < 7 ||
    !/^MH_MAGIC(?:_64)?$/u.test(values[0]) ||
    !values.slice(1, 5).every((value) => token.test(value) || /^0x[0-9A-F]+$/u.test(value)) ||
    !/^[1-9]\d*$/u.test(values[5]) ||
    !/^\d+$/u.test(values[6]) ||
    !values.slice(7).every((value) => token.test(value) || /^0x[0-9A-F]+$/u.test(value))
  ) {
    throw new ExecutableClosureError(
      'dynamic_linker_inspection_failed',
      `otool returned a malformed Mach-O header: ${imagePin.realpath}`,
      { outputSha256: sha256Receipt(stdout) },
    );
  }
  const commandCount = Number(values[5]);
  if (!Number.isSafeInteger(commandCount)) {
    throw new ExecutableClosureError(
      'dynamic_linker_inspection_failed',
      `otool returned an unsafe Mach-O load-command count: ${imagePin.realpath}`,
    );
  }
  return commandCount;
}

async function machoLoadCommands(imagePin, requiredArchitecture = null) {
  const handle = await open(
    imagePin.realpath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let stdout;
  let expectedLoadCommandCount;
  let sliceArchitecture;
  try {
    const before = await handle.stat();
    if (
      String(before.dev) !== imagePin.device ||
      String(before.ino) !== imagePin.inode
    ) {
      throw new ExecutableClosureError(
        'dynamic_linker_image_changed',
        `Dynamic-linker image identity changed before inspection: ${imagePin.realpath}`,
      );
    }
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      hash.update(chunk);
    }
    if (`sha256:${hash.digest('hex')}` !== imagePin.sha256) {
      throw new ExecutableClosureError(
        'dynamic_linker_image_changed',
        `Dynamic-linker image bytes changed before inspection: ${imagePin.realpath}`,
      );
    }
    let lastArchitectureError;
    const architectureCandidates = requiredArchitecture === null
      ? machoArchitectureCandidates()
      : [requiredArchitecture];
    if (architectureCandidates.length === 0) {
      throw new ExecutableClosureError(
        'dynamic_linker_architecture_unsupported',
        `Unsupported Mach-O architecture: ${machoArchitecture()}`,
      );
    }
    for (const architecture of architectureCandidates) {
      try {
        const candidateStdout = await otoolLoadCommandsFromDescriptor(
          handle,
          imagePin,
          architecture,
        );
        const candidateLoadCommandCount = machoHeaderCommandCount(
          await otoolHeaderFromDescriptor(handle, imagePin, architecture),
          imagePin,
        );
        stdout = candidateStdout;
        expectedLoadCommandCount = candidateLoadCommandCount;
        sliceArchitecture = architecture;
        break;
      } catch (error) {
        if (error?.details?.architectureUnavailable !== true) throw error;
        lastArchitectureError = error;
      }
    }
    if (stdout === undefined) throw lastArchitectureError;
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new ExecutableClosureError(
        'dynamic_linker_image_changed',
        `Dynamic-linker image changed while it was inspected: ${imagePin.realpath}`,
      );
    }
  } finally {
    await handle.close();
  }
  const dependencies = [];
  const rpaths = [];
  let command = null;
  let commandFields = new Set();
  let awaitingCommand = false;
  let loadCommandCount = 0;
  const relevantCommand = () => command === 'LC_RPATH' || LOAD_COMMANDS.has(command);
  const expectedCommandFields = () => {
    if (command === 'LC_RPATH') return ['cmdsize', 'path'];
    if (command === 'LC_LOAD_DYLINKER') return ['cmdsize', 'name'];
    if (LOAD_COMMANDS.has(command)) {
      return [
        'cmdsize',
        'name',
        'timeStamp',
        'currentVersion',
        'compatibilityVersion',
      ];
    }
    return [];
  };
  const assertRelevantCommandComplete = () => {
    const expected = expectedCommandFields();
    if (
      relevantCommand() &&
      (commandFields.size !== expected.length ||
        expected.some((field) => !commandFields.has(field)))
    ) {
      throw new ExecutableClosureError(
        'dynamic_linker_load_command_malformed',
        `Mach-O load command block is incomplete: ${imagePin.realpath}`,
        { command, expected, actual: [...commandFields] },
      );
    }
  };
  const recordCommandField = (field) => {
    const expected = expectedCommandFields();
    const nextExpected = expected[commandFields.size];
    if (field !== nextExpected || commandFields.has(field)) {
      throw new ExecutableClosureError(
        'dynamic_linker_load_command_malformed',
        `Mach-O load command block has an unexpected or duplicate field: ${imagePin.realpath}`,
        { command, field, nextExpected },
      );
    }
    commandFields.add(field);
  };
  const assertLoadValue = (value) => {
    if (/[\u0000-\u001f\u007f]/u.test(value)) {
      throw new ExecutableClosureError(
        'dynamic_linker_load_command_malformed',
        `Mach-O load command contains a control character: ${imagePin.realpath}`,
        { command },
      );
    }
    return value;
  };
  const outputLines = stdout.split(/\r?\n/u);
  for (const [lineIndex, line] of outputLines.entries()) {
    if (line.length === 0 && lineIndex === outputLines.length - 1) continue;
    const loadCommandMatch = /^Load command (\d+)$/u.exec(line);
    if (loadCommandMatch !== null) {
      if (awaitingCommand) {
        throw new ExecutableClosureError(
          'dynamic_linker_load_command_malformed',
          `otool omitted the command field for a numbered load command: ${imagePin.realpath}`,
        );
      }
      assertRelevantCommandComplete();
      if (Number(loadCommandMatch[1]) !== loadCommandCount) {
        throw new ExecutableClosureError(
          'dynamic_linker_load_command_malformed',
          `otool returned a non-contiguous load-command sequence: ${imagePin.realpath}`,
        );
      }
      loadCommandCount += 1;
      command = null;
      commandFields = new Set();
      awaitingCommand = true;
      continue;
    }
    if (/^\s*Load command\b/u.test(line)) {
      throw new ExecutableClosureError(
        'dynamic_linker_load_command_malformed',
        `otool returned a malformed load-command boundary: ${imagePin.realpath}`,
      );
    }
    const commandMatch = /^\s*cmd (LC_[A-Z0-9_]+)$/u.exec(line);
    if (commandMatch !== null) {
      if (!awaitingCommand) {
        throw new ExecutableClosureError(
          'dynamic_linker_load_command_malformed',
          `otool returned a command without its numbered boundary: ${imagePin.realpath}`,
        );
      }
      command = commandMatch[1];
      commandFields = new Set();
      awaitingCommand = false;
      if (command === 'LC_DYLD_ENVIRONMENT') {
        throw new ExecutableClosureError(
          'dynamic_linker_environment_load_command',
          `Mach-O image contains forbidden LC_DYLD_ENVIRONMENT: ${imagePin.realpath}`,
        );
      }
      continue;
    }
    if (awaitingCommand) {
      throw new ExecutableClosureError(
        'dynamic_linker_load_command_malformed',
        `otool omitted or malformed the command field: ${imagePin.realpath}`,
      );
    }
    if (/^\s*cmd\b/u.test(line)) {
      throw new ExecutableClosureError(
        'dynamic_linker_load_command_malformed',
        `otool returned a malformed command field: ${imagePin.realpath}`,
      );
    }
    if (!relevantCommand()) continue;
    if (/^\s*cmdsize [1-9]\d*$/u.test(line)) {
      recordCommandField('cmdsize');
      continue;
    }
    if (command === 'LC_RPATH') {
      const rpathMatch = /^\s*path (.+) \(offset \d+\)$/u.exec(line);
      if (rpathMatch !== null) {
        recordCommandField('path');
        rpaths.push(assertLoadValue(rpathMatch[1]));
        continue;
      }
    }
    if (LOAD_COMMANDS.has(command)) {
      const nameMatch = /^\s*name (.+) \(offset \d+\)$/u.exec(line);
      if (nameMatch !== null) {
        recordCommandField('name');
        dependencies.push({
          command,
          installName: assertLoadValue(nameMatch[1]),
        });
        continue;
      }
      if (command !== 'LC_LOAD_DYLINKER') {
        if (/^\s*time stamp \d+(?: .*)?$/u.test(line)) {
          recordCommandField('timeStamp');
          continue;
        }
        if (/^\s*current version \S+$/u.test(line)) {
          recordCommandField('currentVersion');
          continue;
        }
        if (/^\s*compatibility version \S+$/u.test(line)) {
          recordCommandField('compatibilityVersion');
          continue;
        }
      }
    }
    throw new ExecutableClosureError(
      'dynamic_linker_load_command_malformed',
      `Mach-O load command block contains an unexpected line: ${imagePin.realpath}`,
      { command, lineSha256: sha256Receipt(line) },
    );
  }
  assertRelevantCommandComplete();
  if (awaitingCommand || loadCommandCount === 0) {
    throw new ExecutableClosureError(
      'dynamic_linker_inspection_failed',
      `otool did not return complete Mach-O load commands for ${imagePin.realpath}.`,
    );
  }
  if (loadCommandCount !== expectedLoadCommandCount) {
    throw new ExecutableClosureError(
      'dynamic_linker_load_command_malformed',
      `otool load-command sequence does not match the Mach-O header: ${imagePin.realpath}`,
      { expectedLoadCommandCount, loadCommandCount },
    );
  }
  return { dependencies, rpaths, sliceArchitecture };
}

function expandLoaderToken(value, imagePath, executablePath) {
  if (value === '@loader_path') return path.dirname(imagePath);
  if (value.startsWith('@loader_path/')) {
    return path.resolve(path.dirname(imagePath), value.slice('@loader_path/'.length));
  }
  if (value === '@executable_path') return path.dirname(executablePath);
  if (value.startsWith('@executable_path/')) {
    return path.resolve(
      path.dirname(executablePath),
      value.slice('@executable_path/'.length),
    );
  }
  if (path.isAbsolute(value)) return path.normalize(value);
  throw new ExecutableClosureError(
    'dynamic_linker_path_unsupported',
    `Unsupported relative Mach-O load path: ${value}`,
  );
}

async function resolveDependency({
  installName,
  imagePath,
  executablePath,
  rpaths,
}) {
  if (installName.startsWith('@rpath/')) {
    const suffix = installName.slice('@rpath/'.length);
    for (const rpath of rpaths) {
      const candidate = path.resolve(rpath, suffix);
      try {
        return { path: candidate, realpath: await realpath(candidate) };
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      }
    }
    throw new ExecutableClosureError(
      'dynamic_linker_dependency_missing',
      `Could not resolve ${installName} from ${imagePath}.`,
      { rpaths },
    );
  }
  if (
    installName.startsWith('@loader_path') ||
    installName.startsWith('@executable_path') ||
    path.isAbsolute(installName)
  ) {
    const candidate = expandLoaderToken(installName, imagePath, executablePath);
    try {
      return { path: candidate, realpath: await realpath(candidate) };
    } catch (error) {
      throw new ExecutableClosureError(
        'dynamic_linker_dependency_missing',
        `Could not resolve ${installName} from ${imagePath}.`,
        { cause: error?.message ?? String(error) },
      );
    }
  }
  throw new ExecutableClosureError(
    'dynamic_linker_path_unsupported',
    `Unsupported Mach-O install name: ${installName}`,
  );
}

export function createExecutableClosureReceipt(payload) {
  return {
    ...payload,
    closureSha256: sha256Receipt(serializeClosure(payload)),
  };
}

export async function captureExecutableClosure(executablePin) {
  const root = await stableImagePin(executablePin.realpath, executablePin.path);
  if (
    root.realpath !== executablePin.realpath ||
    root.sha256 !== executablePin.sha256
  ) {
    throw new ExecutableClosureError(
      'dynamic_linker_root_mismatch',
      'Executable root does not match the bytes selected for closure inspection.',
      { expected: executablePin, actual: root },
    );
  }
  const { macho, ...rootReceipt } = root;
  const platform = await platformIdentity();
  if (process.platform !== 'darwin' || !macho) {
    return createExecutableClosureReceipt({
      schemaVersion: 'macho-closure-v1',
      format: 'not-mach-o',
      ...platform,
      root: rootReceipt,
      images: [],
      systemLoadPaths: [],
    });
  }

  const imageQueue = [{
    path: rootReceipt.realpath,
    inheritedRpaths: [],
    sliceArchitecture: null,
  }];
  const images = new Map();
  const inspectedContexts = new Set();
  const installNameResolutions = new Map();
  const systemLoadPaths = new Set();
  let edgeCount = 0;
  while (imageQueue.length > 0) {
    const next = imageQueue.shift();
    const currentPin = await stableImagePin(next.path);
    if (!currentPin.macho) {
      throw new ExecutableClosureError(
        'dynamic_linker_dependency_not_macho',
        `Pinned Mach-O dependency is not a Mach-O image: ${next.path}`,
      );
    }
    const priorImage = images.get(currentPin.realpath);
    if (priorImage !== undefined) {
      if (
        next.sliceArchitecture !== null &&
        priorImage.sliceArchitecture !== next.sliceArchitecture
      ) {
        throw new ExecutableClosureError(
          'dynamic_linker_architecture_ambiguous',
          `Mach-O image was requested with conflicting slices: ${currentPin.realpath}`,
        );
      }
    }
    if (priorImage === undefined && images.size >= MAX_IMAGES) {
      throw new ExecutableClosureError(
        'dynamic_linker_closure_limit',
        `Mach-O closure exceeds ${MAX_IMAGES} images.`,
      );
    }
    const commands = await machoLoadCommands(
      currentPin,
      next.sliceArchitecture,
    );
    const currentRpaths = commands.rpaths.map((value) =>
      expandLoaderToken(value, currentPin.realpath, rootReceipt.realpath));
    const searchRpaths = [...new Set([...currentRpaths, ...next.inheritedRpaths])];
    const contextKey = serializeClosure({
      image: currentPin.realpath,
      sliceArchitecture: commands.sliceArchitecture,
      searchRpaths,
    });
    if (inspectedContexts.has(contextKey)) continue;
    inspectedContexts.add(contextKey);
    if (inspectedContexts.size > MAX_EDGES) {
      throw new ExecutableClosureError(
        'dynamic_linker_closure_limit',
        `Mach-O closure exceeds ${MAX_EDGES} distinct rpath contexts.`,
      );
    }
    const dependencies = [];
    for (const dependency of commands.dependencies) {
      edgeCount += 1;
      if (edgeCount > MAX_EDGES) {
        throw new ExecutableClosureError(
          'dynamic_linker_closure_limit',
          `Mach-O closure exceeds ${MAX_EDGES} dependency edges.`,
        );
      }
      if (isSystemInstallName(dependency.installName)) {
        systemLoadPaths.add(path.normalize(dependency.installName));
        dependencies.push({
          ...dependency,
          classification: 'system',
          resolvedPath: path.normalize(dependency.installName),
          resolvedRealpath: null,
        });
        continue;
      }
      const resolved = await resolveDependency({
        installName: dependency.installName,
        imagePath: currentPin.realpath,
        executablePath: rootReceipt.realpath,
        rpaths: searchRpaths,
      });
      const priorResolution = installNameResolutions.get(dependency.installName);
      if (priorResolution !== undefined && priorResolution !== resolved.realpath) {
        throw new ExecutableClosureError(
          'dynamic_linker_dependency_ambiguous',
          `Mach-O install name resolved to multiple images: ${dependency.installName}`,
          { priorResolution, currentResolution: resolved.realpath },
        );
      }
      installNameResolutions.set(dependency.installName, resolved.realpath);
      dependencies.push({
        ...dependency,
        classification: 'pinned',
        resolvedPath: resolved.path,
        resolvedRealpath: resolved.realpath,
      });
      imageQueue.push({
        path: resolved.realpath,
        inheritedRpaths: searchRpaths,
        sliceArchitecture: commands.sliceArchitecture,
      });
    }
    const { macho: _macho, ...imagePin } = currentPin;
    const imageReceipt = {
      ...imagePin,
      sliceArchitecture: commands.sliceArchitecture,
      rpaths: currentRpaths,
      dependencies,
    };
    if (
      priorImage !== undefined &&
      serializeClosure(priorImage) !== serializeClosure(imageReceipt)
    ) {
      throw new ExecutableClosureError(
        'dynamic_linker_rpath_context_ambiguous',
        `Mach-O image resolves differently across inherited rpath contexts: ${currentPin.realpath}`,
      );
    }
    if (priorImage === undefined) images.set(currentPin.realpath, imageReceipt);
  }

  return createExecutableClosureReceipt({
    schemaVersion: 'macho-closure-v1',
    format: 'mach-o',
    ...platform,
    root: rootReceipt,
    images: [...images.values()].sort((left, right) =>
      left.realpath.localeCompare(right.realpath)),
    systemLoadPaths: [...systemLoadPaths].sort(),
  });
}

export function assertRelocatablePythonClosure(closure) {
  assertMachOExecutableClosure(closure, {
    code: 'python_runtime_not_macho',
    label: 'Python runtime',
  });
  if (closure.format !== 'mach-o') return closure;
  for (const image of closure.images) {
    for (const dependency of image.dependencies) {
      if (dependency.classification !== 'pinned') continue;
      if (
        !dependency.installName.startsWith('@executable_path/') &&
        !dependency.installName.startsWith('@loader_path/')
      ) {
        const framework = dependency.resolvedRealpath?.includes('Python.framework');
        throw new ExecutableClosureError(
          framework
            ? 'python_framework_launcher_not_supported'
            : 'python_runtime_not_relocatable',
          framework
            ? 'Homebrew framework Python is not supported; use a standalone uv Python 3.11/3.12 runtime.'
            : 'Python has a non-system dependency that is not relocatable with its private bundle.',
          { dependency },
        );
      }
    }
  }
  return closure;
}

export function assertMachOExecutableClosure(
  closure,
  { code = 'executable_not_macho', label = 'Executable' } = {},
) {
  if (process.platform === 'darwin' && closure.format !== 'mach-o') {
    throw new ExecutableClosureError(
      code,
      `${label} must be a native Mach-O executable on macOS.`,
    );
  }
  return closure;
}

export function assertExecutableClosureIntegrity(closure) {
  const { closureSha256, ...payload } = closure;
  const expectedClosureSha256 = sha256Receipt(serializeClosure(payload));
  if (closureSha256 !== expectedClosureSha256) {
    throw new ExecutableClosureError(
      'dynamic_linker_receipt_invalid',
      'Dynamic-linker closure digest does not match its canonical payload.',
      { expectedClosureSha256, actualClosureSha256: closureSha256 },
    );
  }
  if (closure.format === 'not-mach-o') {
    if (closure.images.length !== 0 || closure.systemLoadPaths.length !== 0) {
      throw new ExecutableClosureError(
        'dynamic_linker_receipt_invalid',
        'A non-Mach-O receipt cannot contain images or system load paths.',
      );
    }
    return closure;
  }

  const imageRealpaths = closure.images.map((image) => image.realpath);
  if (
    new Set(imageRealpaths).size !== imageRealpaths.length ||
    imageRealpaths.some(
      (value, index) =>
        index > 0 && value.localeCompare(imageRealpaths[index - 1]) <= 0,
    )
  ) {
    throw new ExecutableClosureError(
      'dynamic_linker_receipt_invalid',
      'Mach-O images must be unique and sorted by realpath.',
    );
  }
  const rootImage = closure.images.find(
    (image) => image.realpath === closure.root.realpath,
  );
  if (
    rootImage === undefined ||
    rootImage.sha256 !== closure.root.sha256 ||
    rootImage.device !== closure.root.device ||
    rootImage.inode !== closure.root.inode
  ) {
    throw new ExecutableClosureError(
      'dynamic_linker_receipt_invalid',
      'Mach-O root must match exactly one pinned closure image.',
    );
  }
  if (
    closure.images.some(
      (image) => image.sliceArchitecture !== rootImage.sliceArchitecture,
    )
  ) {
    throw new ExecutableClosureError(
      'dynamic_linker_receipt_invalid',
      'Every pinned Mach-O image must record the root execution slice.',
    );
  }
  const systemLoads = new Set(closure.systemLoadPaths);
  if (
    systemLoads.size !== closure.systemLoadPaths.length ||
    closure.systemLoadPaths.some(
      (value, index) => index > 0 && value <= closure.systemLoadPaths[index - 1],
    )
  ) {
    throw new ExecutableClosureError(
      'dynamic_linker_receipt_invalid',
      'System load paths must be unique and sorted.',
    );
  }
  const imageByRealpath = new Map(
    closure.images.map((image) => [image.realpath, image]),
  );
  const allowedSliceArchitectures = new Set(
    machoArchitectureCandidates(closure.architecture),
  );
  if (
    closure.images.some(
      (image) => !allowedSliceArchitectures.has(image.sliceArchitecture),
    )
  ) {
    throw new ExecutableClosureError(
      'dynamic_linker_receipt_invalid',
      'Mach-O image slice is not compatible with the recorded host architecture.',
    );
  }
  const reachableImages = new Set();
  const referencedSystemLoads = new Set();
  const imageQueue = [closure.root.realpath];
  while (imageQueue.length > 0) {
    const imageRealpath = imageQueue.shift();
    if (reachableImages.has(imageRealpath)) continue;
    reachableImages.add(imageRealpath);
    const image = imageByRealpath.get(imageRealpath);
    if (image === undefined) {
      throw new ExecutableClosureError(
        'dynamic_linker_receipt_invalid',
        'Reachable pinned dependency is absent from the closure image set.',
        { image: imageRealpath },
      );
    }
    for (const dependency of image.dependencies) {
      if (dependency.classification === 'pinned') {
        if (
          isSystemInstallName(dependency.installName) ||
          !imageByRealpath.has(dependency.resolvedRealpath)
        ) {
          throw new ExecutableClosureError(
            'dynamic_linker_receipt_invalid',
            'Pinned dependency classification or target is inconsistent.',
            { image: image.realpath, dependency },
          );
        }
        imageQueue.push(dependency.resolvedRealpath);
        continue;
      }
      const normalizedInstallName = path.normalize(dependency.installName);
      if (
        !isSystemInstallName(dependency.installName) ||
        dependency.resolvedPath !== normalizedInstallName ||
        dependency.resolvedRealpath !== null ||
        !systemLoads.has(dependency.resolvedPath)
      ) {
        throw new ExecutableClosureError(
          'dynamic_linker_receipt_invalid',
          'System dependency classification or target is inconsistent.',
          { image: image.realpath, dependency },
        );
      }
      referencedSystemLoads.add(dependency.resolvedPath);
    }
  }
  if (reachableImages.size !== imageByRealpath.size) {
    throw new ExecutableClosureError(
      'dynamic_linker_receipt_invalid',
      'Mach-O closure contains an image that is unreachable from its root.',
    );
  }
  if (
    referencedSystemLoads.size !== systemLoads.size ||
    [...systemLoads].some(
      (systemLoad) =>
        !isSystemInstallName(systemLoad) ||
        !referencedSystemLoads.has(systemLoad),
    )
  ) {
    throw new ExecutableClosureError(
      'dynamic_linker_receipt_invalid',
      'System load set must exactly match reachable system dependencies.',
    );
  }
  return closure;
}

export function assertExecutableClosureConfined(closure, rootPath) {
  if (closure.format !== 'mach-o') return closure;
  for (const image of closure.images) {
    if (!isInside(rootPath, image.realpath)) {
      const framework = image.realpath.includes('Python.framework');
      throw new ExecutableClosureError(
        framework
          ? 'python_framework_launcher_not_supported'
          : 'python_dynamic_closure_external',
        framework
          ? 'Homebrew framework Python escaped the private execution bundle; use standalone uv Python.'
          : 'Python startup closure contains a non-system image outside the private execution bundle.',
        { rootPath, image: image.realpath },
      );
    }
  }
  return closure;
}

export async function revalidateExecutableClosure(executablePin) {
  if (executablePin.dynamicLinker === undefined || executablePin.dynamicLinker === null) {
    throw new ExecutableClosureError(
      'dynamic_linker_receipt_missing',
      'Executable dynamic-linker receipt is required for revalidation.',
    );
  }
  const actual = await captureExecutableClosure(executablePin);
  assertExecutableClosureIntegrity(executablePin.dynamicLinker);
  if (serializeClosure(actual) !== serializeClosure(executablePin.dynamicLinker)) {
    throw new ExecutableClosureError(
      'dynamic_linker_closure_changed',
      'Executable dynamic-linker closure changed after it was pinned.',
      {
        expectedSha256: executablePin.dynamicLinker.closureSha256,
        actualSha256: actual.closureSha256,
      },
    );
  }
  return actual;
}
