import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
import test, { after, before } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { runCli as runCliProduction } from './cli.mjs';
import { createConfinedOutputStore } from './confined-output-store.mjs';
import { acquireConfinedRunLock } from './confined-run-lock.mjs';
import { captureExecutableClosure } from './dynamic-linker.mjs';
import { digestPath } from './integrity.mjs';
import {
  createDryRunManifest,
  deriveConfiguration,
  serializeManifest,
  sha256Receipt,
  validateManifest,
} from './manifest.mjs';
import { acquireRunLock } from './storage.mjs';

const execFileAsync = promisify(execFile);
const toolDirectory = new URL('.', import.meta.url).pathname;
const cliPath = path.join(toolDirectory, 'cli.mjs');
const configPath = path.join(toolDirectory, 'config', 'dry-run.example.json');
const matrixPath = path.join(toolDirectory, 'config', 'lofiever-spike-matrix.v1.json');
const fakeAdapterPath = path.join(toolDirectory, 'fixtures', 'fake-persistent-adapter.py');
const closureCache = new Map();
const operationalLockPrefix = `lofiever-local-music-metal-${process.getuid?.() ?? 'unknown'}.lock`;
let operationalLockInventoryBefore;

async function canonicalTemp(templatePath) {
  return realpath(await mkdtemp(templatePath));
}

function closeFailingOutputStoreFactory(code = 'fixture_output_store_close_failed') {
  return async (directory) => {
    const store = await createConfinedOutputStore(directory);
    return new Proxy(store, {
      get(target, property, receiver) {
        if (property !== 'close') return Reflect.get(target, property, receiver);
        return async () => {
          await target.close();
          const error = new Error('Fixture confined helper close failed after shutdown.');
          error.code = code;
          throw error;
        };
      },
    });
  };
}

async function operationalLockInventory() {
  if (typeof process.getuid !== 'function') return [];
  const names = (await readdir('/tmp'))
    .filter((name) => name.startsWith(operationalLockPrefix))
    .sort();
  return Promise.all(names.map(async (name) => {
    const filePath = path.join('/tmp', name);
    const metadata = await lstat(filePath);
    return {
      name,
      device: String(metadata.dev),
      inode: String(metadata.ino),
      mode: metadata.mode,
      size: metadata.size,
      sha256: metadata.isFile()
        ? createHash('sha256').update(await readFile(filePath)).digest('hex')
        : null,
    };
  }));
}

before(async () => {
  operationalLockInventoryBefore = await operationalLockInventory();
});

after(async () => {
  assert.deepEqual(
    await operationalLockInventory(),
    operationalLockInventoryBefore,
    'CLI tests must not create, remove, or replace the operational machine lock.',
  );
});

async function runCli(argv, options = {}) {
  const effectiveOptions = { ...options };
  if (
    (argv.includes('--execute') || argv.includes('--validate-evidence')) &&
    effectiveOptions.revalidateExecutionEnvironment === undefined &&
    effectiveOptions.verifyExecutionEnvironment !== undefined
  ) {
    effectiveOptions.revalidateExecutionEnvironment = async (config) =>
      effectiveOptions.verifyExecutionEnvironment(config);
  }
  if (
    argv.includes('--validate-evidence') &&
    effectiveOptions.revalidateExecutionEnvironment === undefined
  ) {
    effectiveOptions.revalidateExecutionEnvironment = fixtureVerifier;
  }
  if (!argv.includes('--execute')) return runCliProduction(argv, effectiveOptions);
  const configIndex = argv.indexOf('--config');
  assert.notEqual(configIndex, -1, 'Execute tests require a config path for lock isolation.');
  const configFile = path.resolve(argv[configIndex + 1]);
  const machineLockPath =
    effectiveOptions.machineLockPath ?? path.join(path.dirname(configFile), '.test-machine-metal');
  return runCliProduction(argv, { ...effectiveOptions, machineLockPath });
}

async function cachedClosure(pin) {
  const key = `${pin.realpath}:${pin.sha256}`;
  if (!closureCache.has(key)) closureCache.set(key, captureExecutableClosure(pin));
  return closureCache.get(key);
}

test('CLI evidence requires a trusted config before reading or probing a manifest', async () => {
  let provenanceChecks = 0;
  await assert.rejects(
    runCli(
      [
        '--validate-evidence',
        '/definitely/not/a/manifest.json',
        '--output',
        '/definitely/not/an/output',
      ],
      {
        io: { stdout: () => {}, stderr: () => {} },
        revalidateExecutionEnvironment: async () => {
          provenanceChecks += 1;
        },
      },
    ),
    /--validate-evidence requires --config/u,
  );
  assert.equal(provenanceChecks, 0);
});

test('CLI dry-run derives harness identity without executing git from PATH', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-path-git-'));
  const outputDirectory = path.join(root, 'output');
  const hostileBin = path.join(root, 'bin');
  const marker = path.join(root, 'path-git-spawned');
  await mkdir(outputDirectory, { mode: 0o700 });
  await mkdir(hostileBin);
  const hostileGit = path.join(hostileBin, 'git');
  await writeFile(
    hostileGit,
    `#!/bin/sh\nprintf spawned > ${JSON.stringify(marker)}\nexec /usr/bin/git "$@"\n`,
  );
  await chmod(hostileGit, 0o700);

  await execFileAsync(
    process.execPath,
    [
      cliPath,
      '--config',
      configPath,
      '--output',
      outputDirectory,
      '--dry-run',
      '--cell',
      '150:1',
    ],
    { env: { ...process.env, PATH: `${hostileBin}:${process.env.PATH ?? ''}` } },
  );
  await assert.rejects(stat(marker), { code: 'ENOENT' });
});

test('CLI evidence rejects an intermediate symlink before loading trusted config', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-evidence-symlink-'));
  const outputDirectory = path.join(root, 'output');
  const outsideDirectory = path.join(root, 'outside');
  await mkdir(outputDirectory, { mode: 0o700 });
  await mkdir(outsideDirectory, { mode: 0o700 });
  const outsideManifest = path.join(outsideDirectory, 'manifest.json');
  await writeFile(outsideManifest, await readFile(
    path.join(toolDirectory, 'fixtures', 'dry-run-manifest.v1.json'),
  ));
  await symlink(outsideDirectory, path.join(outputDirectory, 'manifests'));
  let provenanceChecks = 0;
  await assert.rejects(
    runCli(
      [
        '--validate-evidence',
        path.join(outputDirectory, 'manifests', 'manifest.json'),
        '--config',
        '/trusted/config/must-not-be-opened.json',
        '--output',
        outputDirectory,
      ],
      {
        io: { stdout: () => {}, stderr: () => {} },
        revalidateExecutionEnvironment: async () => {
          provenanceChecks += 1;
        },
      },
    ),
    (error) => {
      assert.match(error.code, /confined|private_directory/u);
      return true;
    },
  );
  assert.equal(provenanceChecks, 0);
});

test('CLI dry-run refuses a manifests symlink without touching the external target', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-dry-run-symlink-'));
  const outputDirectory = path.join(root, 'output');
  const outsideDirectory = path.join(root, 'outside');
  const outsideManifest = path.join(outsideDirectory, 'd150-b1.json');
  const sentinel = 'external sentinel must remain byte-identical\n';
  await mkdir(outputDirectory, { mode: 0o700 });
  await mkdir(outsideDirectory, { mode: 0o700 });
  await writeFile(outsideManifest, sentinel);
  await symlink(outsideDirectory, path.join(outputDirectory, 'manifests'));

  await assert.rejects(
    runCli([
      '--config',
      configPath,
      '--output',
      outputDirectory,
      '--dry-run',
      '--cell',
      '150:1',
    ], { io: { stdout: () => {}, stderr: () => {} } }),
    (error) => {
      assert.match(error.code, /confined|manifest_store/u);
      return true;
    },
  );
  assert.equal(await readFile(outsideManifest, 'utf8'), sentinel);
  assert.deepEqual(await readdir(outsideDirectory), ['d150-b1.json']);
});

test('CLI dry-run emits all nine deterministic manifests through the atomic writer', async () => {
  const outputDirectory = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-benchmark-cli-'));
  const args = [cliPath, '--config', configPath, '--output', outputDirectory, '--dry-run'];

  execFileSync(process.execPath, args, { stdio: 'pipe' });
  const manifestDirectory = path.join(outputDirectory, 'manifests');
  const names = (await readdir(manifestDirectory)).sort();
  assert.deepEqual(names, [
    'd150-b1.json',
    'd150-b2.json',
    'd150-b4.json',
    'd180-b1.json',
    'd180-b2.json',
    'd180-b4.json',
    'd184-b1.json',
    'd184-b2.json',
    'd184-b4.json',
  ]);
  const firstBytes = new Map();
  for (const name of names) {
    const bytes = await readFile(path.join(manifestDirectory, name), 'utf8');
    firstBytes.set(name, bytes);
    const manifest = JSON.parse(bytes);
    assert.equal(validateManifest(manifest).success, true);
    assert.equal(manifest.executionMode, 'dry-run');
    assert.equal(manifest.repetitions.length, 3);
  }

  execFileSync(process.execPath, args, { stdio: 'pipe' });
  for (const name of names) {
    assert.equal(
      await readFile(path.join(manifestDirectory, name), 'utf8'),
      firstBytes.get(name),
    );
  }
  assert.deepEqual(
    (await readdir(manifestDirectory)).filter((name) => name.includes('.tmp-')),
    [],
  );
});

test('CLI dry-run shares the confined session lock and never replaces existing evidence', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-dryrun-session-lock-'));
  const outputDirectory = path.join(root, 'output');
  await mkdir(outputDirectory, { mode: 0o700 });
  const store = await createConfinedOutputStore(outputDirectory);
  const lock = await acquireConfinedRunLock(store, 'benchmark-run');
  try {
    await assert.rejects(
      runCli(
        [
          '--config',
          configPath,
          '--output',
          outputDirectory,
          '--dry-run',
          '--cell',
          '150:1',
        ],
        { io: { stdout: () => {}, stderr: () => {} } },
      ),
      { code: 'benchmark_locked' },
    );
    await assert.rejects(stat(path.join(outputDirectory, 'manifests')), { code: 'ENOENT' });
    await assert.rejects(
      stat(path.join(outputDirectory, 'benchmark-index.v1.json')),
      { code: 'ENOENT' },
    );
  } finally {
    store.bindTerminalRelease(await lock.prepareTerminalRelease());
    await store.close();
  }

  await runCli(
    [
      '--config',
      configPath,
      '--output',
      outputDirectory,
      '--dry-run',
      '--cell',
      '150:1',
    ],
    { io: { stdout: () => {}, stderr: () => {} } },
  );
  const manifestPath = path.join(outputDirectory, 'manifests', 'd150-b1.json');
  const executeEvidence = '{"executionMode":"execute","state":"completed"}\n';
  const mutationStore = await createConfinedOutputStore(outputDirectory);
  await mutationStore.writeFile('manifests/d150-b1.json', executeEvidence);
  await mutationStore.close();
  await assert.rejects(
    runCli(
      [
        '--config',
        configPath,
        '--output',
        outputDirectory,
        '--dry-run',
        '--cell',
        '150:1',
      ],
      { io: { stdout: () => {}, stderr: () => {} } },
    ),
    { code: 'dry_run_evidence_conflict' },
  );
  assert.equal(await readFile(manifestPath, 'utf8'), executeEvidence);
});

test('one execute session lock blocks dry-run for the whole sweep', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-execute-session-lock-'));
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  let releaseCell;
  const cellBlocked = new Promise((resolve) => {
    releaseCell = resolve;
  });
  let enteredCell;
  const cellEntered = new Promise((resolve) => {
    enteredCell = resolve;
  });
  const execution = runCli(
    [
      '--config',
      executableConfigPath,
      '--output',
      outputDirectory,
      '--execute',
    ],
    {
      io: { stdout: () => {}, stderr: () => {} },
      verifyExecutionEnvironment: fixtureVerifier,
      cellBoundaryObserver: async () => {
        enteredCell();
        await cellBlocked;
        const error = new Error('Fixture stops after proving the between-cell lock window.');
        error.code = 'fixture_stop_between_cells';
        throw error;
      },
      runBenchmarkManifest: async ({ plannedManifest }) => {
        return {
          ...plannedManifest,
          state: 'completed',
          factors: {
            ...plannedManifest.factors,
            batchSizeEffective: plannedManifest.factors.batchSizeRequested,
          },
        };
      },
    },
  );
  await cellEntered;
  await assert.rejects(
    runCli(
      [
        '--config',
        configPath,
        '--output',
        outputDirectory,
        '--dry-run',
        '--cell',
        '150:1',
      ],
      { io: { stdout: () => {}, stderr: () => {} } },
    ),
    { code: 'benchmark_locked' },
  );
  await assert.rejects(stat(path.join(outputDirectory, 'manifests')), { code: 'ENOENT' });
  await assert.rejects(
    stat(path.join(outputDirectory, 'benchmark-index.v1.json')),
    { code: 'ENOENT' },
  );
  releaseCell();
  await assert.rejects(execution, { code: 'fixture_stop_between_cells' });
  await assert.rejects(
    stat(path.join(outputDirectory, 'adapter-lifecycle.json')),
    { code: 'ENOENT' },
  );
});

test('a paused dry-run session blocks execute before adapter spawn', async () => {
  const root = await canonicalTemp(
    path.join(os.tmpdir(), 'lofiever-dryrun-paused-session-'),
  );
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  let releasePublish;
  const publishBlocked = new Promise((resolve) => {
    releasePublish = resolve;
  });
  let observedPublish;
  const publishObserved = new Promise((resolve) => {
    observedPublish = resolve;
  });
  let paused = false;
  const dryRun = runCli(
    [
      '--config',
      configPath,
      '--output',
      outputDirectory,
      '--dry-run',
      '--cell',
      '150:1',
    ],
    {
      io: { stdout: () => {}, stderr: () => {} },
      createOutputStore: (directory) => createConfinedOutputStore(directory, {
        lifecycleObserver: async (event) => {
          if (
            !paused &&
            event.type === 'create-exclusive-complete' &&
            event.path === 'manifests/d150-b1.json'
          ) {
            paused = true;
            observedPublish();
            await publishBlocked;
          }
        },
      }),
    },
  );
  await publishObserved;
  try {
    await assert.rejects(
      runCli(
        [
          '--config',
          executableConfigPath,
          '--output',
          outputDirectory,
          '--execute',
          '--cell',
          '150:1',
        ],
        {
          io: { stdout: () => {}, stderr: () => {} },
          machineLockPath: path.join(root, 'machine-lock'),
          verifyExecutionEnvironment: fixtureVerifier,
        },
      ),
      { code: 'benchmark_locked' },
    );
    await assert.rejects(
      stat(path.join(outputDirectory, 'adapter-lifecycle.json')),
      { code: 'ENOENT' },
    );
  } finally {
    releasePublish();
    await dryRun;
  }
});

test('dry-run and execute emit no success receipt when the confined helper close fails', async (t) => {
  await t.test('dry-run', async () => {
    const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-dryrun-close-fail-'));
    const outputDirectory = path.join(root, 'output');
    await mkdir(outputDirectory, { mode: 0o700 });
    const stdout = [];
    await assert.rejects(
      runCli(
        [
          '--config',
          configPath,
          '--output',
          outputDirectory,
          '--dry-run',
          '--cell',
          '150:1',
        ],
        {
          createOutputStore: closeFailingOutputStoreFactory(),
          io: { stdout: (value) => stdout.push(value), stderr: () => {} },
        },
      ),
      { code: 'fixture_output_store_close_failed' },
    );
    assert.deepEqual(stdout, []);
  });

  await t.test('execute', async () => {
    const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-execute-close-fail-'));
    const outputDirectory = path.join(root, 'output');
    const executableConfigPath = await executableConfig(root);
    await mkdir(outputDirectory, { mode: 0o700 });
    const stdout = [];
    await assert.rejects(
      runCli(
        [
          '--config',
          executableConfigPath,
          '--output',
          outputDirectory,
          '--execute',
          '--cell',
          '150:1',
        ],
        {
          createOutputStore: closeFailingOutputStoreFactory(),
          io: { stdout: (value) => stdout.push(value), stderr: () => {} },
          machineLockPath: path.join(root, 'machine-lock'),
          verifyExecutionEnvironment: fixtureVerifier,
          runBenchmarkManifest: async ({ plannedManifest }) => ({
            ...plannedManifest,
            state: 'completed',
            factors: {
              ...plannedManifest.factors,
              batchSizeEffective: plannedManifest.factors.batchSizeRequested,
            },
          }),
        },
      ),
      { code: 'fixture_output_store_close_failed' },
    );
    assert.deepEqual(stdout, []);
    await assert.rejects(
      stat(path.join(outputDirectory, 'adapter-lifecycle.json')),
      { code: 'ENOENT' },
    );
  });
});

test('CLI execute refuses a cells symlink before spawning the persistent adapter', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-cells-symlink-'));
  const outputDirectory = path.join(root, 'output');
  const outsideDirectory = path.join(root, 'outside');
  const outsideSentinel = path.join(outsideDirectory, 'sentinel.txt');
  await mkdir(outputDirectory, { mode: 0o700 });
  await mkdir(outsideDirectory, { mode: 0o700 });
  await writeFile(outsideSentinel, 'outside sentinel\n');
  await symlink(outsideDirectory, path.join(outputDirectory, 'cells'));
  const executableConfigPath = await executableConfig(root);

  let executionError = null;
  try {
    await runCli([
      '--config',
      executableConfigPath,
      '--output',
      outputDirectory,
      '--execute',
      '--cell',
      '150:1',
    ], {
      io: { stdout: () => {}, stderr: () => {} },
      verifyExecutionEnvironment: fixtureVerifier,
    });
  } catch (error) {
    executionError = error;
  }
  assert.notEqual(executionError, null, 'unsafe cells output must fail closed');
  await assert.rejects(stat(path.join(outputDirectory, 'adapter-lifecycle.json')), {
    code: 'ENOENT',
  });
  assert.equal(await readFile(outsideSentinel, 'utf8'), 'outside sentinel\n');
  assert.deepEqual(await readdir(outsideDirectory), ['sentinel.txt']);
});

test('CLI modes reject an intermediate output-root symlink before helper or adapter work', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-output-root-link-'));
  const trusted = path.join(root, 'trusted');
  const outside = path.join(root, 'outside');
  const outsideOutput = path.join(outside, 'output');
  await mkdir(trusted, { mode: 0o700 });
  await mkdir(outsideOutput, { recursive: true, mode: 0o700 });
  await writeFile(path.join(outsideOutput, 'sentinel.txt'), 'outside sentinel\n');
  await symlink(outside, path.join(trusted, 'link'));
  const outputDirectory = path.join(trusted, 'link', 'output');
  const executableConfigPath = await executableConfig(root);
  const machineLockPath = path.join(root, 'machine-lock');
  for (const [mode, config] of [
    ['--dry-run', configPath],
    ['--execute', executableConfigPath],
  ]) {
    await assert.rejects(
      runCli(
        [
          '--config',
          config,
          '--output',
          outputDirectory,
          mode,
          '--cell',
          '150:1',
        ],
        {
          io: { stdout: () => {}, stderr: () => {} },
          machineLockPath,
          verifyExecutionEnvironment: fixtureVerifier,
        },
      ),
      { code: 'confined_output_root_not_canonical' },
    );
  }
  await assert.rejects(
    stat(path.join(outsideOutput, 'adapter-lifecycle.json')),
    { code: 'ENOENT' },
  );
  assert.deepEqual(await readdir(outsideOutput), ['sentinel.txt']);
});

test('CLI execute verifies its Python boundary before acquiring either benchmark lock', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-lock-observer-'));
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });

  await assert.rejects(
    runCli(
      [
        '--config',
        executableConfigPath,
        '--output',
        outputDirectory,
        '--execute',
        '--cell',
        '150:1',
      ],
      {
        io: { stdout: () => {}, stderr: () => {} },
        verifyExecutionEnvironment: async () => {
          const error = new Error('Fixture refuses the unverified Python boundary.');
          error.code = 'fixture_python_boundary_unverified';
          throw error;
        },
      },
    ),
    { code: 'fixture_python_boundary_unverified' },
  );

  await assert.rejects(stat(path.join(outputDirectory, 'benchmark-run.lock')), {
    code: 'ENOENT',
  });
  await assert.rejects(stat(path.join(outputDirectory, 'cells')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(root, '.test-machine-metal.lock')), { code: 'ENOENT' });
});

async function pin(filePath, version) {
  const canonical = await realpath(filePath);
  const value = {
    path: filePath,
    realpath: canonical,
    sha256: await digestPath(canonical),
  };
  return version ? { ...value, version } : value;
}

async function executableConfig(root) {
  const pythonPath = process.platform === 'darwin'
    ? (await execFileAsync(
      process.env.LOFIEVER_TEST_UV ?? '/Users/matheuskindrazki/.local/bin/uv',
      ['python', 'find', '3.12'],
      { encoding: 'utf8' },
    )).stdout.trim()
    : (await execFileAsync('which', ['python3'])).stdout.trim();
  const python = await pin(pythonPath, 'Python fixture');
  const gitPath = '/usr/bin/git';
  const { stdout: gitVersion } = await execFileAsync(gitPath, ['--version'], {
    encoding: 'utf8',
  });
  const git = await pin(gitPath, gitVersion.trim());
  const { version: _pythonVersion, ...pythonExecutable } = python;
  const script = await pin(fakeAdapterPath);
  const ffprobePath = process.platform === 'darwin'
    ? (process.env.LOFIEVER_TEST_FFPROBE ?? '/opt/homebrew/bin/ffprobe')
    : path.join(root, 'fixture-ffprobe');
  if (process.platform !== 'darwin') {
    await writeFile(
      ffprobePath,
      '#!/bin/sh\nlast=""\nfor value in "$@"; do last="$value"; done\n[ "$last" = "pipe:0" ] || exit 91\ntemporary=$(/usr/bin/mktemp /tmp/lofiever-ffprobe.XXXXXX) || exit 92\ntrap \'/bin/rm -f "$temporary"\' EXIT\n/bin/cat > "$temporary"\nset -- $(/usr/bin/od -An -tu4 -j24 -N20 "$temporary")\nsample_rate="$1"\nbyte_rate="$2"\ndata_bytes="$5"\n/usr/bin/awk -v data_bytes="$data_bytes" -v byte_rate="$byte_rate" -v sample_rate="$sample_rate" \'BEGIN { samples = data_bytes * sample_rate / byte_rate; printf "{\\"streams\\":[{\\"index\\":0,\\"codec_type\\":\\"audio\\",\\"sample_rate\\":\\"%d\\"}],\\"frames\\":[{\\"stream_index\\":0,\\"nb_samples\\":\\"%d\\"}],\\"format\\":{\\"duration\\":\\"%.6f\\"}}\\n", sample_rate, samples, data_bytes / byte_rate }\'\n',
    );
    await chmod(ffprobePath, 0o755);
  }
  const ffprobe = await pin(ffprobePath, 'ffprobe fixture');
  const modelPath = path.join(root, 'model.bin');
  const lmPath = path.join(root, 'lm.bin');
  await writeFile(modelPath, 'fixture-model');
  await writeFile(lmPath, 'fixture-lm');
  const runDirectory = path.join(root, 'run');
  await mkdir(runDirectory, { mode: 0o700 });
  const config = {
    schemaVersion: '1.0.0',
    benchmarkId: 'fixture-cli-execute',
    matrixFile: matrixPath,
    host: {
      machine: 'fixture-mac',
      chip: 'fixture-chip',
      memoryBytes: 1024,
      osVersion: 'fixture-os (fixture-build)',
    },
    engine: {
      name: 'ace-step-1.5',
      repositoryPath: root,
      repoCommit: '14c0211d5a0653b0f63e27686f4c3f151b4d8629',
    },
    model: {
      id: 'fixture-model',
      revision: '1'.repeat(40),
      weights: await pin(modelPath),
      lm: {
        id: 'fixture-lm',
        revision: '2'.repeat(40),
        weights: await pin(lmPath),
      },
    },
    runtime: {
      device: 'mps',
      lmBackend: 'mlx',
      vaeChunk: 8,
      serverCommit: null,
      runDirectory,
    },
    adapter: {
      kind: 'persistent-jsonl-v1',
      workingDirectory: root,
      executable: pythonExecutable,
      script,
      requestTimeoutSeconds: 30,
      terminateGraceSeconds: 0.1,
      maxOutputBytes: 1024 * 1024,
    },
    toolchain: {
      git,
      node: { ...python, version: 'Node fixture' },
      python,
      uv: { ...python, version: 'uv fixture' },
      ffmpeg: { ...python, version: 'ffmpeg fixture' },
      ffprobe,
    },
    energyCollection: { source: 'none' },
  };
  const filePath = path.join(root, 'benchmark-config.json');
  await writeFile(filePath, serializeManifest(config));
  return filePath;
}

async function fixtureVerifier(config) {
  const processEnvironment = {
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONSAFEPATH: '1',
  };
  const environment = Object.entries(processEnvironment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({ name, valueSha256: sha256Receipt(value) }));
  const [pythonDynamicLinker, uvDynamicLinker, ffprobeDynamicLinker] = await Promise.all([
    cachedClosure(config.adapter.executable),
    cachedClosure(config.identity.toolchain.uv),
    cachedClosure(config.identity.toolchain.ffprobe),
  ]);
  const runDirectory = process.platform === 'darwin'
    ? path.dirname(path.dirname(await realpath(config.adapter.executable.realpath)))
    : await realpath(config.identity.runtime.runDirectory);
  const runStats = await stat(runDirectory);
  const parent = await realpath(path.dirname(runDirectory));
  const parentStats = await stat(parent);
  return {
    ...config,
    identity: {
      ...config.identity,
      toolchain: {
        ...config.identity.toolchain,
        uv: {
          ...config.identity.toolchain.uv,
          dynamicLinker: uvDynamicLinker,
        },
        ffprobe: {
          ...config.identity.toolchain.ffprobe,
          dynamicLinker: ffprobeDynamicLinker,
        },
      },
      engine: { ...config.identity.engine, clean: true },
      runtime: {
        ...config.identity.runtime,
        harnessRepositoryPath: path.resolve(toolDirectory, '../..'),
        harnessClean: true,
        runDirectory,
        runDirectoryIdentity: {
          realpath: runDirectory,
          device: String(runStats.dev),
          inode: String(runStats.ino),
          parent: {
            realpath: parent,
            device: String(parentStats.dev),
            inode: String(parentStats.ino),
          },
        },
      },
      environment,
      environmentSha256: sha256Receipt(serializeManifest(environment)),
    },
    adapter: {
      ...config.adapter,
      workingDirectory: await realpath(config.adapter.workingDirectory),
      dynamicLinker: pythonDynamicLinker,
    },
    processEnvironment,
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

test('CLI execute checkpoints SIGINT and resumes through the persistent adapter without reusing a sidecar', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-execute-'));
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'hang', seconds: 30 }),
  );
  const args = [
    '--config',
    executableConfigPath,
    '--output',
    outputDirectory,
    '--execute',
    '--cell',
    '150:1',
  ];
  const io = { stdout: () => {}, stderr: () => {} };
  const firstRun = runCli(args, {
    io,
    verifyExecutionEnvironment: async (config) => fixtureVerifier(config),
  });
  const firstRunOutcome = firstRun.then(
    (value) => ({ status: 'fulfilled', value }),
    (error) => ({ status: 'rejected', error }),
  );
  const manifestPath = path.join(outputDirectory, 'manifests', 'd150-b1.json');
  await waitFor(async () => {
    try {
      return JSON.parse(await readFile(manifestPath, 'utf8')).warmup.status === 'running';
    } catch {
      return false;
    }
  }, 'CLI never checkpointed its running warmup.');
  process.emit('SIGINT');
  const interruptedOutcome = await firstRunOutcome;
  assert.equal(interruptedOutcome.status, 'rejected');
  assert.equal(interruptedOutcome.error.name, 'AbortError');
  const interrupted = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(interrupted.state, 'interrupted');
  assert.equal(interrupted.warmup.status, 'interrupted');
  assert.equal(interrupted.warmup.attempt, 1);

  await writeFile(
    path.join(outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'success' }),
  );
  await runCli(args, {
    io,
    verifyExecutionEnvironment: async (config) => fixtureVerifier(config),
  });
  const completed = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(completed.state, 'completed');
  assert.equal(completed.warmup.attempt, 2);
  assert.equal(completed.repetitions.every((record) => record.attempt === 1), true);
  assert.equal(
    completed.warmup.commandReceipt.sidecar.relativePath.includes('attempt-2'),
    true,
  );
  assert.equal(validateManifest(completed).success, true);
});

test('CLI holds one machine-wide Metal lock across distinct output directories', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-global-lock-'));
  const firstOutput = path.join(root, 'output-a');
  const secondOutput = path.join(root, 'output-b');
  const executableConfigPath = await executableConfig(root);
  await mkdir(firstOutput, { recursive: true, mode: 0o700 });
  await mkdir(secondOutput, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(firstOutput, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'hang', seconds: 30 }),
  );
  const baseArgs = ['--config', executableConfigPath, '--execute', '--cell', '150:1'];
  const io = { stdout: () => {}, stderr: () => {} };
  const firstController = new AbortController();
  const firstRun = runCli([...baseArgs, '--output', firstOutput], {
    io,
    verifyExecutionEnvironment: async (config) => fixtureVerifier(config),
    signal: firstController.signal,
  });
  const firstRunOutcome = firstRun.then(
    (value) => ({ status: 'fulfilled', value }),
    (error) => ({ status: 'rejected', error }),
  );
  await waitFor(async () => {
    try {
      return JSON.parse(
        await readFile(path.join(firstOutput, 'adapter-lifecycle.json'), 'utf8'),
      ).executions === 1;
    } catch {
      return false;
    }
  }, 'First output never initialized and entered its persistent adapter attempt.');

  try {
    await assert.rejects(
      runCli([...baseArgs, '--output', secondOutput], {
        io,
        verifyExecutionEnvironment: async (config) => fixtureVerifier(config),
      }),
      { code: 'benchmark_locked' },
    );
    await assert.rejects(readFile(path.join(secondOutput, 'adapter-lifecycle.json')), {
      code: 'ENOENT',
    });
  } finally {
    firstController.abort();
    const outcome = await firstRunOutcome;
    assert.equal(outcome.status, 'rejected');
    assert.ok(
      outcome.error.name === 'AbortError' ||
        outcome.error.code === 'execution_identity_changed',
      `${outcome.error.name}:${outcome.error.code}`,
    );
  }
});

test('CLI persists cleanup uncertainty on the machine lock and never releases it', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-cleanup-lock-'));
  const outputDirectory = path.join(root, 'output');
  const machineLockPath = path.join(root, 'machine-metal');
  const lockPath = `${machineLockPath}.lock`;
  const sentinelPath = `${lockPath}.cleanup-unproven`;
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  const cleanupError = new Error('fixture cleanup uncertainty');
  cleanupError.code = 'executor_process_group_alive';
  cleanupError.cleanupUnproven = true;
  cleanupError.details = { processGroupId: null };
  let verificationCount = 0;

  try {
    await assert.rejects(
      runCli(
        [
          '--config',
          executableConfigPath,
          '--output',
          outputDirectory,
          '--execute',
          '--cell',
          '150:1',
        ],
        {
          io: { stdout: () => {}, stderr: () => {} },
          verifyExecutionEnvironment: async (config) => {
            verificationCount += 1;
            return fixtureVerifier(config);
          },
          machineLockPath,
          runBenchmarkManifest: async () => {
            throw cleanupError;
          },
        },
      ),
      { code: 'executor_process_group_alive' },
    );
    assert.equal(verificationCount, 2);
    const sentinel = JSON.parse(await readFile(sentinelPath, 'utf8'));
    assert.equal(sentinel.state, 'cleanup-unproven');
    assert.equal(sentinel.errorCode, 'executor_process_group_alive');
    assert.equal(sentinel.processGroupId, null);
    await assert.rejects(acquireRunLock(machineLockPath), {
      code: 'benchmark_lock_cleanup_unproven',
    });
    await assert.rejects(
      readFile(path.join(outputDirectory, 'adapter-lifecycle.json')),
      { code: 'ENOENT' },
    );
  } finally {
    await unlink(sentinelPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await unlink(lockPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
});

test('renaming and recreating the configured run directory cannot create a second lock island', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-run-anchor-'));
  const firstOutput = path.join(root, 'output-a');
  const secondOutput = path.join(root, 'output-b');
  const executableConfigPath = await executableConfig(root);
  const rawConfig = JSON.parse(await readFile(executableConfigPath, 'utf8'));
  await mkdir(firstOutput, { mode: 0o700 });
  await mkdir(secondOutput, { mode: 0o700 });
  await writeFile(
    path.join(firstOutput, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'hang', seconds: 30 }),
  );
  const io = { stdout: () => {}, stderr: () => {} };
  const args = ['--config', executableConfigPath, '--execute', '--cell', '150:1'];
  const firstController = new AbortController();
  const firstRun = runCli([...args, '--output', firstOutput], {
    io,
    verifyExecutionEnvironment: fixtureVerifier,
    signal: firstController.signal,
  });
  const firstRunOutcome = firstRun.then(
    (value) => ({ status: 'fulfilled', value }),
    (error) => ({ status: 'rejected', error }),
  );
  await waitFor(async () => {
    try {
      return JSON.parse(
        await readFile(path.join(firstOutput, 'adapter-lifecycle.json'), 'utf8'),
      ).executions === 1;
    } catch {
      return false;
    }
  }, 'First output never initialized and entered its persistent adapter attempt.');

  await rename(rawConfig.runtime.runDirectory, `${rawConfig.runtime.runDirectory}-original`);
  await mkdir(rawConfig.runtime.runDirectory, { mode: 0o700 });
  try {
    await assert.rejects(
      runCli([...args, '--output', secondOutput], {
        io,
        verifyExecutionEnvironment: fixtureVerifier,
      }),
      { code: 'benchmark_locked' },
    );
    await assert.rejects(readFile(path.join(secondOutput, 'adapter-lifecycle.json')), {
      code: 'ENOENT',
    });
  } finally {
    firstController.abort();
    const outcome = await firstRunOutcome;
    assert.equal(outcome.status, 'rejected');
    assert.ok(
      outcome.error.name === 'AbortError' ||
        outcome.error.code === 'execution_identity_changed',
      `${outcome.error.name}:${outcome.error.code}`,
    );
  }
});

test('renaming and recreating the configured run parent cannot create a second lock island', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-parent-anchor-'));
  const runParent = path.join(root, 'configured-run-parent');
  const runDirectory = path.join(runParent, 'run');
  const firstOutput = path.join(root, 'output-a');
  const secondOutput = path.join(root, 'output-b');
  const executableConfigPath = await executableConfig(root);
  const rawConfig = JSON.parse(await readFile(executableConfigPath, 'utf8'));
  await mkdir(runParent, { mode: 0o700 });
  await mkdir(runDirectory, { mode: 0o700 });
  rawConfig.runtime.runDirectory = runDirectory;
  await writeFile(executableConfigPath, serializeManifest(rawConfig));
  await mkdir(firstOutput, { mode: 0o700 });
  await mkdir(secondOutput, { mode: 0o700 });
  await writeFile(
    path.join(firstOutput, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'hang', seconds: 30 }),
  );
  const io = { stdout: () => {}, stderr: () => {} };
  const args = ['--config', executableConfigPath, '--execute', '--cell', '150:1'];
  const firstController = new AbortController();
  const firstRunOutcome = runCli([...args, '--output', firstOutput], {
    io,
    verifyExecutionEnvironment: fixtureVerifier,
    signal: firstController.signal,
  }).then(
    (value) => ({ status: 'fulfilled', value }),
    (error) => ({ status: 'rejected', error }),
  );
  await waitFor(async () => {
    try {
      return JSON.parse(
        await readFile(path.join(firstOutput, 'adapter-lifecycle.json'), 'utf8'),
      ).executions === 1;
    } catch {
      return false;
    }
  }, 'First output never entered its persistent adapter attempt.');

  await rename(runParent, `${runParent}-original`);
  await mkdir(runParent, { mode: 0o700 });
  await mkdir(runDirectory, { mode: 0o700 });
  try {
    await assert.rejects(
      runCli([...args, '--output', secondOutput], {
        io,
        verifyExecutionEnvironment: fixtureVerifier,
      }),
      { code: 'benchmark_locked' },
    );
    await assert.rejects(readFile(path.join(secondOutput, 'adapter-lifecycle.json')), {
      code: 'ENOENT',
    });
  } finally {
    firstController.abort();
    const outcome = await firstRunOutcome;
    assert.equal(outcome.status, 'rejected');
    assert.ok(
      outcome.error.name === 'AbortError' ||
        outcome.error.code === 'private_directory_changed',
      `${outcome.error.name}:${outcome.error.code}`,
    );
  }
});

test('CLI --cell enforces green B1 then B2 receipts before batch escalation', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-cell-gate-'));
  const blockedOutput = path.join(root, 'blocked-output');
  const outputDirectory = path.join(root, 'ordered-output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(blockedOutput, { mode: 0o700 });
  await mkdir(outputDirectory, { mode: 0o700 });
  const io = { stdout: () => {}, stderr: () => {} };
  const runCell = (output, cell) =>
    runCli(
      [
        '--config',
        executableConfigPath,
        '--output',
        output,
        '--execute',
        '--cell',
        cell,
      ],
      {
        io,
        verifyExecutionEnvironment: async (config) => fixtureVerifier(config),
      },
    );

  await assert.rejects(runCell(blockedOutput, '180:1'), {
    code: 'benchmark_cell_sequence',
  });
  await assert.rejects(runCell(blockedOutput, '150:2'), {
    code: 'benchmark_cell_sequence',
  });
  await assert.rejects(
    readFile(path.join(blockedOutput, 'adapter-lifecycle.json')),
    { code: 'ENOENT' },
  );

  for (const cell of ['150:1', '180:1', '184:1', '150:2']) await runCell(outputDirectory, cell);
  await assert.rejects(runCell(outputDirectory, '150:4'), {
    code: 'benchmark_cell_sequence',
  });
  for (const cell of ['180:2', '184:2', '150:4']) await runCell(outputDirectory, cell);

  for (const name of ['d150-b1.json', 'd180-b1.json', 'd184-b1.json', 'd150-b2.json', 'd180-b2.json', 'd184-b2.json', 'd150-b4.json']) {
    const manifest = JSON.parse(
      await readFile(path.join(outputDirectory, 'manifests', name), 'utf8'),
    );
    assert.equal(manifest.state, 'completed');
  }
});

test('CLI batch escalation requires predecessors to prove the requested effective batch', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-effective-gate-'));
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  await writeFile(
    path.join(outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'success', effectiveBatchSize: 1 }),
  );
  const io = { stdout: () => {}, stderr: () => {} };
  const runCell = (cell) =>
    runCli(
      [
        '--config',
        executableConfigPath,
        '--output',
        outputDirectory,
        '--execute',
        '--cell',
        cell,
      ],
      { io, verifyExecutionEnvironment: fixtureVerifier },
    );

  for (const cell of ['150:1', '180:1', '184:1']) {
    await runCell(cell);
  }
  await assert.rejects(runCell('150:2'), (error) => {
    assert.equal(error.code, 'benchmark_execution_errors');
    assert.deepEqual(error.receipt.errors, [
      {
        code: 'batch_effective_below_requested',
        durationSeconds: 150,
        batchSizeRequested: 2,
        batchSizeEffective: 1,
      },
    ]);
    return true;
  });
  const b2 = JSON.parse(
    await readFile(path.join(outputDirectory, 'manifests', 'd150-b2.json'), 'utf8'),
  );
  assert.equal(b2.state, 'completed');
  assert.equal(b2.factors.batchSizeEffective, 1);

  await assert.rejects(runCell('180:2'), { code: 'benchmark_cell_sequence' });
  await assert.rejects(
    readFile(path.join(outputDirectory, 'manifests', 'd180-b2.json')),
    { code: 'ENOENT' },
  );

  const stdout = [];
  await assert.rejects(
    runCli(
      ['--config', executableConfigPath, '--output', outputDirectory, '--execute'],
      {
        io: { stdout: (value) => stdout.push(value), stderr: () => {} },
        verifyExecutionEnvironment: fixtureVerifier,
      },
    ),
    (error) => {
      assert.equal(error.code, 'benchmark_execution_errors');
      assert.equal(error.receipt.ok, false);
      assert.deepEqual(error.receipt.states, { completed: 4 });
      assert.deepEqual(error.receipt.errors, [
        {
          code: 'batch_effective_below_requested',
          durationSeconds: 150,
          batchSizeRequested: 2,
          batchSizeEffective: 1,
        },
      ]);
      return true;
    },
  );
  assert.equal(stdout.length, 1);
});

test('CLI separates structural manifest validation from filesystem evidence validation', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-evidence-'));
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  const receipt = await runCli(
    [
      '--config',
      executableConfigPath,
      '--output',
      outputDirectory,
      '--execute',
      '--cell',
      '150:1',
    ],
    {
      io: { stdout: () => {}, stderr: () => {} },
      verifyExecutionEnvironment: fixtureVerifier,
    },
  );
  assert.deepEqual(receipt.states, { completed: 1 });
  assert.equal(receipt.ok, true);

  const manifestPath = path.join(outputDirectory, 'manifests', 'd150-b1.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await unlink(
    path.join(outputDirectory, manifest.repetitions[0].commandReceipt.sidecar.relativePath),
  );

  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    '--validate-manifest',
    manifestPath,
  ]);
  assert.deepEqual(JSON.parse(stdout), {
    valid: true,
    validation: 'schema-only',
    file: manifestPath,
  });
  await assert.rejects(
    runCli(
      [
        '--validate-evidence',
        manifestPath,
        '--config',
        executableConfigPath,
        '--output',
        outputDirectory,
      ],
      { io: { stdout: () => {}, stderr: () => {} } },
    ),
    { code: 'checkpoint_integrity_failed' },
  );
});

test('CLI evidence validation accepts only terminal execute manifests and reports their state', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-terminal-evidence-'));
  const dryRunOutput = path.join(root, 'dry-run-output');
  await mkdir(dryRunOutput, { mode: 0o700 });
  await runCli(
    ['--config', configPath, '--output', dryRunOutput, '--dry-run', '--cell', '150:1'],
    { io: { stdout: () => {}, stderr: () => {} } },
  );
  await assert.rejects(
    runCli(
      [
        '--validate-evidence',
        path.join(dryRunOutput, 'manifests', 'd150-b1.json'),
        '--config',
        configPath,
        '--output',
        dryRunOutput,
      ],
      { io: { stdout: () => {}, stderr: () => {} } },
    ),
    { code: 'evidence_manifest_not_terminal' },
  );

  const outputDirectory = path.join(root, 'execute-output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  await writeFile(
    path.join(outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'hang', seconds: 30 }),
  );
  const args = [
    '--config',
    executableConfigPath,
    '--output',
    outputDirectory,
    '--execute',
    '--cell',
    '150:1',
  ];
  const controller = new AbortController();
  const execution = runCli(args, {
    io: { stdout: () => {}, stderr: () => {} },
    verifyExecutionEnvironment: fixtureVerifier,
    signal: controller.signal,
  }).then(
    (value) => ({ status: 'fulfilled', value }),
    (error) => ({ status: 'rejected', error }),
  );
  const manifestPath = path.join(outputDirectory, 'manifests', 'd150-b1.json');
  await waitFor(async () => {
    try {
      return JSON.parse(await readFile(manifestPath, 'utf8')).warmup.status === 'running';
    } catch {
      return false;
    }
  }, 'Execute manifest never entered running state.');
  await assert.rejects(
    runCli(['--validate-evidence', manifestPath, '--config', executableConfigPath, '--output', outputDirectory], {
      io: { stdout: () => {}, stderr: () => {} },
    }),
    { code: 'evidence_manifest_not_terminal' },
  );
  controller.abort();
  const interruptedOutcome = await execution;
  assert.equal(interruptedOutcome.status, 'rejected');
  assert.equal(interruptedOutcome.error.name, 'AbortError');
  const interrupted = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(interrupted.state, 'interrupted');
  await assert.rejects(
    runCli(['--validate-evidence', manifestPath, '--config', executableConfigPath, '--output', outputDirectory], {
      io: { stdout: () => {}, stderr: () => {} },
    }),
    { code: 'evidence_manifest_not_terminal' },
  );

  const planned = createDryRunManifest({
    identity: {
      benchmarkId: interrupted.benchmarkId,
      host: interrupted.host,
      engine: interrupted.engine,
      model: interrupted.model,
      runtime: interrupted.runtime,
      toolchain: interrupted.toolchain,
      environment: interrupted.environment,
      environmentSha256: interrupted.environmentSha256,
    },
    adapter: interrupted.adapter,
    cell: {
      durationSeconds: interrupted.factors.durationSeconds,
      batchSizeRequested: interrupted.factors.batchSizeRequested,
    },
    repetitions: interrupted.factors.repetitions,
    energyCollection: { source: interrupted.energyCollection.source },
    executionMode: 'execute',
  });
  const plannedPath = path.join(outputDirectory, 'manifests', 'planned-execute.json');
  await writeFile(plannedPath, serializeManifest(planned));
  await assert.rejects(
    runCli(['--validate-evidence', plannedPath, '--config', executableConfigPath, '--output', outputDirectory], {
      io: { stdout: () => {}, stderr: () => {} },
    }),
    { code: 'evidence_manifest_not_terminal' },
  );

  const hostileCases = [
    ['duration', (manifest) => {
      manifest.factors.durationSeconds = 0.25;
    }],
    ['batch', (manifest) => {
      manifest.factors.batchSizeRequested = 3;
      for (const record of [manifest.warmup, ...manifest.repetitions]) {
        record.batchSizeRequested = 3;
      }
    }],
    ['device', (manifest) => {
      manifest.runtime.device = 'cpu';
    }],
    ['lm-backend', (manifest) => {
      manifest.runtime.lmBackend = 'torch';
    }],
    ['engine', (manifest) => {
      manifest.engine.repoCommit = 'f'.repeat(40);
    }],
  ];
  for (const [name, mutate] of hostileCases) {
    const hostile = structuredClone(planned);
    mutate(hostile);
    hostile.configurationSha256 = sha256Receipt(
      serializeManifest(deriveConfiguration(hostile)),
    );
    hostile.runId = createHash('sha256')
      .update(hostile.configurationSha256)
      .digest('hex');
    const hostilePath = path.join(outputDirectory, 'manifests', `hostile-${name}.json`);
    await writeFile(hostilePath, serializeManifest(hostile));
    await assert.rejects(
      runCli(['--validate-evidence', hostilePath, '--config', executableConfigPath, '--output', outputDirectory], {
        io: { stdout: () => {}, stderr: () => {} },
      }),
      { code: 'checkpoint_integrity_failed' },
    );
  }

  await writeFile(
    path.join(outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'success' }),
  );
  await runCli(args, {
    io: { stdout: () => {}, stderr: () => {} },
    verifyExecutionEnvironment: fixtureVerifier,
  });
  const evidenceStdout = [];
  let provenanceChecks = 0;
  await runCli(['--validate-evidence', manifestPath, '--config', executableConfigPath, '--output', outputDirectory], {
    io: { stdout: (value) => evidenceStdout.push(value), stderr: () => {} },
    revalidateExecutionEnvironment: async (config, manifest) => {
      provenanceChecks += 1;
      assert.deepEqual(manifest.host, interrupted.host);
      return fixtureVerifier(config);
    },
  });
  assert.equal(provenanceChecks, 2);
  assert.deepEqual(JSON.parse(evidenceStdout.at(-1)), {
    valid: true,
    validation: 'filesystem-evidence',
    state: 'completed',
    file: manifestPath,
    manifestSha256: await digestPath(manifestPath),
  });

  const closeFailureStdout = [];
  await assert.rejects(
    runCli(
      [
        '--validate-evidence',
        manifestPath,
        '--config',
        executableConfigPath,
        '--output',
        outputDirectory,
      ],
      {
        createOutputStore: closeFailingOutputStoreFactory(),
        io: {
          stdout: (value) => closeFailureStdout.push(value),
          stderr: () => {},
        },
        revalidateExecutionEnvironment: fixtureVerifier,
      },
    ),
    { code: 'fixture_output_store_close_failed' },
  );
  assert.deepEqual(closeFailureStdout, []);

  const stableManifestBytes = await readFile(manifestPath);
  const stableManifestInode = (await stat(manifestPath)).ino;
  const rewriteStdout = [];
  let rewriteChecks = 0;
  await assert.rejects(
    runCli(
      ['--validate-evidence', manifestPath, '--config', executableConfigPath, '--output', outputDirectory],
      {
        io: { stdout: (value) => rewriteStdout.push(value), stderr: () => {} },
        revalidateExecutionEnvironment: async (config) => {
          rewriteChecks += 1;
          if (rewriteChecks === 1) {
            const rewritten = Buffer.from(stableManifestBytes);
            const newline = rewritten.indexOf(0x0a);
            rewritten[newline] = 0x20;
            await writeFile(manifestPath, rewritten);
            assert.equal((await stat(manifestPath)).ino, stableManifestInode);
          }
          return fixtureVerifier(config);
        },
      },
    ),
    { code: 'checkpoint_integrity_failed' },
  );
  assert.deepEqual(rewriteStdout, []);
  await writeFile(manifestPath, stableManifestBytes);
  assert.deepEqual(await readFile(manifestPath), stableManifestBytes);

  const movedOutputDirectory = `${outputDirectory}.moved-root-test`;
  let rootSwapChecks = 0;
  try {
    await assert.rejects(
      runCli(
        ['--validate-evidence', manifestPath, '--config', executableConfigPath, '--output', outputDirectory],
        {
          io: { stdout: () => {}, stderr: () => {} },
          revalidateExecutionEnvironment: async (config) => {
            rootSwapChecks += 1;
            if (rootSwapChecks === 1) {
              await rename(outputDirectory, movedOutputDirectory);
              await mkdir(outputDirectory, { mode: 0o700 });
            }
            return fixtureVerifier(config);
          },
        },
      ),
      (error) => {
        assert.match(error.code, /private_directory|confined/u);
        return true;
      },
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(movedOutputDirectory, outputDirectory);
  }

  let boundaryChecks = 0;
  await assert.rejects(
    runCli(['--validate-evidence', manifestPath, '--config', executableConfigPath, '--output', outputDirectory], {
      io: { stdout: () => {}, stderr: () => {} },
      revalidateExecutionEnvironment: async (config) => {
        boundaryChecks += 1;
        if (boundaryChecks === 2) {
          const error = new Error('Model pin changed during filesystem evidence validation.');
          error.code = 'pin_mismatch';
          throw error;
        }
        return fixtureVerifier(config);
      },
    }),
    { code: 'pin_mismatch' },
  );
  assert.equal(boundaryChecks, 2);
  await assert.rejects(
    runCli(['--validate-evidence', manifestPath, '--config', executableConfigPath, '--output', outputDirectory], {
      io: { stdout: () => {}, stderr: () => {} },
      revalidateExecutionEnvironment: async () => {
        const error = new Error('Engine pin changed before evidence validation.');
        error.code = 'engine_commit_mismatch';
        throw error;
      },
    }),
    { code: 'engine_commit_mismatch' },
  );
});

test(
  'CLI evidence validation rejects a Darwin ffprobe wrapper without spawning it',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-wrapper-evidence-'));
    const outputDirectory = path.join(root, 'output');
    const executableConfigPath = await executableConfig(root);
    await mkdir(outputDirectory, { mode: 0o700 });
    await runCli(
      [
        '--config',
        executableConfigPath,
        '--output',
        outputDirectory,
        '--execute',
        '--cell',
        '150:1',
      ],
      {
        io: { stdout: () => {}, stderr: () => {} },
        verifyExecutionEnvironment: fixtureVerifier,
      },
    );
    const manifestPath = path.join(outputDirectory, 'manifests', 'd150-b1.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const marker = path.join(root, 'wrapper-spawned');
    const wrapperPath = path.join(root, 'ffprobe-wrapper');
    await writeFile(
      wrapperPath,
      `#!/bin/sh\nprintf spawned > ${JSON.stringify(marker)}\nprintf '{"format":{"duration":"0.250000"}}\\n'\n`,
    );
    await chmod(wrapperPath, 0o700);
    const wrapper = await pin(wrapperPath, 'hostile wrapper');
    manifest.toolchain.ffprobe = {
      ...wrapper,
      dynamicLinker: await captureExecutableClosure(wrapper),
    };
    manifest.configurationSha256 = sha256Receipt(
      serializeManifest(deriveConfiguration(manifest)),
    );
    manifest.runId = createHash('sha256')
      .update(manifest.configurationSha256)
      .digest('hex');
    await writeFile(manifestPath, serializeManifest(manifest));

    await assert.rejects(
      runCli(['--validate-evidence', manifestPath, '--config', executableConfigPath, '--output', outputDirectory], {
        io: { stdout: () => {}, stderr: () => {} },
      }),
      (error) => {
        assert.equal(error.code, 'checkpoint_integrity_failed');
        assert.match(error.message, /schema|Mach-O|manifest/u);
        return true;
      },
    );
    await assert.rejects(stat(marker), { code: 'ENOENT' });
  },
);

test('CLI evidence gates running and interrupted states before artifact probing', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-nonterminal-evidence-'));
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  await writeFile(
    path.join(outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'hang_at', phase: 'repetition', index: 2, seconds: 30 }),
  );
  const controller = new AbortController();
  const execution = runCli(
    [
      '--config',
      executableConfigPath,
      '--output',
      outputDirectory,
      '--execute',
      '--cell',
      '150:1',
    ],
    {
      io: { stdout: () => {}, stderr: () => {} },
      verifyExecutionEnvironment: fixtureVerifier,
      signal: controller.signal,
    },
  ).then(
    (value) => ({ status: 'fulfilled', value }),
    (error) => ({ status: 'rejected', error }),
  );
  const manifestPath = path.join(outputDirectory, 'manifests', 'd150-b1.json');
  await waitFor(async () => {
    try {
      const current = JSON.parse(await readFile(manifestPath, 'utf8'));
      return current.repetitions[1].status === 'running';
    } catch {
      return false;
    }
  }, 'Execute manifest never reached a running repetition after completed evidence.');
  const running = JSON.parse(await readFile(manifestPath, 'utf8'));
  const completedArtifact = path.join(
    outputDirectory,
    running.warmup.candidates[0].artifact.relativePath,
  );
  await rename(completedArtifact, `${completedArtifact}.missing`);
  await assert.rejects(
    runCli(['--validate-evidence', manifestPath, '--config', executableConfigPath, '--output', outputDirectory], {
      io: { stdout: () => {}, stderr: () => {} },
    }),
    { code: 'evidence_manifest_not_terminal' },
  );

  controller.abort();
  const outcome = await execution;
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.error.name, 'AbortError');
  await assert.rejects(
    runCli(['--validate-evidence', manifestPath, '--config', executableConfigPath, '--output', outputDirectory], {
      io: { stdout: () => {}, stderr: () => {} },
    }),
    { code: 'evidence_manifest_not_terminal' },
  );
});

test('CLI receipts expose terminal states and fail when execution contains errors', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-error-receipt-'));
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  await writeFile(
    path.join(outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'generation_failure' }),
  );
  const stdout = [];
  await assert.rejects(
    runCli(
      [
        '--config',
        executableConfigPath,
        '--output',
        outputDirectory,
        '--execute',
        '--cell',
        '150:1',
      ],
      {
        io: { stdout: (value) => stdout.push(value), stderr: () => {} },
        verifyExecutionEnvironment: fixtureVerifier,
      },
    ),
    { code: 'benchmark_execution_errors' },
  );
  const receipt = JSON.parse(stdout.at(-1));
  assert.equal(receipt.ok, false);
  assert.deepEqual(receipt.states, { completed_with_errors: 1 });
  const evidenceStdout = [];
  await runCli(
    [
      '--validate-evidence',
      path.join(outputDirectory, 'manifests', 'd150-b1.json'),
      '--config',
      executableConfigPath,
      '--output',
      outputDirectory,
    ],
    { io: { stdout: (value) => evidenceStdout.push(value), stderr: () => {} } },
  );
  assert.equal(JSON.parse(evidenceStdout.at(-1)).state, 'completed_with_errors');
});

test('CLI sweep stops after the first failed cell and preserves its final receipt', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-sweep-error-receipt-'));
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  await writeFile(
    path.join(outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'generation_failure' }),
  );
  const stdout = [];
  await assert.rejects(
    runCli(
      [
        '--config',
        executableConfigPath,
        '--output',
        outputDirectory,
        '--execute',
      ],
      {
        io: { stdout: (value) => stdout.push(value), stderr: () => {} },
        verifyExecutionEnvironment: fixtureVerifier,
      },
    ),
    (error) => {
      assert.equal(error.code, 'benchmark_execution_errors');
      assert.deepEqual(error.receipt.states, { completed_with_errors: 1 });
      return true;
    },
  );
  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]).states, { completed_with_errors: 1 });
  await assert.rejects(
    readFile(path.join(outputDirectory, 'manifests', 'd180-b1.json')),
    { code: 'ENOENT' },
  );
});

test('CLI checkpoints and aborts when immediate pre-spawn provenance revalidation diverges', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-preflight-abort-'));
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  let verifyChecks = 0;
  let postCloseChecks = 0;
  await assert.rejects(
    runCli(
      [
        '--config',
        executableConfigPath,
        '--output',
        outputDirectory,
        '--execute',
        '--cell',
        '150:1',
      ],
      {
        io: { stdout: () => {}, stderr: () => {} },
        verifyExecutionEnvironment: async (config) => {
          verifyChecks += 1;
          if (verifyChecks === 3) {
            const error = new Error('Harness worktree became dirty before spawn.');
            error.code = 'harness_worktree_dirty';
            throw error;
          }
          return fixtureVerifier(config);
        },
        revalidateExecutionEnvironment: async (config, manifest) => {
          postCloseChecks += 1;
          assert.equal(manifest.executionMode, 'execute');
          assert.equal(manifest.state, 'completed_with_errors');
          assert.equal(manifest.warmup.error.code, 'harness_worktree_dirty');
          return fixtureVerifier(config);
        },
      },
    ),
    { code: 'harness_worktree_dirty' },
  );
  assert.equal(verifyChecks, 3);
  assert.equal(postCloseChecks, 1);
  const checkpoint = JSON.parse(
    await readFile(
      path.join(outputDirectory, 'manifests', 'd150-b1.json'),
      'utf8',
    ),
  );
  assert.equal(checkpoint.state, 'completed_with_errors');
  assert.equal(checkpoint.warmup.status, 'failed');
  assert.equal(checkpoint.warmup.error.code, 'harness_worktree_dirty');
  assert.equal(checkpoint.repetitions.every((record) => record.status === 'skipped'), true);
  await assert.rejects(
    readFile(path.join(outputDirectory, 'adapter-lifecycle.json')),
    { code: 'ENOENT' },
  );
});

test('CLI wires full provenance revalidation after adapter close', async () => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-post-close-'));
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  await mkdir(outputDirectory, { mode: 0o700 });
  let checks = 0;
  const terminalManifest = { executionMode: 'execute', state: 'completed' };
  const verifyPins = async (config) => {
    checks += 1;
    if (checks === 3) {
      const error = new Error('Model weights changed after adapter shutdown.');
      error.code = 'pin_mismatch';
      throw error;
    }
    return fixtureVerifier(config);
  };

  await assert.rejects(
    runCli(
      [
        '--config',
        executableConfigPath,
        '--output',
        outputDirectory,
        '--execute',
        '--cell',
        '150:1',
      ],
      {
        io: { stdout: () => {}, stderr: () => {} },
        machineLockPath: path.join(root, 'machine-metal'),
        verifyExecutionEnvironment: verifyPins,
        revalidateExecutionEnvironment: async (config, manifest) => {
          assert.equal(manifest, terminalManifest);
          return verifyPins(config);
        },
        runBenchmarkManifest: async ({ postCloseVerify }) => {
          await postCloseVerify({ manifest: terminalManifest });
          assert.fail('post-close provenance drift must stop terminal acceptance');
        },
      },
    ),
    { code: 'pin_mismatch' },
  );
  assert.equal(checks, 3);
});

test('CLI recovers a SIGKILL checkpoint with an intermediate running repetition without respawn', async (t) => {
  const root = await canonicalTemp(path.join(os.tmpdir(), 'lofiever-cli-sigkill-'));
  const machineLockPath = path.join(root, '.test-machine-metal');
  const machineLockStalePrefix = `${path.basename(machineLockPath)}.lock.stale-`;
  const staleBefore = new Set(
    (await readdir(root)).filter((name) => name.startsWith(machineLockStalePrefix)),
  );
  const outputDirectory = path.join(root, 'output');
  const executableConfigPath = await executableConfig(root);
  const wrapperPath = path.join(root, 'run-cli-fixture.mjs');
  await mkdir(outputDirectory, { mode: 0o700 });
  await writeFile(
    path.join(outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'hang_at', phase: 'repetition', index: 2, seconds: 30 }),
  );
  await writeFile(
    wrapperPath,
    `import { runCli } from ${JSON.stringify(pathToFileURL(cliPath).href)};
	import { captureExecutableClosure } from ${JSON.stringify(pathToFileURL(path.join(toolDirectory, 'dynamic-linker.mjs')).href)};
	import { serializeManifest, sha256Receipt } from ${JSON.stringify(pathToFileURL(path.join(toolDirectory, 'manifest.mjs')).href)};
		import { realpath, stat, writeFile } from 'node:fs/promises';
		import path from 'node:path';
		let cleanupGuardProcessGroups = 0;
		const machineLockOptions = {
		  onCleanupGuardWrite: async (operation, guard) => {
		    if (
		      process.env.LOFIEVER_TEST_BLOCK_SECOND_PGID !== '1' ||
		      operation !== 'record-process-group'
		    ) return;
		    cleanupGuardProcessGroups += 1;
		    if (cleanupGuardProcessGroups !== 2) return;
		    await writeFile(
		      process.env.LOFIEVER_TEST_PGID_MARKER,
		      JSON.stringify({ processGroupId: guard.processGroupId }),
		    );
		    await new Promise(() => {});
		  },
		};
		const verifyExecutionEnvironment = async (config) => {
	  const processEnvironment = {
	    PYTHONDONTWRITEBYTECODE: '1',
	    PYTHONNOUSERSITE: '1',
	    PYTHONSAFEPATH: '1',
	  };
	  const environment = Object.entries(processEnvironment)
	    .sort(([left], [right]) => left.localeCompare(right))
	    .map(([name, value]) => ({ name, valueSha256: sha256Receipt(value) }));
	  const runDirectory = process.platform === 'darwin'
	    ? path.dirname(path.dirname(await realpath(config.adapter.executable.realpath)))
	    : await realpath(config.identity.runtime.runDirectory);
	  const runStats = await stat(runDirectory);
	  const parent = await realpath(path.dirname(runDirectory));
	  const parentStats = await stat(parent);
	  const [pythonDynamicLinker, uvDynamicLinker, ffprobeDynamicLinker] = await Promise.all([
	    captureExecutableClosure(config.adapter.executable),
	    captureExecutableClosure(config.identity.toolchain.uv),
	    captureExecutableClosure(config.identity.toolchain.ffprobe),
	  ]);
	  return {
    ...config,
    identity: {
      ...config.identity,
      engine: { ...config.identity.engine, clean: true },
	      toolchain: {
	        ...config.identity.toolchain,
	        uv: { ...config.identity.toolchain.uv, dynamicLinker: uvDynamicLinker },
	        ffprobe: { ...config.identity.toolchain.ffprobe, dynamicLinker: ffprobeDynamicLinker },
	      },
	      runtime: {
	        ...config.identity.runtime,
	        harnessClean: true,
	        runDirectory,
	        runDirectoryIdentity: {
	          realpath: runDirectory,
	          device: String(runStats.dev),
	          inode: String(runStats.ino),
	          parent: {
	            realpath: parent,
	            device: String(parentStats.dev),
	            inode: String(parentStats.ino),
	          },
	        },
	      },
      environment,
      environmentSha256: sha256Receipt(serializeManifest(environment)),
    },
	adapter: {
	  ...config.adapter,
	  workingDirectory: await realpath(config.adapter.workingDirectory),
	  dynamicLinker: pythonDynamicLinker,
	},
	processEnvironment,
  };
};
await runCli(process.argv.slice(2), {
  io: { stdout: () => {}, stderr: () => {} },
  verifyExecutionEnvironment,
  revalidateExecutionEnvironment: async (config) => verifyExecutionEnvironment(config),
  machineLockPath: process.env.LOFIEVER_TEST_MACHINE_LOCK_PATH,
  machineLockOptions,
});
`,
  );
  const args = [
    '--config',
    executableConfigPath,
    '--output',
    outputDirectory,
    '--execute',
    '--cell',
    '150:1',
  ];
  const child = spawn(process.execPath, [wrapperPath, ...args], {
    cwd: path.resolve(toolDirectory, '../..'),
    env: {
      ...process.env,
      LOFIEVER_TEST_MACHINE_LOCK_PATH: machineLockPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const childStderr = [];
  child.stderr.on('data', (chunk) => childStderr.push(chunk));
  const manifestPath = path.join(outputDirectory, 'manifests', 'd150-b1.json');
  await waitFor(async () => {
    try {
      return JSON.parse(await readFile(manifestPath, 'utf8')).repetitions[1].status === 'running';
    } catch {
      return false;
    }
  }, `Child never checkpointed repetition 2 as running: ${Buffer.concat(childStderr).toString('utf8')}`);
  const lifecycle = JSON.parse(
    await readFile(path.join(outputDirectory, 'adapter-lifecycle.json'), 'utf8'),
  );
  child.kill('SIGKILL');
  await once(child, 'exit');
  await waitFor(() => {
    try {
      process.kill(lifecycle.pid, 0);
      return false;
    } catch (error) {
      return error?.code === 'ESRCH';
    }
  }, 'Persistent adapter did not exit after harness stdin closed.');

  await writeFile(
    path.join(outputDirectory, 'fixture-behavior.json'),
    JSON.stringify({ mode: 'success' }),
  );
  await assert.rejects(
    runCli(args, {
      io: { stdout: () => {}, stderr: () => {} },
      verifyExecutionEnvironment: async (config) => fixtureVerifier(config),
    }),
    { code: 'benchmark_execution_errors' },
  );
  const recovered = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(recovered.state, 'completed_with_errors');
  assert.equal(recovered.repetitions[0].status, 'completed');
  assert.equal(recovered.repetitions[1].error.code, 'execution_abandoned');
  assert.equal(recovered.repetitions[2].error.code, 'skipped_after_abandoned_attempt');
  assert.equal(validateManifest(recovered).success, true);
  const createdStaleReceipts = (await readdir(root)).filter(
    (name) => name.startsWith(machineLockStalePrefix) && !staleBefore.has(name),
  );
  assert.equal(createdStaleReceipts.length >= 1, true);
  await Promise.all(
    createdStaleReceipts.map((name) => unlink(path.join(root, name))),
  );

  await t.test('cell 2 crash before PGID receipt leaves the outer guard null and blocks another output', async () => {
    const windowOutput = path.join(root, 'window-output');
    const blockedOutput = path.join(root, 'blocked-window-output');
    const windowMachineLock = path.join(root, '.window-machine-metal');
    const pgidMarker = path.join(root, 'second-cell-pgid.json');
    await mkdir(windowOutput, { mode: 0o700 });
    await mkdir(blockedOutput, { mode: 0o700 });
    const sweepArgs = [
      '--config',
      executableConfigPath,
      '--output',
      windowOutput,
      '--execute',
    ];
    const sweepChild = spawn(process.execPath, [wrapperPath, ...sweepArgs], {
      cwd: path.resolve(toolDirectory, '../..'),
      env: {
        ...process.env,
        LOFIEVER_TEST_BLOCK_SECOND_PGID: '1',
        LOFIEVER_TEST_MACHINE_LOCK_PATH: windowMachineLock,
        LOFIEVER_TEST_PGID_MARKER: pgidMarker,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const sweepClosed = once(sweepChild, 'exit');
    let processGroupId = null;
    try {
      await waitFor(async () => {
        try {
          processGroupId = JSON.parse(await readFile(pgidMarker, 'utf8')).processGroupId;
          return Number.isInteger(processGroupId) && processGroupId > 0;
        } catch {
          return false;
        }
      }, 'Second cell never reached the pre-receipt PGID update window.');
      const machineSentinelPath = `${windowMachineLock}.lock.cleanup-unproven`;
      const pending = JSON.parse(await readFile(machineSentinelPath, 'utf8'));
      assert.equal(pending.state, 'cleanup-pending');
      assert.equal(pending.processGroupId, null);

      sweepChild.kill('SIGKILL');
      await sweepClosed;
      await waitFor(() => {
        try {
          process.kill(-processGroupId, 0);
          return false;
        } catch (error) {
          return error?.code === 'ESRCH';
        }
      }, 'Second-cell adapter process group did not exit through the parent watchdog.');

      await assert.rejects(
        runCli(
          [
            '--config',
            executableConfigPath,
            '--output',
            blockedOutput,
            '--execute',
            '--cell',
            '150:1',
          ],
          {
            io: { stdout: () => {}, stderr: () => {} },
            verifyExecutionEnvironment: fixtureVerifier,
            machineLockPath: windowMachineLock,
          },
        ),
        { code: 'benchmark_lock_cleanup_pending' },
      );
      await assert.rejects(
        readFile(path.join(blockedOutput, 'adapter-lifecycle.json')),
        { code: 'ENOENT' },
      );
    } finally {
      if (sweepChild.exitCode === null && sweepChild.signalCode === null) {
        sweepChild.kill('SIGKILL');
        await sweepClosed;
      }
      let cleanupProven = false;
      if (processGroupId !== null) {
        try {
          process.kill(-processGroupId, 0);
          assert.fail('Cannot remove private cleanup guards while the adapter group is alive.');
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error;
          cleanupProven = true;
        }
      }
      if (cleanupProven) {
        for (const filePath of [
          `${windowMachineLock}.lock.cleanup-unproven`,
          `${windowMachineLock}.lock`,
          path.join(windowOutput, 'benchmark-run.lock.cleanup-unproven'),
          path.join(windowOutput, 'benchmark-run.lock'),
        ]) {
          await unlink(filePath).catch((error) => {
            if (error?.code !== 'ENOENT') throw error;
          });
        }
      }
    }
  });
});
