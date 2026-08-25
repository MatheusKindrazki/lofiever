import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  BenchmarkIntegrityError,
  digestPath,
  observeHostIdentity,
  pinPythonRuntimeDirectory,
  revalidatePreparedExecutionEnvironment,
  verifyEngineRepository,
  verifyExecutionEnvironment,
  verifyPinnedPath,
} from './integrity.mjs';

const execFileAsync = promisify(execFile);

function sha256Receipt(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

test('observes canonical macOS host identity with bounded absolute sw_vers probes', async () => {
  const calls = [];
  const observed = await observeHostIdentity({
    platform: 'darwin',
    hostname: () => 'm5max.local',
    cpus: () => [{ model: 'Apple M5 Max' }],
    totalmem: () => 137_438_953_472,
    execFile: async (file, args, options) => {
      calls.push({ file, args, options });
      return {
        stdout: args[0] === '-productVersion' ? '26.0\n' : '25A123\n',
        stderr: '',
      };
    },
  });

  assert.deepEqual(observed, {
    machine: 'm5max.local',
    chip: 'Apple M5 Max',
    memoryBytes: 137_438_953_472,
    osVersion: 'macOS 26.0 (25A123)',
  });
  assert.deepEqual(
    calls.map(({ file, args }) => [file, args]),
    [
      ['/usr/bin/sw_vers', ['-productVersion']],
      ['/usr/bin/sw_vers', ['-buildVersion']],
    ],
  );
  for (const { options } of calls) {
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 10_000);
    assert.equal(options.maxBuffer, 64 * 1024);
    assert.deepEqual(options.env, { LC_ALL: 'C', LANG: 'C' });
  }
});

test('normalizes host identity components and rejects empty, control, or oversized probe output', async () => {
  const validExecFile = async (_file, args) => ({
    stdout: args[0] === '-productVersion' ? ' 26.0 \n' : ' 25A123 \n',
    stderr: '',
  });
  assert.deepEqual(
    await observeHostIdentity({
      platform: 'darwin',
      hostname: () => ' m5max.local ',
      cpus: () => [{ model: ' Apple M5 Max ' }],
      totalmem: () => 137_438_953_472,
      execFile: validExecFile,
    }),
    {
      machine: 'm5max.local',
      chip: 'Apple M5 Max',
      memoryBytes: 137_438_953_472,
      osVersion: 'macOS 26.0 (25A123)',
    },
  );

  const invalidCases = [
    { hostname: () => '   ', cpus: () => [{ model: 'Apple M5 Max' }], execFile: validExecFile },
    { hostname: () => 'm5max.local', cpus: () => [{ model: '\t' }], execFile: validExecFile },
    {
      hostname: () => 'm5max.local',
      cpus: () => [{ model: 'Apple M5 Max' }],
      execFile: async (_file, args) => ({
        stdout: args[0] === '-productVersion' ? ' \n' : '25A123\n',
        stderr: '',
      }),
    },
    {
      hostname: () => 'm5max.local',
      cpus: () => [{ model: 'Apple M5 Max' }],
      execFile: async (_file, args) => ({
        stdout: args[0] === '-productVersion' ? '26.0\n' : '25A\u007f123\n',
        stderr: '',
      }),
    },
    {
      hostname: () => 'm'.repeat(256),
      cpus: () => [{ model: 'Apple M5 Max' }],
      execFile: validExecFile,
    },
  ];
  for (const invalid of invalidCases) {
    await assert.rejects(
      observeHostIdentity({
        platform: 'darwin',
        totalmem: () => 137_438_953_472,
        ...invalid,
      }),
      { code: 'host_identity_unavailable' },
    );
  }

  await assert.rejects(
    observeHostIdentity({
      platform: 'linux',
      hostname: () => 'host',
      cpus: () => [{ model: 'chip' }],
      totalmem: () => 1024,
      type: () => 'Linux',
      release: () => ' ',
      version: () => 'version',
    }),
    { code: 'host_identity_unavailable' },
  );
});

test('execution rejects configured host labels that differ from local observation before pins spawn', async () => {
  const observed = {
    machine: 'observed.local',
    chip: 'Apple M5 Max',
    memoryBytes: 137_438_953_472,
    osVersion: 'macOS 26.0 (25A123)',
  };
  const config = {
    identity: {
      host: { ...observed, chip: 'forged-label' },
      model: {},
      engine: {},
      runtime: {},
      toolchain: {},
    },
    adapter: {},
  };

  await assert.rejects(
    verifyExecutionEnvironment(config, {
      observeHostIdentity: async () => observed,
    }),
    { code: 'host_identity_mismatch' },
  );
});

test('hashes nested binary .pth package data without parsing it as site configuration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-nested-pth-'));
  const sitePackages = path.join(root, 'site-packages');
  const assetDirectory = path.join(sitePackages, 'package', 'assets');
  const nestedWeights = path.join(assetDirectory, 'model.pth');
  await mkdir(assetDirectory, { recursive: true });
  await writeFile(nestedWeights, Buffer.from([0xff, 0x00, 0x80, 0x01]));

  const initial = await pinPythonRuntimeDirectory(sitePackages);
  assert.match(initial.sha256, /^sha256:[a-f0-9]{64}$/u);

  await writeFile(nestedWeights, Buffer.from([0xff, 0x00, 0x80, 0x02]));
  const changed = await pinPythonRuntimeDirectory(sitePackages);
  assert.notEqual(changed.sha256, initial.sha256);

  await writeFile(
    path.join(sitePackages, 'top-level-path-config.pth'),
    Buffer.from([0xff, 0x00]),
  );
  await assert.rejects(pinPythonRuntimeDirectory(sitePackages), {
    code: 'python_path_configuration_invalid',
  });

  await unlink(path.join(sitePackages, 'top-level-path-config.pth'));
  const topLevelLink = path.join(sitePackages, 'linked-path-config.pth');
  await symlink(path.relative(sitePackages, nestedWeights), topLevelLink);
  await assert.rejects(pinPythonRuntimeDirectory(sitePackages), {
    code: 'python_path_configuration_invalid',
  });

  await unlink(topLevelLink);
  const nestedLink = path.join(assetDirectory, 'linked-model.pth');
  await symlink(path.basename(nestedWeights), nestedLink);
  const linkedAsset = await pinPythonRuntimeDirectory(sitePackages);
  assert.match(linkedAsset.sha256, /^sha256:[a-f0-9]{64}$/u);

  const homonymousAssetDirectory = path.join(assetDirectory, 'site-packages');
  await mkdir(homonymousAssetDirectory);
  await writeFile(
    path.join(homonymousAssetDirectory, 'nested-model.pth'),
    Buffer.from([0xff, 0x00]),
  );
  const homonymousAsset = await pinPythonRuntimeDirectory(sitePackages);
  assert.match(homonymousAsset.sha256, /^sha256:[a-f0-9]{64}$/u);

  const outside = path.join(root, 'outside-model.pth');
  await writeFile(outside, Buffer.from([0xff, 0x00]));
  const escapingLink = path.join(assetDirectory, 'escaping-model.pth');
  await symlink(outside, escapingLink);
  await assert.rejects(pinPythonRuntimeDirectory(sitePackages), {
    code: 'runtime_symlink_escape',
  });
});

test('rejects logical Python site directories that are symbolic links', async () => {
  const exactRoot = await mkdtemp(path.join(os.tmpdir(), 'lofiever-site-alias-'));
  const actualPackages = path.join(exactRoot, 'actual-packages');
  const sitePackagesAlias = path.join(exactRoot, 'site-packages');
  await mkdir(actualPackages);
  await writeFile(
    path.join(actualPackages, 'startup.pth'),
    'import os; os.system("false")\n',
  );
  await symlink(path.basename(actualPackages), sitePackagesAlias);
  await assert.rejects(pinPythonRuntimeDirectory(sitePackagesAlias), {
    code: 'python_site_directory_symlink',
  });

  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'lofiever-runtime-alias-'));
  const runtimeLibrary = path.join(runtimeRoot, 'lib');
  const runtimeVersion = path.join(runtimeLibrary, 'Python3.12');
  const runtimePackages = path.join(runtimeRoot, 'actual-packages');
  await mkdir(runtimeVersion, { recursive: true });
  await mkdir(runtimePackages);
  await writeFile(
    path.join(runtimePackages, 'startup.pth'),
    'import os; os.system("false")\n',
  );
  await symlink('../../actual-packages', path.join(runtimeVersion, 'Site-Packages'));
  await assert.rejects(pinPythonRuntimeDirectory(runtimeLibrary, {
    pathConfigurationMode: 'runtime-library',
  }), {
    code: 'python_site_directory_symlink',
  });
});

test('validates path configuration in nested runtime site-packages directories', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'lofiever-runtime-pth-'));
  const sitePackages = path.join(runtimeRoot, 'lib', 'Python3.12', 'Site-Packages');
  await mkdir(sitePackages, { recursive: true });
  await writeFile(
    path.join(sitePackages, 'startup.pth'),
    'import os; os.system("false")\n',
  );

  await assert.rejects(pinPythonRuntimeDirectory(path.join(runtimeRoot, 'lib'), {
    pathConfigurationMode: 'runtime-library',
  }), {
    code: 'python_path_configuration_external',
  });
});

test(
  'accepts the simple pinned import hook in a real bare uv Python 3.12 venv',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-uv-venv-'));
    const virtualEnvironment = path.join(root, 'venv');
    const uvExecutable = process.env.LOFIEVER_TEST_UV ??
      '/Users/matheuskindrazki/.local/bin/uv';
    await execFileAsync(
      uvExecutable,
      ['venv', '--python', '3.12', '--no-project', virtualEnvironment],
    );
    const { stdout } = await execFileAsync(
      path.join(virtualEnvironment, 'bin', 'python'),
      ['--version'],
      { encoding: 'utf8' },
    );
    const version = /^Python (\d+\.\d+)/u.exec(stdout.trim())?.[1];
    assert.equal(version, '3.12');
    const sitePackages = path.join(
      virtualEnvironment,
      'lib',
      `python${version}`,
      'site-packages',
    );
    const pythonExecutable = path.join(virtualEnvironment, 'bin', 'python');
    const pin = await pinPythonRuntimeDirectory(sitePackages, { pythonExecutable });
    assert.match(pin.sha256, /^sha256:[a-f0-9]{64}$/u);

    const shadowModule = path.join(sitePackages, 'os.py');
    const shadowPathFile = path.join(sitePackages, 'frozen-shadow.pth');
    await writeFile(shadowModule, '# must not shadow frozen os\n');
    await writeFile(shadowPathFile, 'import os\n');
    await assert.rejects(
      pinPythonRuntimeDirectory(sitePackages, { pythonExecutable }),
      { code: 'python_path_resolution_external' },
    );
    await unlink(shadowModule);
    await unlink(shadowPathFile);

    const hostileMarker = path.join(root, 'hostile-json-executed');
    await writeFile(shadowModule, '# must not shadow frozen os\n');
    await writeFile(shadowPathFile, 'import os\n');
    await writeFile(
      path.join(sitePackages, 'json.py'),
      [
        `open(${JSON.stringify(hostileMarker)}, "w").write("executed")`,
        `def dumps(_value): return ${JSON.stringify(JSON.stringify({ origin: shadowModule }))}`,
        '',
      ].join('\n'),
    );
    await assert.rejects(
      pinPythonRuntimeDirectory(sitePackages, { pythonExecutable }),
      { code: 'python_path_resolution_external' },
    );
    await assert.rejects(access(hostileMarker), { code: 'ENOENT' });
    await unlink(path.join(sitePackages, 'json.py'));
    await unlink(shadowModule);
    await unlink(shadowPathFile);

    await writeFile(
      path.join(sitePackages, 'hostile.pth'),
      'import os; os.system("false")\n',
    );
    await assert.rejects(pinPythonRuntimeDirectory(sitePackages, { pythonExecutable }), {
      code: 'python_path_configuration_external',
    });
  },
);

test('verifies an exact realpath and digest and detects replacement before execution', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-pin-'));
  const filePath = path.join(directory, 'adapter.py');
  await writeFile(filePath, 'print("adapter-v1")\n');
  const canonicalPath = await realpath(filePath);
  const pin = {
    path: filePath,
    realpath: canonicalPath,
    sha256: sha256Receipt('print("adapter-v1")\n'),
  };

  assert.deepEqual(await verifyPinnedPath(pin, { label: 'adapter script' }), pin);

  await writeFile(filePath, 'print("tampered")\n');
  await assert.rejects(verifyPinnedPath(pin, { label: 'adapter script' }), (error) => {
    assert.equal(error instanceof BenchmarkIntegrityError, true);
    assert.equal(error.code, 'pin_mismatch');
    return true;
  });
});

test('digests a model directory deterministically and detects any weight change', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lofiever-weights-'));
  await writeFile(path.join(directory, 'config.json'), '{}\n');
  await writeFile(path.join(directory, 'model.safetensors'), 'fixture-weights');

  const first = await digestPath(directory);
  const second = await digestPath(directory);
  assert.equal(first, second);

  await writeFile(path.join(directory, 'model.safetensors'), 'changed-weights');
  assert.notEqual(await digestPath(directory), first);
});

test('requires the engine repository HEAD to match exactly and the worktree to be clean', async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'lofiever-engine-'));
  await execFileAsync('git', ['init', '-q', repository]);
  await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Fixture']);
  await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'fixture@example.test']);
  await writeFile(path.join(repository, 'engine.py'), 'ENGINE = 1\n');
  await execFileAsync('git', ['-C', repository, 'add', 'engine.py']);
  await execFileAsync('git', ['-C', repository, 'commit', '-q', '-m', 'fixture']);
  const { stdout } = await execFileAsync('git', ['-C', repository, 'rev-parse', 'HEAD']);
  const commit = stdout.trim();

  const verified = await verifyEngineRepository({
    repositoryPath: repository,
    repoCommit: commit,
  });
  assert.equal(verified.repoCommit, commit);
  assert.equal(verified.clean, true);

  await writeFile(path.join(repository, 'engine.py'), 'ENGINE = 2\n');
  await assert.rejects(
    verifyEngineRepository({ repositoryPath: repository, repoCommit: commit }),
    (error) => {
      assert.equal(error instanceof BenchmarkIntegrityError, true);
      assert.equal(error.code, 'engine_worktree_dirty');
      return true;
    },
  );
});

async function verifyRealDarwinExecutionEnvironment() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-darwin-environment-'));
  const repository = path.join(root, 'engine');
  const harnessRepository = path.join(root, 'harness');
  const runDirectory = path.join(root, 'run');
  const virtualEnvironment = path.join(root, 'venv');
  await mkdir(repository);
  await mkdir(harnessRepository);
  await mkdir(runDirectory, { mode: 0o700 });

  async function gitRepository(directory, fileName) {
    await execFileAsync('git', ['init', '-q', directory]);
    await execFileAsync('git', ['-C', directory, 'config', 'user.name', 'Fixture']);
    await execFileAsync('git', [
      '-C', directory, 'config', 'user.email', 'fixture@example.test',
    ]);
    await writeFile(path.join(directory, fileName), 'fixture\n');
    await execFileAsync('git', ['-C', directory, 'add', fileName]);
    await execFileAsync('git', ['-C', directory, 'commit', '-q', '-m', 'fixture']);
    const { stdout } = await execFileAsync('git', [
      '-C', directory, 'rev-parse', 'HEAD',
    ]);
    return stdout.trim();
  }

  async function pinPath(inputPath, version = undefined) {
    const canonicalPath = await realpath(inputPath);
    const pin = {
      path: inputPath,
      realpath: canonicalPath,
      sha256: await digestPath(canonicalPath),
    };
    return version === undefined ? pin : { ...pin, version };
  }

  async function toolPin(inputPath, args) {
    const pin = await pinPath(inputPath);
    const { stdout, stderr } = await execFileAsync(pin.realpath, args, {
      encoding: 'utf8',
    });
    const version = `${stdout ?? ''}\n${stderr ?? ''}`
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean);
    return { ...pin, version };
  }

  const engineCommit = await gitRepository(repository, 'engine.py');
  const harnessCommit = await gitRepository(harnessRepository, 'harness.mjs');
  const modelWeightsPath = path.join(root, 'model.bin');
  const lmWeightsPath = path.join(root, 'lm.bin');
  const adapterScriptPath = path.join(root, 'adapter.py');
  await writeFile(modelWeightsPath, 'model weights\n');
  await writeFile(lmWeightsPath, 'lm weights\n');
  await writeFile(adapterScriptPath, '# reviewed adapter\n');

  const uvPath = process.env.LOFIEVER_TEST_UV ?? '/Users/matheuskindrazki/.local/bin/uv';
  await execFileAsync(
    uvPath,
    ['venv', '--python', '3.12', '--no-project', virtualEnvironment],
  );
  const pythonPath = path.join(virtualEnvironment, 'bin', 'python');
  const python = await toolPin(pythonPath, ['--version']);
  const { version: _pythonVersion, ...pythonExecutable } = python;
  const gitPath = (await execFileAsync('/usr/bin/which', ['git'], { encoding: 'utf8' })).stdout.trim();
  const ffmpegPath = process.env.LOFIEVER_TEST_FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
  const ffprobePath = process.env.LOFIEVER_TEST_FFPROBE ?? '/opt/homebrew/bin/ffprobe';
  const config = {
    identity: {
      benchmarkId: 'fixture-darwin-evidence',
      host: await observeHostIdentity(),
      engine: {
        name: 'fixture-engine',
        repositoryPath: repository,
        repoCommit: engineCommit,
      },
      model: {
        id: 'fixture-model',
        revision: '1'.repeat(40),
        weights: await pinPath(modelWeightsPath),
        lm: {
          id: 'fixture-lm',
          revision: '2'.repeat(40),
          weights: await pinPath(lmWeightsPath),
        },
      },
      toolchain: {
        git: await toolPin(gitPath, ['--version']),
        node: await pinPath(process.execPath, process.version),
        python,
        uv: await toolPin(uvPath, ['--version']),
        ffmpeg: await toolPin(ffmpegPath, ['-version']),
        ffprobe: await toolPin(ffprobePath, ['-version']),
      },
      runtime: {
        device: 'mps',
        lmBackend: 'mlx',
        vaeChunk: 8,
        harnessRepositoryPath: harnessRepository,
        harnessCommit,
        harnessClean: null,
        runDirectory,
        serverCommit: null,
      },
    },
    adapter: {
      kind: 'persistent-jsonl-v1',
      workingDirectory: repository,
      executable: pythonExecutable,
      script: await pinPath(adapterScriptPath),
      requestTimeoutSeconds: 30,
      terminateGraceSeconds: 1,
      maxOutputBytes: 1024,
    },
  };

  const verified = await verifyExecutionEnvironment(config);
  assert.equal(verified.adapter.dynamicLinker.format, 'mach-o');
  assert.equal(verified.identity.toolchain.uv.dynamicLinker.format, 'mach-o');
  assert.equal(verified.identity.toolchain.ffprobe.dynamicLinker.format, 'mach-o');
  assert.equal(
    verified.identity.toolchain.ffprobe.dynamicLinker.systemLoadPaths.includes('/usr/lib/dyld'),
    true,
  );
  assert.notEqual(verified.adapter.pythonRuntime.virtualEnvironment, null);
  assert.equal(verified.processEnvironment.PYTHONSAFEPATH, '1');
  const { stdout: bundledVersion } = await execFileAsync(
    verified.adapter.executable.realpath,
    ['-P', '--version'],
    { encoding: 'utf8', env: verified.processEnvironment },
  );
  assert.match(bundledVersion.trim(), /^Python 3\.12\./u);
  const { stdout: safePathVenv } = await execFileAsync(
    verified.adapter.executable.realpath,
    [
      '-P',
      '-c',
      'import _virtualenv,sys; print(int(sys.flags.safe_path)); print(sys.prefix)',
    ],
    { encoding: 'utf8', env: verified.processEnvironment },
  );
  const [safePathFlag, isolatedPrefix] = safePathVenv.trim().split(/\r?\n/u);
  assert.equal(safePathFlag, '1');
  assert.equal(
    isolatedPrefix,
    verified.adapter.pythonRuntime.virtualEnvironment.snapshotRootRealpath,
  );
  assert.equal('PYTHONPATH' in verified.processEnvironment, false);

  const reverified = await verifyExecutionEnvironment(config);
  assert.equal(
    reverified.adapter.dynamicLinker.closureSha256,
    verified.adapter.dynamicLinker.closureSha256,
  );
  assert.equal(
    reverified.identity.toolchain.ffprobe.dynamicLinker.closureSha256,
    verified.identity.toolchain.ffprobe.dynamicLinker.closureSha256,
  );
  const evidenceRevalidation = await revalidatePreparedExecutionEnvironment(config, verified);
  assert.equal(
    evidenceRevalidation.adapter.dynamicLinker.closureSha256,
    verified.adapter.dynamicLinker.closureSha256,
  );

  const outsideSnapshotLibrary = path.join(root, 'outside-snapshot-library');
  await cp(
    verified.adapter.pythonRuntime.snapshotLibrary.realpath,
    outsideSnapshotLibrary,
    { recursive: true, verbatimSymlinks: true },
  );
  const outsideLibraryPin = await pinPythonRuntimeDirectory(outsideSnapshotLibrary, {
    pythonExecutable: config.adapter.executable.realpath,
    pathConfigurationMode: 'runtime-library',
  });
  const relocatedRuntime = structuredClone(verified);
  relocatedRuntime.adapter.pythonRuntime.snapshotLibrary = outsideLibraryPin;
  await assert.rejects(
    revalidatePreparedExecutionEnvironment(config, relocatedRuntime),
    { code: 'tcb_snapshot_mismatch' },
  );

  const snapshotLauncherPath = path.join(
    verified.adapter.pythonRuntime.virtualEnvironment.snapshotRootRealpath,
    'bin',
    path.basename(verified.adapter.pythonRuntime.virtualEnvironment.launcherPath),
  );
  const savedSnapshotLauncherPath = `${snapshotLauncherPath}.saved-evidence-test`;
  const snapshotLauncherDirectory = path.dirname(snapshotLauncherPath);
  await chmod(snapshotLauncherDirectory, 0o700);
  try {
    await rename(snapshotLauncherPath, savedSnapshotLauncherPath);
    await assert.rejects(
      revalidatePreparedExecutionEnvironment(config, verified),
      { code: 'tcb_snapshot_mismatch' },
    );
    await assert.rejects(
      verifyExecutionEnvironment(config),
      { code: 'tcb_snapshot_mismatch' },
    );
    await symlink(config.adapter.executable.realpath, snapshotLauncherPath);
    await assert.rejects(
      revalidatePreparedExecutionEnvironment(config, verified),
      { code: 'tcb_snapshot_mismatch' },
    );
    await unlink(snapshotLauncherPath);
  } finally {
    await unlink(snapshotLauncherPath).catch(() => {});
    await rename(savedSnapshotLauncherPath, snapshotLauncherPath).catch(() => {});
    await chmod(snapshotLauncherDirectory, 0o500);
  }

  const bundlePath = path.dirname(path.dirname(verified.adapter.executable.realpath));
  const missingBundlePath = `${bundlePath}.missing-evidence-test`;
  const runEntriesBefore = (await readdir(runDirectory)).sort();
  await rename(bundlePath, missingBundlePath);
  try {
    await assert.rejects(
      revalidatePreparedExecutionEnvironment(config, verified),
      { code: 'tcb_snapshot_mismatch' },
    );
    await assert.rejects(stat(bundlePath), { code: 'ENOENT' });
    assert.deepEqual(
      (await readdir(runDirectory)).sort(),
      runEntriesBefore.map((entry) =>
        entry === path.basename(bundlePath)
          ? path.basename(missingBundlePath)
          : entry
      ).sort(),
      'Read-only revalidation must not recreate or repair the missing Python bundle.',
    );
  } finally {
    await rm(bundlePath, { recursive: true, force: true });
    await rename(missingBundlePath, bundlePath);
  }

  await writeFile(modelWeightsPath, 'tampered model weights\n');
  await assert.rejects(revalidatePreparedExecutionEnvironment(config, verified), {
    code: 'pin_mismatch',
  });
  await writeFile(modelWeightsPath, 'model weights\n');

  const wrapperDirectory = path.join(root, 'wrapper');
  await mkdir(wrapperDirectory);
  const pythonWrapperPath = path.join(wrapperDirectory, 'python3.12');
  await writeFile(pythonWrapperPath, '#!/bin/sh\nprintf "Python 3.12.7\\n"\n');
  await chmod(pythonWrapperPath, 0o700);
  const pythonWrapper = await toolPin(pythonWrapperPath, ['--version']);
  const { version: _wrapperVersion, ...pythonWrapperExecutable } = pythonWrapper;
  const wrapperPythonConfig = structuredClone(config);
  wrapperPythonConfig.identity.toolchain.python = pythonWrapper;
  wrapperPythonConfig.adapter.executable = pythonWrapperExecutable;
  await assert.rejects(verifyExecutionEnvironment(wrapperPythonConfig), {
    code: 'python_runtime_not_macho',
  });

  const ffprobeWrapperPath = path.join(wrapperDirectory, 'ffprobe');
  await writeFile(ffprobeWrapperPath, '#!/bin/sh\nprintf "ffprobe version fixture\\n"\n');
  await chmod(ffprobeWrapperPath, 0o700);
  const wrapperFfprobeConfig = structuredClone(config);
  wrapperFfprobeConfig.identity.toolchain.ffprobe = await toolPin(
    ffprobeWrapperPath,
    ['-version'],
  );
  await assert.rejects(verifyExecutionEnvironment(wrapperFfprobeConfig), {
    code: 'ffprobe_not_macho',
  });

  const uvWrapperMarker = path.join(wrapperDirectory, 'uv-spawned');
  const uvWrapperPath = path.join(wrapperDirectory, 'uv');
  await writeFile(
    uvWrapperPath,
    `#!/bin/sh\nprintf spawned > ${JSON.stringify(uvWrapperMarker)}\nprintf 'uv 0.8.13\\n'\n`,
  );
  await chmod(uvWrapperPath, 0o700);
  const wrapperUvConfig = structuredClone(config);
  wrapperUvConfig.identity.toolchain.uv = {
    ...(await pinPath(uvWrapperPath)),
    version: 'uv 0.8.13',
  };
  await assert.rejects(verifyExecutionEnvironment(wrapperUvConfig), {
    code: 'uv_not_macho',
  });
  await assert.rejects(access(uvWrapperMarker), { code: 'ENOENT' });
}

test('verifies the complete effective engine, model, LM, adapter, and toolchain identity', async () => {
  if (process.platform === 'darwin') {
    await verifyRealDarwinExecutionEnvironment();
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-environment-'));
  const repository = path.join(root, 'engine');
  const harnessRepository = path.join(root, 'harness');
  const weights = path.join(root, 'model');
  const lmWeights = path.join(root, 'lm');
  const bin = path.join(root, 'bin');
  const pythonRuntime = path.join(root, 'python-runtime');
  const pythonBin = path.join(pythonRuntime, 'bin');
  const pythonLib = path.join(pythonRuntime, 'lib');
  const pythonVenv = path.join(root, 'python-venv');
  const pythonVenvBin = path.join(pythonVenv, 'bin');
  const pythonVenvSitePackages = path.join(
    pythonVenv,
    'lib',
    'python3.12',
    'site-packages',
  );
  const runDirectory = path.join(root, 'run');
  await mkdir(repository);
  await mkdir(harnessRepository);
  await mkdir(weights);
  await mkdir(lmWeights);
  await mkdir(bin);
  await mkdir(pythonRuntime);
  await mkdir(pythonBin);
  await mkdir(pythonLib);
  await mkdir(pythonVenvBin, { recursive: true });
  await mkdir(pythonVenvSitePackages, { recursive: true });
  await writeFile(path.join(pythonLib, 'runtime-marker'), 'fixture runtime\n');
  await writeFile(path.join(pythonVenvSitePackages, 'package-marker'), 'fixture package\n');
  await writeFile(
    path.join(pythonVenvSitePackages, '_virtualenv.py'),
    '# pinned virtualenv bootstrap module\n',
  );
  await writeFile(
    path.join(pythonVenvSitePackages, '_virtualenv.pth'),
    'import _virtualenv\n',
  );
  await writeFile(
    path.join(pythonVenv, 'pyvenv.cfg'),
    `home = ${pythonBin}\ninclude-system-site-packages = false\nversion = 3.12.7\n`,
  );
  await mkdir(runDirectory, { mode: 0o700 });
  await execFileAsync('git', ['init', '-q', repository]);
  await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Fixture']);
  await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'fixture@example.test']);
  await writeFile(path.join(repository, 'engine.py'), 'ENGINE = 1\n');
  await execFileAsync('git', ['-C', repository, 'add', 'engine.py']);
  await execFileAsync('git', ['-C', repository, 'commit', '-q', '-m', 'fixture']);
  const { stdout: head } = await execFileAsync('git', ['-C', repository, 'rev-parse', 'HEAD']);
  await execFileAsync('git', ['init', '-q', harnessRepository]);
  await execFileAsync('git', ['-C', harnessRepository, 'config', 'user.name', 'Fixture']);
  await execFileAsync('git', ['-C', harnessRepository, 'config', 'user.email', 'fixture@example.test']);
  await writeFile(path.join(harnessRepository, 'harness.mjs'), 'export const HARNESS = 1;\n');
  await execFileAsync('git', ['-C', harnessRepository, 'add', 'harness.mjs']);
  await execFileAsync('git', ['-C', harnessRepository, 'commit', '-q', '-m', 'fixture']);
  const { stdout: harnessHead } = await execFileAsync('git', [
    '-C',
    harnessRepository,
    'rev-parse',
    'HEAD',
  ]);
  await writeFile(path.join(weights, 'model.safetensors'), 'model-weights');
  await writeFile(path.join(lmWeights, 'lm.safetensors'), 'lm-weights');

  async function filePin(filePath, contents, { executable = false } = {}) {
    await writeFile(filePath, contents);
    if (executable) await chmod(filePath, 0o755);
    return {
      path: filePath,
      realpath: await realpath(filePath),
      sha256: sha256Receipt(contents),
    };
  }

  async function directoryPin(directory) {
    return {
      path: directory,
      realpath: await realpath(directory),
      sha256: await digestPath(directory),
    };
  }

  const fakePythonContents = `#!/bin/sh
if [ "$1" = "-I" ] && [ "$2" = "-S" ]; then printf '%s' "$5/$6.py" | /usr/bin/od -An -tx1 | /usr/bin/tr -d ' \\n'; printf '\\n'; exit 0; fi
runtime_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
case "$0" in *".lofiever-python-"*) [ -f "$runtime_root/lib/runtime-marker" ] || exit 97; [ -f "$VIRTUAL_ENV/pyvenv.cfg" ] || exit 98; [ -f "$VIRTUAL_ENV/lib/python3.12/site-packages/package-marker" ] || exit 99;; esac
printf "Python 3.12.7\\n"
`;
  const pythonBase = await filePin(
    path.join(pythonBin, 'python3'),
    fakePythonContents,
    { executable: true },
  );
  const pythonLauncher = path.join(pythonVenvBin, 'python3');
  await symlink(pythonBase.realpath, pythonLauncher);
  const python = {
    ...pythonBase,
    path: pythonLauncher,
    realpath: await realpath(pythonLauncher),
  };
  const uv = await filePin(path.join(bin, 'uv'), '#!/bin/sh\nprintf "uv 0.8.13\\n"\n', {
    executable: true,
  });
  const ffmpeg = await filePin(
    path.join(bin, 'ffmpeg'),
    '#!/bin/sh\nprintf "ffmpeg version 7.1\\n"\n',
    { executable: true },
  );
  const ffprobe = await filePin(
    path.join(bin, 'ffprobe'),
    '#!/bin/sh\nprintf "ffprobe version 7.1\\n"\n',
    { executable: true },
  );
  const node = {
    path: process.execPath,
    realpath: await realpath(process.execPath),
    sha256: await digestPath(await realpath(process.execPath)),
  };
  const { stdout: gitPathOutput } = await execFileAsync('/usr/bin/which', ['git']);
  const gitPath = gitPathOutput.trim();
  const gitRealpath = await realpath(gitPath);
  const { stdout: gitVersionOutput } = await execFileAsync(gitRealpath, ['--version']);
  const git = {
    path: gitPath,
    realpath: gitRealpath,
    sha256: await digestPath(gitRealpath),
    version: gitVersionOutput.trim(),
  };
  const script = await filePin(path.join(root, 'adapter.py'), '# fixture adapter\n');
  const config = {
    identity: {
      benchmarkId: 'fixture-linux-evidence',
      host: await observeHostIdentity(),
      engine: {
        name: 'fixture-engine',
        repositoryPath: repository,
        repoCommit: head.trim(),
      },
      model: {
        id: 'fixture-model',
        revision: '1'.repeat(40),
        weights: await directoryPin(weights),
        lm: {
          id: 'fixture-lm',
          revision: '2'.repeat(40),
          weights: await directoryPin(lmWeights),
        },
      },
      toolchain: {
        git,
        node: { ...node, version: process.version },
        python: { ...python, version: 'Python 3.12.7' },
        uv: { ...uv, version: 'uv 0.8.13' },
        ffmpeg: { ...ffmpeg, version: 'ffmpeg version 7.1' },
        ffprobe: { ...ffprobe, version: 'ffprobe version 7.1' },
      },
      runtime: {
        device: 'mps',
        lmBackend: 'mlx',
        vaeChunk: 8,
        harnessRepositoryPath: harnessRepository,
        harnessCommit: harnessHead.trim(),
        harnessClean: null,
        runDirectory,
        serverCommit: null,
      },
    },
    adapter: {
      kind: 'persistent-jsonl-v1',
      workingDirectory: repository,
      executable: python,
      script,
      requestTimeoutSeconds: 30,
      terminateGraceSeconds: 1,
      maxOutputBytes: 1024,
    },
  };

  const verified = await verifyExecutionEnvironment(config);
  assert.equal(verified.identity.engine.clean, true);
  assert.equal(verified.identity.runtime.harnessClean, true);
  assert.equal(verified.identity.runtime.runDirectory, await realpath(runDirectory));
  const runStats = await stat(runDirectory);
  assert.deepEqual(verified.identity.runtime.runDirectoryIdentity, {
    realpath: await realpath(runDirectory),
    device: String(runStats.dev),
    inode: String(runStats.ino),
    parent: verified.identity.runtime.runDirectoryIdentity.parent,
  });
  assert.equal(
    verified.identity.runtime.runDirectoryIdentity.parent.realpath,
    await realpath(root),
  );
  assert.equal(verified.identity.model.weights.sha256, config.identity.model.weights.sha256);
  assert.equal(verified.identity.model.lm.weights.sha256, config.identity.model.lm.weights.sha256);
  assert.equal(verified.identity.toolchain.python.version, 'Python 3.12.7');
  assert.equal(verified.identity.toolchain.git.version, git.version);
  assert.equal(verified.identity.toolchain.node.version, process.version);
  assert.equal(verified.identity.toolchain.ffprobe.version, 'ffprobe version 7.1');
  assert.notEqual(verified.adapter.executable.realpath, python.realpath);
  assert.notEqual(verified.adapter.script.realpath, script.realpath);
  assert.notEqual(verified.identity.toolchain.ffprobe.realpath, ffprobe.realpath);
  for (const snapshot of [verified.adapter.script, verified.identity.toolchain.ffprobe]) {
    assert.equal(path.dirname(snapshot.realpath), await realpath(runDirectory));
  }
  assert.equal(
    path.relative(await realpath(runDirectory), verified.adapter.executable.realpath).startsWith('..'),
    false,
  );
  assert.equal(
    verified.adapter.pythonRuntime.sourceLibrary.sha256,
    verified.adapter.pythonRuntime.snapshotLibrary.sha256,
  );
  assert.notEqual(verified.adapter.pythonRuntime.virtualEnvironment, null);
  assert.equal(
    verified.adapter.pythonRuntime.virtualEnvironment.sitePackages.sha256,
    verified.adapter.pythonRuntime.virtualEnvironment.snapshotSitePackages.sha256,
  );
  assert.match(
    verified.adapter.pythonRuntime.virtualEnvironment.snapshotRootRealpath,
    /\.lofiever-python-[a-f0-9]{64}\/venv$/u,
  );
  assert.equal(verified.adapter.executable.sha256, python.sha256);
  assert.equal(verified.adapter.script.sha256, script.sha256);
  assert.equal(verified.identity.toolchain.ffprobe.sha256, ffprobe.sha256);
  assert.equal(verified.identity.toolchain.ffprobe.dynamicLinker.format, 'not-mach-o');
  assert.equal(verified.adapter.dynamicLinker.format, 'not-mach-o');
  assert.match(verified.environmentSha256, /^sha256:[a-f0-9]{64}$/);
  const { stdout: snapshottedPythonVersion } = await execFileAsync(
    verified.adapter.executable.realpath,
    ['--version'],
    { env: verified.processEnvironment },
  );
  assert.equal(snapshottedPythonVersion.trim(), 'Python 3.12.7');
  assert.equal(verified.processEnvironment.PYTHONSAFEPATH, '1');
  assert.equal(
    verified.identity.environment.some(({ name }) => name === 'PYTHONSAFEPATH'),
    true,
  );
  const evidenceRevalidation = await revalidatePreparedExecutionEnvironment(config, verified);
  assert.equal(
    evidenceRevalidation.adapter.dynamicLinker.closureSha256,
    verified.adapter.dynamicLinker.closureSha256,
  );

  await writeFile(path.join(weights, 'model.safetensors'), 'tampered-model-weights');
  await assert.rejects(revalidatePreparedExecutionEnvironment(config, verified), {
    code: 'pin_mismatch',
  });
  await writeFile(path.join(weights, 'model.safetensors'), 'model-weights');

  await chmod(verified.adapter.script.realpath, 0o600);
  await writeFile(verified.adapter.script.realpath, '# tampered snapshot\n');
  await assert.rejects(verifyExecutionEnvironment(config), {
    code: 'tcb_snapshot_mismatch',
  });
  await writeFile(verified.adapter.script.realpath, '# fixture adapter\n');
  await chmod(verified.adapter.script.realpath, 0o400);

  const wrongWorkingDirectory = structuredClone(config);
  wrongWorkingDirectory.adapter.workingDirectory = harnessRepository;
  await assert.rejects(verifyExecutionEnvironment(wrongWorkingDirectory), {
    code: 'adapter_working_directory_mismatch',
  });

  const externalPackages = path.join(root, 'external-packages');
  await mkdir(externalPackages);
  const externalPathFile = path.join(pythonVenvSitePackages, 'external-editable.pth');
  for (const contents of [
    `${externalPackages}\n`,
    `${path.relative(pythonVenvSitePackages, externalPackages)}\n`,
    `import sys; sys.path.append(${JSON.stringify(externalPackages)})\n`,
    'import missing_bootstrap\n',
  ]) {
    await writeFile(externalPathFile, contents);
    await assert.rejects(verifyExecutionEnvironment(config), {
      code: 'python_path_configuration_external',
    });
  }
  await unlink(externalPathFile);

  for (const unsupportedVersion of ['Python 3.10.14', 'Python 3.13.0']) {
    const unsupported = structuredClone(config);
    const contents = `#!/bin/sh\nprintf "${unsupportedVersion}\\n"\n`;
    const unsupportedPin = await filePin(python.path, contents, { executable: true });
    unsupported.identity.toolchain.python = {
      ...unsupportedPin,
      version: unsupportedVersion,
    };
    unsupported.adapter.executable = unsupportedPin;
    await assert.rejects(verifyExecutionEnvironment(unsupported), {
      code: 'unsupported_python_version',
    });
  }

  await filePin(
    python.path,
    fakePythonContents,
    {
      executable: true,
    },
  );
  const originalRunIdentity = verified.identity.runtime.runDirectoryIdentity;
  await rename(runDirectory, `${runDirectory}-original`);
  await mkdir(runDirectory, { mode: 0o700 });
  const replacedRun = await verifyExecutionEnvironment(config);
  assert.notDeepEqual(replacedRun.identity.runtime.runDirectoryIdentity, originalRunIdentity);

  await writeFile(path.join(harnessRepository, 'untracked.txt'), 'dirty\n');
  await assert.rejects(verifyExecutionEnvironment(config), (error) => {
    assert.equal(error.code, 'harness_worktree_dirty');
    return true;
  });
});
