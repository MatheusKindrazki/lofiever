import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  assertExecutableClosureIntegrity,
  assertRelocatablePythonClosure,
  captureExecutableClosure,
  createExecutableClosureReceipt,
  revalidateExecutableClosure,
} from './dynamic-linker.mjs';
import { digestPath } from './integrity.mjs';
import { executableClosureSchema } from './schema.mjs';

const execFileAsync = promisify(execFile);

async function executablePin(inputPath) {
  const canonicalPath = await realpath(inputPath);
  return {
    path: inputPath,
    realpath: canonicalPath,
    sha256: await digestPath(canonicalPath),
  };
}

test('records a deterministic non-Mach-O executable receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-linker-script-'));
  const script = path.join(root, 'tool');
  await writeFile(script, '#!/bin/sh\nexit 0\n');
  await chmod(script, 0o700);
  const pin = await executablePin(script);
  const closure = await captureExecutableClosure(pin);

  assert.equal(closure.format, 'not-mach-o');
  assert.deepEqual(closure.images, []);
  assert.match(closure.closureSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(executableClosureSchema.safeParse(closure).success, true);
  if (process.platform === 'darwin') {
    assert.throws(() => assertRelocatablePythonClosure(closure), {
      code: 'python_runtime_not_macho',
    });
  }
  await assert.doesNotReject(
    revalidateExecutableClosure({ ...pin, dynamicLinker: closure }),
  );
});

test(
  'recognizes 64-bit universal Mach-O magic instead of downgrading it to a script receipt',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    for (const magic of ['cafebabf', 'bfbafeca']) {
      await t.test(magic, async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-fat-magic-'));
        const executable = path.join(root, 'universal');
        await writeFile(executable, Buffer.from(magic, 'hex'));
        await chmod(executable, 0o700);
        await assert.rejects(
          captureExecutableClosure(await executablePin(executable)),
          { code: 'dynamic_linker_inspection_failed' },
        );
      });
    }
  },
);

test(
  'selects and records the compatible slice of a real universal Mach-O executable',
  { skip: process.platform !== 'darwin' },
  async () => {
    const executable = await executablePin('/usr/bin/true');
    const closure = await captureExecutableClosure(executable);
    const rootImage = closure.images.find(
      (image) => image.realpath === closure.root.realpath,
    );
    assert.equal(closure.format, 'mach-o');
    assert.equal(rootImage.sliceArchitecture, 'arm64e');
    assert.doesNotThrow(() => assertExecutableClosureIntegrity(closure));
  },
);

test(
  'rejects a repeated Mach-O image that resolves differently through inherited rpath contexts',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-rpath-diamond-'));
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    const common = path.join(root, 'common');
    await Promise.all([
      mkdir(first),
      mkdir(second),
      mkdir(common),
    ]);
    const compiler = '/usr/bin/clang';
    const compile = (args) => execFileAsync(compiler, args, { encoding: 'utf8' });
    const firstYSource = path.join(first, 'y.c');
    const secondYSource = path.join(second, 'y.c');
    const xSource = path.join(common, 'x.c');
    const aSource = path.join(root, 'a.c');
    const bSource = path.join(root, 'b.c');
    const mainSource = path.join(root, 'main.c');
    await Promise.all([
      writeFile(firstYSource, 'int y(void) { return 1; }\n'),
      writeFile(secondYSource, 'int y(void) { return 2; }\n'),
      writeFile(xSource, 'extern int y(void); int x(void) { return y(); }\n'),
      writeFile(aSource, 'extern int x(void); int a(void) { return x(); }\n'),
      writeFile(bSource, 'extern int x(void); int b(void) { return x(); }\n'),
      writeFile(mainSource, 'extern int a(void); extern int b(void); int main(void) { return a() + b(); }\n'),
    ]);
    const firstY = path.join(first, 'libY.dylib');
    const secondY = path.join(second, 'libY.dylib');
    const xLibrary = path.join(common, 'libX.dylib');
    const aLibrary = path.join(root, 'libA.dylib');
    const bLibrary = path.join(root, 'libB.dylib');
    const executable = path.join(root, 'diamond');
    await compile(['-dynamiclib', firstYSource, '-o', firstY, '-Wl,-install_name,@rpath/libY.dylib']);
    await compile(['-dynamiclib', secondYSource, '-o', secondY, '-Wl,-install_name,@rpath/libY.dylib']);
    await compile(['-dynamiclib', xSource, firstY, '-o', xLibrary, `-Wl,-install_name,${xLibrary}`]);
    await compile(['-dynamiclib', aSource, xLibrary, '-o', aLibrary, `-Wl,-install_name,${aLibrary}`, `-Wl,-rpath,${first}`]);
    await compile(['-dynamiclib', bSource, xLibrary, '-o', bLibrary, `-Wl,-install_name,${bLibrary}`, `-Wl,-rpath,${second}`]);
    await compile([mainSource, aLibrary, bLibrary, '-o', executable]);

    await assert.rejects(
      captureExecutableClosure(await executablePin(executable)),
      { code: 'dynamic_linker_dependency_ambiguous' },
    );
  },
);

test(
  'rejects LC_DYLD_ENVIRONMENT before emitting an executable closure',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-dyld-environment-'));
    const source = path.join(root, 'main.c');
    const executable = path.join(root, 'dyld-environment');
    await writeFile(source, 'int main(void) { return 0; }\n');
    await execFileAsync('/usr/bin/clang', [
      source,
      '-Wl,-dyld_env,DYLD_LIBRARY_PATH=/tmp/evil',
      '-o',
      executable,
    ]);
    await assert.rejects(
      captureExecutableClosure(await executablePin(executable)),
      { code: 'dynamic_linker_environment_load_command' },
    );
  },
);

test(
  'rejects an install-name newline that makes an offset-suffixed decoy look valid',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-load-name-newline-'));
    const librarySource = path.join(root, 'victim.c');
    const decoySource = path.join(root, 'decoy.c');
    const mainSource = path.join(root, 'main.c');
    const libraryName = 'lib (offset 24)\nnewline.dylib';
    const libraryPath = path.join(root, libraryName);
    const decoyPath = path.join(root, 'lib');
    const executable = path.join(root, 'newline-load');
    await writeFile(librarySource, 'int victim(void) { return 7; }\n');
    await writeFile(decoySource, 'int victim(void) { return 1; }\n');
    await writeFile(
      mainSource,
      'extern int victim(void); int main(void) { return victim(); }\n',
    );
    await execFileAsync('/usr/bin/clang', [
      '-dynamiclib',
      librarySource,
      '-Wl,-install_name,@executable_path/lib (offset 24)\nnewline.dylib',
      '-o',
      libraryPath,
    ]);
    await execFileAsync('/usr/bin/clang', [
      '-dynamiclib',
      decoySource,
      '-Wl,-install_name,@executable_path/lib',
      '-o',
      decoyPath,
    ]);
    await execFileAsync('/usr/bin/clang', [
      mainSource,
      libraryPath,
      '-o',
      executable,
    ]);
    await assert.rejects(
      execFileAsync(executable),
      (error) => error.code === 7,
    );
    await assert.rejects(
      captureExecutableClosure(await executablePin(executable)),
      { code: 'dynamic_linker_load_command_malformed' },
    );
  },
);

test(
  'rejects an install name that injects a complete extra load-command boundary',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-load-boundary-spoof-'));
    const victimSource = path.join(root, 'victim.c');
    const decoySource = path.join(root, 'decoy.c');
    const mainSource = path.join(root, 'main.c');
    const injectedLeaf = [
      'lib (offset 24)',
      '   time stamp 2 Wed Dec 31 21:00:02 1969',
      '      current version 0.0.0',
      'compatibility version 0.0.0',
      'Load command 18',
      '      cmd LC_UUID',
      'ignored',
    ].join('\n');
    const installName = `@executable_path/${injectedLeaf}`;
    const victimPath = path.join(root, injectedLeaf);
    const decoyPath = path.join(root, 'lib');
    const executable = path.join(root, 'advanced-spoof');
    await Promise.all([
      writeFile(victimSource, 'int victim(void) { return 7; }\n'),
      writeFile(decoySource, 'int victim(void) { return 1; }\n'),
      writeFile(
        mainSource,
        'extern int victim(void); int main(void) { return victim(); }\n',
      ),
    ]);
    await execFileAsync('/usr/bin/clang', [
      '-dynamiclib',
      victimSource,
      `-Wl,-install_name,${installName}`,
      '-o',
      victimPath,
    ]);
    await execFileAsync('/usr/bin/clang', [
      '-dynamiclib',
      decoySource,
      '-Wl,-install_name,@executable_path/lib',
      '-o',
      decoyPath,
    ]);
    await execFileAsync('/usr/bin/clang', [
      mainSource,
      '-Wl,-lSystem',
      victimPath,
      '-o',
      executable,
    ]);

    const bytes = await readFile(executable);
    assert.equal(bytes.readUInt32LE(0), 0xfeedfacf);
    const commandCount = bytes.readUInt32LE(16);
    const commandBytes = bytes.readUInt32LE(20);
    const commandStart = 32;
    const commandEnd = commandStart + commandBytes;
    const marker = Buffer.from('@executable_path/lib (offset 24)\n');
    let cursor = commandStart;
    let victimCommand = null;
    for (let index = 0; index < commandCount; index += 1) {
      const command = bytes.readUInt32LE(cursor);
      const commandSize = bytes.readUInt32LE(cursor + 4);
      assert.ok(commandSize >= 8 && cursor + commandSize <= commandEnd);
      if (
        (command & 0x7fffffff) === 0x0c &&
        bytes.subarray(cursor, cursor + commandSize).includes(marker)
      ) {
        victimCommand = { start: cursor, end: cursor + commandSize };
      }
      cursor += commandSize;
    }
    assert.equal(cursor, commandEnd);
    assert.notEqual(victimCommand, null);
    const reorderedCommands = Buffer.concat([
      bytes.subarray(commandStart, victimCommand.start),
      bytes.subarray(victimCommand.end, commandEnd),
      bytes.subarray(victimCommand.start, victimCommand.end),
    ]);
    assert.equal(reorderedCommands.length, commandBytes);
    reorderedCommands.copy(bytes, commandStart);
    await writeFile(executable, bytes);
    await execFileAsync('/usr/bin/codesign', [
      '--force',
      '--sign',
      '-',
      executable,
    ]);

    await assert.rejects(
      execFileAsync(executable),
      (error) => error.code === 7,
    );
    await assert.rejects(
      captureExecutableClosure(await executablePin(executable)),
      { code: 'dynamic_linker_load_command_malformed' },
    );
  },
);

test(
  'accepts the real uv CPython 3.12 startup closure and rejects Homebrew framework Python 3.11',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const uvExecutable = process.env.LOFIEVER_TEST_UV ??
      '/Users/matheuskindrazki/.local/bin/uv';
    try {
      await access(uvExecutable);
    } catch {
      t.skip(`uv executable unavailable at ${uvExecutable}`);
      return;
    }
    const { stdout } = await execFileAsync(uvExecutable, ['python', 'find', '3.12'], {
      encoding: 'utf8',
    });
    const uvPython = await executablePin(stdout.trim());
    const uvClosure = await captureExecutableClosure(uvPython);
    assert.equal(executableClosureSchema.safeParse(uvClosure).success, true);
    assert.equal(uvClosure.format, 'mach-o');
    assert.ok(uvClosure.images.length >= 2);
    assert.doesNotThrow(() => assertRelocatablePythonClosure(uvClosure));
    await assert.doesNotReject(
      revalidateExecutableClosure({ ...uvPython, dynamicLinker: uvClosure }),
    );

    const homebrewPython = '/opt/homebrew/bin/python3.11';
    try {
      await access(homebrewPython);
    } catch {
      t.skip(`Homebrew Python unavailable at ${homebrewPython}`);
      return;
    }
    const brewPin = await executablePin(homebrewPython);
    const brewClosure = await captureExecutableClosure(brewPin);
    assert.throws(() => assertRelocatablePythonClosure(brewClosure), {
      code: 'python_framework_launcher_not_supported',
    });
  },
);

test(
  'pins and revalidates the real recursive Homebrew ffprobe closure',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const ffprobePath = process.env.LOFIEVER_TEST_FFPROBE ?? '/opt/homebrew/bin/ffprobe';
    try {
      await access(ffprobePath);
    } catch {
      t.skip(`ffprobe unavailable at ${ffprobePath}`);
      return;
    }
    const ffprobe = await executablePin(ffprobePath);
    const closure = await captureExecutableClosure(ffprobe);
    assert.equal(executableClosureSchema.safeParse(closure).success, true);
    assert.equal(closure.format, 'mach-o');
    assert.ok(closure.images.length >= 10);
    assert.ok(closure.systemLoadPaths.length >= 1);
    assert.equal(closure.systemLoadPaths.includes('/usr/lib/dyld'), true);
    assert.doesNotThrow(() => assertExecutableClosureIntegrity(closure));
    await assert.doesNotReject(
      revalidateExecutableClosure({ ...ffprobe, dynamicLinker: closure }),
    );

    const { closureSha256: _forgedSha256, ...forgedPayload } = structuredClone(closure);
    forgedPayload.images.at(-1).sha256 = `sha256:${'0'.repeat(64)}`;
    const forged = createExecutableClosureReceipt(forgedPayload);
    await assert.rejects(
      revalidateExecutableClosure({ ...ffprobe, dynamicLinker: forged }),
      { code: 'dynamic_linker_closure_changed' },
    );

    const { closureSha256: _closureSha256, ...payload } = closure;
    const forgedRoot = structuredClone(payload);
    forgedRoot.root.sha256 = `sha256:${'0'.repeat(64)}`;
    assert.throws(
      () =>
        assertExecutableClosureIntegrity(
          createExecutableClosureReceipt(forgedRoot),
        ),
      { code: 'dynamic_linker_receipt_invalid' },
    );
    const forgedDependency = structuredClone(payload);
    const pinnedDependency = forgedDependency.images
      .flatMap((image) => image.dependencies)
      .find((dependency) => dependency.classification === 'pinned');
    assert.notEqual(pinnedDependency, undefined);
    pinnedDependency.resolvedRealpath = '/outside/closure.dylib';
    assert.throws(
      () =>
        assertExecutableClosureIntegrity(
          createExecutableClosureReceipt(forgedDependency),
        ),
      { code: 'dynamic_linker_receipt_invalid' },
    );

    const orphanImage = structuredClone(payload);
    orphanImage.images.push({
      path: '/orphan/image.dylib',
      realpath: '/orphan/image.dylib',
      sha256: `sha256:${'1'.repeat(64)}`,
      device: '1',
      inode: '1',
      sliceArchitecture: closure.images[0].sliceArchitecture,
      rpaths: [],
      dependencies: [],
    });
    orphanImage.images.sort((left, right) =>
      left.realpath.localeCompare(right.realpath));
    assert.throws(
      () => assertExecutableClosureIntegrity(createExecutableClosureReceipt(orphanImage)),
      { code: 'dynamic_linker_receipt_invalid' },
    );

    const extraSystemLoad = structuredClone(payload);
    extraSystemLoad.systemLoadPaths.push('/usr/lib/unreferenced.dylib');
    extraSystemLoad.systemLoadPaths.sort();
    assert.throws(
      () =>
        assertExecutableClosureIntegrity(
          createExecutableClosureReceipt(extraSystemLoad),
        ),
      { code: 'dynamic_linker_receipt_invalid' },
    );

    const forgedSystemClassification = structuredClone(payload);
    const forgedSystemDependency = forgedSystemClassification.images
      .flatMap((image) => image.dependencies)
      .find((dependency) => dependency.classification === 'pinned');
    assert.notEqual(forgedSystemDependency, undefined);
    forgedSystemDependency.classification = 'system';
    forgedSystemDependency.resolvedPath = '/tmp/evil.dylib';
    forgedSystemDependency.resolvedRealpath = null;
    forgedSystemClassification.systemLoadPaths.push('/tmp/evil.dylib');
    forgedSystemClassification.systemLoadPaths.sort();
    assert.throws(
      () =>
        assertExecutableClosureIntegrity(
          createExecutableClosureReceipt(forgedSystemClassification),
        ),
      { code: 'dynamic_linker_receipt_invalid' },
    );

    const mixedArchitecture = structuredClone(payload);
    const nonRootImage = mixedArchitecture.images.find(
      (image) => image.realpath !== mixedArchitecture.root.realpath,
    );
    assert.notEqual(nonRootImage, undefined);
    nonRootImage.sliceArchitecture =
      nonRootImage.sliceArchitecture === 'arm64' ? 'arm64e' : 'arm64';
    assert.throws(
      () =>
        assertExecutableClosureIntegrity(
          createExecutableClosureReceipt(mixedArchitecture),
        ),
      { code: 'dynamic_linker_receipt_invalid' },
    );

    const forgedHostArchitecture = structuredClone(payload);
    forgedHostArchitecture.architecture = 'x86_64';
    assert.throws(
      () =>
        assertExecutableClosureIntegrity(
          createExecutableClosureReceipt(forgedHostArchitecture),
        ),
      { code: 'dynamic_linker_receipt_invalid' },
    );
  },
);
