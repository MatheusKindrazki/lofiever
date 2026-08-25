import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  assertExecutableBenchmarkConfig,
  expandMatrix,
  parseBenchmarkConfig,
  parseMatrix,
} from './config.mjs';
import { MAX_ADAPTER_OUTPUT_BYTES } from './limits.mjs';

const execFileAsync = promisify(execFile);

function dryRunConfig() {
  return {
    schemaVersion: '1.0.0',
    benchmarkId: 'dry-run-example',
    matrixFile: './config/lofiever-spike-matrix.v1.json',
    host: { machine: 'm5max-128gb', chip: null, memoryBytes: null, osVersion: null },
    engine: {
      name: 'ace-step-1.5',
      repositoryPath: null,
      repoCommit: '14c0211d5a0653b0f63e27686f4c3f151b4d8629',
    },
    model: {
      id: 'dry-run-no-model',
      revision: 'not-installed',
      weights: null,
      lm: {
        id: 'acestep-5Hz-lm-0.6B',
        revision: 'not-installed',
        weights: null,
      },
    },
    runtime: {
      device: 'mps',
      lmBackend: 'mlx',
      vaeChunk: null,
      serverCommit: null,
      runDirectory: null,
    },
    adapter: {
      kind: 'persistent-jsonl-v1',
      workingDirectory: null,
      executable: null,
      script: null,
      requestTimeoutSeconds: 900,
      terminateGraceSeconds: 5,
      maxOutputBytes: 1048576,
    },
    toolchain: {
      git: null,
      node: null,
      python: null,
      uv: null,
      ffmpeg: null,
      ffprobe: null,
    },
    energyCollection: { source: 'none' },
  };
}

test('expands the canonical Lofiever matrix in safe batch-escalation order', () => {
  const matrix = parseMatrix({
    schemaVersion: '1.0.0',
    durationSeconds: [150, 180, 184],
    batchSize: [1, 2, 4],
    warmup: 1,
    repetitions: 3,
  });

  assert.deepEqual(expandMatrix(matrix), [
    { durationSeconds: 150, batchSizeRequested: 1 },
    { durationSeconds: 180, batchSizeRequested: 1 },
    { durationSeconds: 184, batchSizeRequested: 1 },
    { durationSeconds: 150, batchSizeRequested: 2 },
    { durationSeconds: 180, batchSizeRequested: 2 },
    { durationSeconds: 184, batchSizeRequested: 2 },
    { durationSeconds: 150, batchSizeRequested: 4 },
    { durationSeconds: 180, batchSizeRequested: 4 },
    { durationSeconds: 184, batchSizeRequested: 4 },
  ]);
});

test('accepts only the fixed persistent adapter protocol and retains every requested pin', () => {
  const config = parseBenchmarkConfig(dryRunConfig(), {
    harnessCommit: '33818676f75b861e56f15a8de145929141919bc4',
  });

  assert.equal(config.identity.runtime.harnessCommit, '33818676f75b861e56f15a8de145929141919bc4');
  assert.equal(config.adapter.kind, 'persistent-jsonl-v1');
  assert.equal(config.identity.model.lm.id, 'acestep-5Hz-lm-0.6B');
  assert.deepEqual(config.identity.toolchain, {
    git: null,
    node: null,
    python: null,
    uv: null,
    ffmpeg: null,
    ffprobe: null,
  });
  assert.throws(() => assertExecutableBenchmarkConfig(config), {
    name: 'BenchmarkConfigError',
  });
});

test('execute rejects floating revisions and requires observed host identity, VAE chunk, tools, and a private run directory', () => {
  const parsed = parseBenchmarkConfig(dryRunConfig(), {
    harnessCommit: '33818676f75b861e56f15a8de145929141919bc4',
    harnessRepositoryPath: '/fixture/harness',
  });
  parsed.identity.model.id = 'fixture-model';
  parsed.identity.engine.repositoryPath = '/fixture/engine';
  parsed.identity.model.revision = 'latest';
  parsed.identity.model.weights = {
    path: '/fixture/model',
    realpath: '/fixture/model',
    sha256: `sha256:${'1'.repeat(64)}`,
  };
  parsed.identity.model.lm.revision = 'main';
  parsed.identity.model.lm.weights = {
    path: '/fixture/lm',
    realpath: '/fixture/lm',
    sha256: `sha256:${'2'.repeat(64)}`,
  };
  parsed.adapter.workingDirectory = '/fixture/engine';
  parsed.adapter.executable = parsed.identity.model.weights;
  parsed.adapter.script = parsed.identity.model.lm.weights;
  parsed.identity.runtime.device = 'cpu';
  parsed.identity.runtime.lmBackend = 'torch';

  assert.throws(() => assertExecutableBenchmarkConfig(parsed), (error) => {
    assert.equal(error.name, 'BenchmarkConfigError');
    assert.deepEqual(
      error.issues.map((issue) => issue.path),
      [
        '$.host.chip',
        '$.host.memoryBytes',
        '$.host.osVersion',
        '$.model.revision',
        '$.model.lm.revision',
        '$.runtime.device',
        '$.runtime.lmBackend',
        '$.runtime.vaeChunk',
        '$.runtime.runDirectory',
        '$.toolchain.git',
        '$.toolchain.node',
        '$.toolchain.python',
        '$.toolchain.uv',
        '$.toolchain.ffmpeg',
        '$.toolchain.ffprobe',
      ],
    );
    return true;
  });
});

test('rejects a generic command executor even when it avoids a literal sudo argv[0]', () => {
  const input = dryRunConfig();
  delete input.adapter;
  input.executor = {
    kind: 'command',
    workingDirectory: '/tmp',
    command: ['/usr/bin/env', 'sh', '-c', 'sudo benchmark'],
    environment: {},
  };

  assert.throws(
    () =>
      parseBenchmarkConfig(input, {
        harnessCommit: '33818676f75b861e56f15a8de145929141919bc4',
      }),
    { name: 'BenchmarkConfigError' },
  );
});

test('builds an executable config recipe without installing or invoking model weights', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lofiever-config-recipe-'));
  const engine = path.join(root, 'engine');
  const runParent = path.join(root, 'lofigen');
  const runDirectory = path.join(runParent, 'run');
  const bin = path.join(root, 'bin');
  await mkdir(engine);
  await mkdir(runParent, { mode: 0o700 });
  await mkdir(runDirectory, { mode: 0o700 });
  await mkdir(bin);
  const modelWeights = path.join(root, 'model.bin');
  const lmWeights = path.join(root, 'lm.bin');
  const adapterScript = path.join(root, 'adapter.py');
  await writeFile(modelWeights, 'model fixture');
  await writeFile(lmWeights, 'lm fixture');
  await writeFile(adapterScript, '# reviewed fixture adapter\n');

  async function fakeTool(name, version) {
    const tool = path.join(bin, name);
    await writeFile(tool, `#!/bin/sh\nprintf '${version}\\n'\n`);
    await chmod(tool, 0o700);
    return tool;
  }

  const output = path.join(root, 'execute-config.json');
  const preparePath = new URL('./config/prepare-execute-config.mjs', import.meta.url).pathname;
  let recipePython = await fakeTool('python3', 'Python 3.12.7');
  let recipeUv = await fakeTool('uv', 'uv 0.8.13');
  let recipeFfprobe = await fakeTool('ffprobe', 'ffprobe version fixture');
  if (process.platform === 'darwin') {
    recipeUv = process.env.LOFIEVER_TEST_UV ??
      '/Users/matheuskindrazki/.local/bin/uv';
    const { stdout: managedPython } = await execFileAsync(
      recipeUv,
      ['python', 'find', '--managed-python', '--no-python-downloads', '--no-project', '3.12'],
      { encoding: 'utf8' },
    );
    recipePython = managedPython.trim();
    recipeFfprobe = process.env.LOFIEVER_TEST_FFPROBE ?? '/opt/homebrew/bin/ffprobe';
  }
  const recipeEnvironment = {
      ...process.env,
      LOFIEVER_BENCHMARK_ID: 'fixture-execute-recipe',
      LOFIEVER_ENGINE_REPOSITORY: engine,
      LOFIEVER_MODEL_ID: 'fixture-model',
      LOFIEVER_MODEL_REVISION: '1'.repeat(40),
      LOFIEVER_MODEL_WEIGHTS: modelWeights,
      LOFIEVER_LM_ID: 'fixture-lm',
      LOFIEVER_LM_REVISION: '2'.repeat(40),
      LOFIEVER_LM_WEIGHTS: lmWeights,
      LOFIEVER_VAE_CHUNK: '8',
      LOFIEVER_RUN_DIRECTORY: runDirectory,
      LOFIEVER_ADAPTER_SCRIPT: adapterScript,
      LOFIEVER_GIT: await fakeTool('git', 'git version fixture'),
      LOFIEVER_PYTHON: recipePython,
      LOFIEVER_UV: recipeUv,
      LOFIEVER_FFMPEG: await fakeTool('ffmpeg', 'ffmpeg version fixture'),
      LOFIEVER_FFPROBE: recipeFfprobe,
  };
  await execFileAsync(process.execPath, [preparePath, '--output', output], {
    env: recipeEnvironment,
  });

  const raw = JSON.parse(await readFile(output, 'utf8'));
  const parsed = parseBenchmarkConfig(raw, {
    harnessCommit: '33818676f75b861e56f15a8de145929141919bc4',
    harnessRepositoryPath: '/fixture/harness',
  });
  assert.doesNotThrow(() => assertExecutableBenchmarkConfig(parsed));
  if (process.platform === 'darwin') {
    assert.match(raw.host.osVersion, /^macOS \S+ \(\S+\)$/u);
  }
  assert.equal(raw.runtime.vaeChunk, 8);
  assert.equal(raw.engine.repositoryPath, await realpath(engine));
  assert.equal(raw.adapter.workingDirectory, await realpath(engine));
  assert.equal(raw.adapter.executable.realpath, raw.toolchain.python.realpath);
  assert.deepEqual(
    parseMatrix(JSON.parse(await readFile(raw.matrixFile, 'utf8'))).batchSize,
    [1, 2, 4],
  );

  const boundaryOutput = path.join(root, 'max-output-boundary.json');
  await execFileAsync(process.execPath, [preparePath, '--output', boundaryOutput], {
    env: {
      ...recipeEnvironment,
      LOFIEVER_MAX_OUTPUT_BYTES: String(MAX_ADAPTER_OUTPUT_BYTES),
    },
  });
  assert.equal(
    JSON.parse(await readFile(boundaryOutput, 'utf8')).adapter.maxOutputBytes,
    MAX_ADAPTER_OUTPUT_BYTES,
  );
  const oversizedOutput = path.join(root, 'max-output-oversized.json');
  await assert.rejects(
    execFileAsync(process.execPath, [preparePath, '--output', oversizedOutput], {
      env: {
        ...recipeEnvironment,
        LOFIEVER_MAX_OUTPUT_BYTES: String(MAX_ADAPTER_OUTPUT_BYTES + 1),
      },
    }),
  );
  await assert.rejects(readFile(oversizedOutput), { code: 'ENOENT' });

  const missingVaeChunkOutput = path.join(root, 'missing-vae-chunk.json');
  const { LOFIEVER_VAE_CHUNK: _missingVaeChunk, ...missingVaeChunkEnvironment } =
    recipeEnvironment;
  await assert.rejects(
    execFileAsync(process.execPath, [preparePath, '--output', missingVaeChunkOutput], {
      env: missingVaeChunkEnvironment,
    }),
    (error) => {
      assert.match(String(error.stderr), /Missing required environment variable LOFIEVER_VAE_CHUNK/u);
      return true;
    },
  );
  await assert.rejects(readFile(missingVaeChunkOutput), { code: 'ENOENT' });

  const invalidEnvironmentValues = [
    ['LOFIEVER_VAE_CHUNK', 'garbage'],
    ['LOFIEVER_VAE_CHUNK', '1.5'],
    ['LOFIEVER_REQUEST_TIMEOUT_SECONDS', 'garbage'],
    ['LOFIEVER_REQUEST_TIMEOUT_SECONDS', '0x10'],
    ['LOFIEVER_REQUEST_TIMEOUT_SECONDS', '0'],
    ['LOFIEVER_TERMINATE_GRACE_SECONDS', ' 5 '],
    ['LOFIEVER_TERMINATE_GRACE_SECONDS', 'Infinity'],
    ['LOFIEVER_MAX_OUTPUT_BYTES', '1.5'],
    ['LOFIEVER_ENERGY_SOURCE', 'typo'],
    ['LOFIEVER_SERVER_COMMIT', 'main'],
    ['LOFIEVER_DEVICE', '   '],
    ['LOFIEVER_DEVICE', 'msp'],
    ['LOFIEVER_DEVICE', 'mps '],
    ['LOFIEVER_LM_BACKEND', 'ml'],
    ['LOFIEVER_LM_BACKEND', 'mlx '],
    ['LOFIEVER_MODEL_REVISION', 'latest'],
    ['DYLD_LIBRARY_PATH', '/tmp/evil'],
  ];
  for (const [name, value] of invalidEnvironmentValues) {
    const invalidOutput = path.join(root, `invalid-${name}-${value.replaceAll(/\W/gu, '_')}.json`);
    await assert.rejects(
      execFileAsync(process.execPath, [preparePath, '--output', invalidOutput], {
        env: { ...recipeEnvironment, [name]: value },
      }),
      (error) => {
        assert.notEqual(error.code, 0, `${name}=${value} must fail closed`);
        return true;
      },
    );
    await assert.rejects(readFile(invalidOutput), { code: 'ENOENT' });
  }

  const unsafeEnvironmentMarker = path.join(root, 'unsafe-environment-tool-spawned');
  const markerGit = path.join(bin, 'marker-git');
  await writeFile(
    markerGit,
    `#!/bin/sh\nprintf spawned > ${JSON.stringify(unsafeEnvironmentMarker)}\nprintf 'git version fixture\\n'\n`,
  );
  await chmod(markerGit, 0o700);
  const unsafeEnvironmentOutput = path.join(root, 'unsafe-loader-environment.json');
  await assert.rejects(
    execFileAsync(process.execPath, [preparePath, '--output', unsafeEnvironmentOutput], {
      env: {
        ...recipeEnvironment,
        LOFIEVER_GIT: markerGit,
        DYLD_LIBRARY_PATH: '/tmp/evil',
      },
    }),
  );
  await assert.rejects(readFile(unsafeEnvironmentMarker), { code: 'ENOENT' });
  await assert.rejects(readFile(unsafeEnvironmentOutput), { code: 'ENOENT' });

  const unsupportedPython = await fakeTool('python3.14', 'Python 3.14.0');
  const unsupportedOutput = path.join(root, 'unsupported-python.json');
  await assert.rejects(
    execFileAsync(process.execPath, [preparePath, '--output', unsupportedOutput], {
      env: { ...recipeEnvironment, LOFIEVER_PYTHON: unsupportedPython },
    }),
  );
  await assert.rejects(readFile(unsupportedOutput), { code: 'ENOENT' });

  if (process.platform === 'darwin') {
    const wrapperPython = await fakeTool('python3-wrapper', 'Python 3.12.7');
    const wrapperOutput = path.join(root, 'wrapper-python.json');
    await assert.rejects(
      execFileAsync(process.execPath, [preparePath, '--output', wrapperOutput], {
        env: { ...recipeEnvironment, LOFIEVER_PYTHON: wrapperPython },
      }),
      (error) => {
        assert.match(String(error.stderr), /python_runtime_not_macho|native Mach-O/u);
        return true;
      },
    );
    await assert.rejects(readFile(wrapperOutput), { code: 'ENOENT' });

    const wrapperFfprobe = await fakeTool('ffprobe-wrapper', 'ffprobe version fixture');
    const wrapperFfprobeOutput = path.join(root, 'wrapper-ffprobe.json');
    await assert.rejects(
      execFileAsync(process.execPath, [preparePath, '--output', wrapperFfprobeOutput], {
        env: { ...recipeEnvironment, LOFIEVER_FFPROBE: wrapperFfprobe },
      }),
      (error) => {
        assert.match(String(error.stderr), /ffprobe_not_macho|native Mach-O/u);
        return true;
      },
    );
    await assert.rejects(readFile(wrapperFfprobeOutput), { code: 'ENOENT' });

    const wrapperUvMarker = path.join(root, 'wrapper-uv-spawned');
    const wrapperUv = path.join(bin, 'uv-wrapper');
    await writeFile(
      wrapperUv,
      `#!/bin/sh\nprintf spawned > ${JSON.stringify(wrapperUvMarker)}\nprintf 'uv 0.8.13\\n'\n`,
    );
    await chmod(wrapperUv, 0o700);
    const wrapperUvOutput = path.join(root, 'wrapper-uv.json');
    await assert.rejects(
      execFileAsync(process.execPath, [preparePath, '--output', wrapperUvOutput], {
        env: { ...recipeEnvironment, LOFIEVER_UV: wrapperUv },
      }),
      (error) => {
        assert.match(String(error.stderr), /uv_not_macho|native Mach-O/u);
        return true;
      },
    );
    await assert.rejects(readFile(wrapperUvMarker), { code: 'ENOENT' });
    await assert.rejects(readFile(wrapperUvOutput), { code: 'ENOENT' });

    const homebrewOutput = path.join(root, 'homebrew-python.json');
    await assert.rejects(
      execFileAsync(process.execPath, [preparePath, '--output', homebrewOutput], {
        env: {
          ...recipeEnvironment,
          LOFIEVER_PYTHON: '/opt/homebrew/bin/python3.11',
        },
      }),
      (error) => {
        assert.match(
          String(error.stderr),
          /python_framework_launcher_not_supported|framework Python/u,
        );
        return true;
      },
    );
    await assert.rejects(readFile(homebrewOutput), { code: 'ENOENT' });

    const uvExecutable = process.env.LOFIEVER_TEST_UV ??
      '/Users/matheuskindrazki/.local/bin/uv';
    const { stdout: uvPython } = await execFileAsync(
      uvExecutable,
      ['python', 'find', '3.12'],
      { encoding: 'utf8' },
    );
    const uvOutput = path.join(root, 'uv-python.json');
    await execFileAsync(process.execPath, [preparePath, '--output', uvOutput], {
      env: {
        ...recipeEnvironment,
        LOFIEVER_PYTHON: uvPython.trim(),
        LOFIEVER_UV: uvExecutable,
      },
    });
    const uvConfig = JSON.parse(await readFile(uvOutput, 'utf8'));
    assert.match(uvConfig.toolchain.python.version, /^Python 3\.12\./u);

    const exactPatch = '3.12.9';
    const { stdout: exactPatchPython } = await execFileAsync(
      uvExecutable,
      ['python', 'find', '--managed-python', '--no-python-downloads', '--no-project', exactPatch],
      { encoding: 'utf8' },
    );
    const exactPatchOutput = path.join(root, 'uv-python-exact-patch.json');
    await execFileAsync(process.execPath, [preparePath, '--output', exactPatchOutput], {
      env: {
        ...recipeEnvironment,
        LOFIEVER_PYTHON: exactPatchPython.trim(),
        LOFIEVER_UV: uvExecutable,
      },
    });
    const exactPatchConfig = JSON.parse(await readFile(exactPatchOutput, 'utf8'));
    assert.match(exactPatchConfig.toolchain.python.version, /^Python 3\.12\.9(?:\s|$)/u);
  }
});
