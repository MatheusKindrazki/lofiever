import type { MusicGenerationSource } from '@prisma/client';

export interface MusicGenerationRequest {
  source: MusicGenerationSource;
  prompt: string;
  title?: string;
  mood?: string;
  bpm?: number;
  locale?: 'pt' | 'en';
  userId?: string;
  username?: string;
  ipAddress?: string;
  idempotencyKey?: string;
}

export interface AcceptedMusicGeneration {
  accepted: true;
  generationId: string;
  title: string;
  status: 'queued' | 'published';
  message: string;
}

export interface RejectedMusicGeneration {
  accepted: false;
  code:
    | 'FEATURE_DISABLED'
    | 'AUTH_REQUIRED'
    | 'AGE_CONFIRMATION_REQUIRED'
    | 'INVALID_PROMPT'
    | 'USER_DAILY_LIMIT'
    | 'GLOBAL_DAILY_LIMIT'
    | 'ACTIVE_REQUEST_EXISTS'
    | 'MONTHLY_BUDGET_REACHED'
    | 'QUEUE_UNAVAILABLE';
  message: string;
}

export type MusicGenerationRequestResult = AcceptedMusicGeneration | RejectedMusicGeneration;

export interface GeneratedMusicAudio {
  audio: Buffer;
  mimeType: 'audio/mpeg';
  model: string;
  provider: string;
  operationId?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface MusicGenerationProviderInput {
  prompt: string;
  durationSeconds: number;
  onOperationId?: (operationId: string) => Promise<void>;
}

export interface MusicGenerationProvider {
  readonly name: string;
  readonly model: string;
  readonly costPerAttemptUsd: number;
  generate(input: MusicGenerationProviderInput): Promise<GeneratedMusicAudio>;
}

export interface AudioValidationReport {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  codec: string;
  maxVolumeDb: number | null;
  silenceRatio: number;
  transcript: string | null;
  sha256: string;
  normalized: boolean;
}

export interface ValidatedMusicAudio {
  streamingAudio: Buffer;
  report: AudioValidationReport;
}

export interface MusicGenerationUpdate {
  generationId: string;
  userId?: string;
  status: 'generating' | 'validating' | 'published' | 'failed';
  title: string;
  message: string;
  track?: {
    id: string;
    title: string;
    artist: string;
    duration: number;
    mood?: string;
  };
}
