function requiredString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value;
}

function commonArguments(options) {
  return [
    requiredString(options.pythonExecutable, 'pythonExecutable'),
    requiredString(options.scriptPath, 'scriptPath'),
    '--mode',
    'profile',
    '--device',
    requiredString(options.device, 'device'),
    '--lm-backend',
    requiredString(options.lmBackend, 'lmBackend'),
    '--config-path',
    requiredString(options.modelId, 'modelId'),
    '--lm-model',
    requiredString(options.lmModelId, 'lmModelId'),
  ];
}

export function buildProfileInferenceAuxiliaryCommand(options) {
  if (!Number.isInteger(options.seed) || options.seed < 0) {
    throw new TypeError('seed must be a non-negative integer.');
  }

  const command = [
    ...commonArguments(options),
    '--duration',
    '{durationSeconds}',
    '--batch-size',
    '{batchSizeRequested}',
    '--seed',
    String(options.seed),
    '--no-warmup',
  ];
  if (options.thinking === true) {
    command.push('--thinking');
  }
  return command;
}
