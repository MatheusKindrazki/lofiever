import assert from 'node:assert/strict';
import test from 'node:test';

import * as auxiliary from './profile-inference.mjs';

const adapter = {
  pythonExecutable: '/pinned/python3',
  scriptPath: '/pinned/profile_inference.py',
  device: 'mps',
  lmBackend: 'mlx',
  modelId: 'acestep-v15-turbo',
  lmModelId: 'acestep-5Hz-lm-0.6B',
  seed: 42,
};

test('exposes profile_inference only as an explicit one-shot auxiliary receipt command', () => {
  assert.deepEqual(Object.keys(auxiliary), ['buildProfileInferenceAuxiliaryCommand']);
  assert.deepEqual(auxiliary.buildProfileInferenceAuxiliaryCommand(adapter), [
    '/pinned/python3',
    '/pinned/profile_inference.py',
    '--mode',
    'profile',
    '--device',
    'mps',
    '--lm-backend',
    'mlx',
    '--config-path',
    'acestep-v15-turbo',
    '--lm-model',
    'acestep-5Hz-lm-0.6B',
    '--duration',
    '{durationSeconds}',
    '--batch-size',
    '{batchSizeRequested}',
    '--seed',
    '42',
    '--no-warmup',
  ]);
});
