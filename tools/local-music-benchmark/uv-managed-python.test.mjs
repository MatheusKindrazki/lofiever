import assert from 'node:assert/strict';
import test from 'node:test';

import {
  environmentForPinnedManagedPython,
  managedPythonFindArguments,
} from './uv-managed-python.mjs';

test('uses an exact no-download and no-cache managed Python lookup', () => {
  assert.deepEqual(managedPythonFindArguments('3.12.14'), [
    'python',
    'find',
    '--managed-python',
    '--no-python-downloads',
    '--no-project',
    '--no-cache',
    '--offline',
    '--no-config',
    '3.12.14',
  ]);
  assert.throws(() => managedPythonFindArguments('3.12'), /exact Python patch version/u);
});

test('derives the uv managed install directory from the pinned Python realpath', () => {
  const environment = environmentForPinnedManagedPython(
    {
      HOME: '/Users/example',
      TMPDIR: '/private/tmp/example',
      UV_PYTHON_INSTALL_DIR: '/untrusted/inherited/value',
    },
    '/Users/example/lofigen/python/cpython-3.12.14-macos-aarch64-none/bin/python3.12',
  );

  assert.deepEqual(environment, {
    HOME: '/Users/example',
    TMPDIR: '/private/tmp/example',
    UV_PYTHON_INSTALL_DIR: '/Users/example/lofigen/python',
  });
});

test('rejects Python paths that cannot identify a managed installation root', () => {
  for (const pythonPath of [
    'python3.12',
    '/usr/bin/python3.12',
    '/Users/example/lofigen/python/cpython-3.12.14-macos-aarch64-none/python3.12',
  ]) {
    assert.throws(
      () => environmentForPinnedManagedPython({}, pythonPath),
      /pinned managed Python executable/u,
    );
  }
});
