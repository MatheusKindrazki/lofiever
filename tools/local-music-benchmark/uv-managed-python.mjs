import path from 'node:path';

const managedInstallationName = /^(?:cpython|pypy|graalpy)-/u;
const exactPythonPatchVersion = /^\d+\.\d+\.\d+$/u;

export function managedPythonFindArguments(version) {
  if (typeof version !== 'string' || !exactPythonPatchVersion.test(version)) {
    throw new Error('Managed Python lookup requires an exact Python patch version.');
  }
  return [
    'python',
    'find',
    '--managed-python',
    '--no-python-downloads',
    '--no-project',
    '--no-cache',
    '--offline',
    '--no-config',
    version,
  ];
}

export function environmentForPinnedManagedPython(environment, pythonRealpath) {
  if (typeof pythonRealpath !== 'string' || !path.isAbsolute(pythonRealpath)) {
    throw new Error('The pinned managed Python executable must use an absolute path.');
  }
  const binDirectory = path.dirname(pythonRealpath);
  const installationDirectory = path.dirname(binDirectory);
  if (
    path.basename(binDirectory) !== 'bin' ||
    !managedInstallationName.test(path.basename(installationDirectory))
  ) {
    throw new Error(
      'The pinned managed Python executable must live under a uv managed installation.',
    );
  }
  return {
    ...environment,
    UV_PYTHON_INSTALL_DIR: path.dirname(installationDirectory),
  };
}
