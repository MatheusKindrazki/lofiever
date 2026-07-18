import { config } from '@/lib/config';
import { MusicGenerationError } from './errors';
import { LyriaMusicProvider } from './lyria-provider';
import type { MusicGenerationProvider } from './types';

let provider: MusicGenerationProvider | null = null;

export function getMusicGenerationProvider(): MusicGenerationProvider {
  if (provider) return provider;

  if (config.musicGeneration.provider === 'google-lyria') {
    provider = new LyriaMusicProvider();
    return provider;
  }

  throw new MusicGenerationError(
    'PROVIDER_CONFIGURATION_ERROR',
    `Provedor de música não suportado: ${config.musicGeneration.provider}`,
  );
}
