import { UnrecoverableError, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import Redis from 'ioredis';
import type { MusicGeneration, Prisma, Track } from '@prisma/client';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { R2Lib } from '@/lib/r2';
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import { validateAndNormalizeMusicAudio } from './audio-validator';
import { ORIGINAL_MUSIC_ARTIST } from './constants';
import { MusicGenerationError } from './errors';
import { getMusicGenerationProvider } from './provider';
import { MUSIC_GENERATION_QUEUE } from './queue';
import type { MusicGenerationJobData } from './queue';
import { MusicGenerationService } from './service';
import type { MusicGenerationUpdate } from './types';

const UPDATE_CHANNEL = 'lofi-ever:music-generation-update';

let worker: Worker<MusicGenerationJobData> | null = null;
let workerConnection: Redis | null = null;

async function publishUpdate(update: MusicGenerationUpdate): Promise<void> {
  await redis.publish(UPDATE_CHANNEL, JSON.stringify(update));
}

function publicTrack(track: Track): NonNullable<MusicGenerationUpdate['track']> {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    mood: track.mood || undefined,
  };
}

async function finalizePublishedTrack(generation: MusicGeneration, track: Track): Promise<void> {
  if (generation.source === 'USER' && generation.userId) {
    await PlaylistManagerService.queueTrackWithinNext(
      track.id,
      generation.username || 'ouvinte',
      generation.userId,
      3,
      5,
      generation.id,
    );
  }

  await prisma.musicGeneration.update({
    where: { id: generation.id },
    data: {
      status: 'PUBLISHED',
      completedAt: new Date(),
      failureCode: null,
      failureReason: null,
    },
  });

  await publishUpdate({
    generationId: generation.id,
    userId: generation.userId || undefined,
    status: 'published',
    title: track.title,
    message: generation.source === 'USER'
      ? `“${track.title}” ficou pronta e entrou entre as próximas faixas.`
      : `Nova faixa original de ${ORIGINAL_MUSIC_ARTIST} publicada: “${track.title}”.`,
    track: publicTrack(track),
  });
}

async function processGeneration(job: Job<MusicGenerationJobData>): Promise<void> {
  const generation = await prisma.musicGeneration.findUnique({
    where: { id: job.data.generationId },
    include: { track: true },
  });
  if (!generation) {
    throw new UnrecoverableError(`Music generation ${job.data.generationId} not found`);
  }
  if (generation.status === 'PUBLISHED') return;

  if (generation.track) {
    await finalizePublishedTrack(generation, generation.track);
    return;
  }

  const provider = getMusicGenerationProvider();
  await MusicGenerationService.reserveProviderAttempt(generation.id, provider.costPerAttemptUsd);
  await publishUpdate({
    generationId: generation.id,
    userId: generation.userId || undefined,
    status: 'generating',
    title: generation.title,
    message: `O estúdio começou a produzir “${generation.title}”.`,
  });

  const generated = await provider.generate({
    prompt: generation.normalizedPrompt,
    durationSeconds: generation.durationSeconds,
    onOperationId: async (operationId) => {
      await prisma.musicGeneration.update({
        where: { id: generation.id },
        data: { providerOperationId: operationId },
      });
    },
  });

  await prisma.musicGeneration.update({
    where: { id: generation.id },
    data: { status: 'VALIDATING', model: generated.model, provider: generated.provider },
  });
  await publishUpdate({
    generationId: generation.id,
    userId: generation.userId || undefined,
    status: 'validating',
    title: generation.title,
    message: `“${generation.title}” está passando pela validação automática.`,
  });

  const validated = await validateAndNormalizeMusicAudio(generated.audio, {
    title: generation.title,
    artist: ORIGINAL_MUSIC_ARTIST,
  });
  const duplicate = await prisma.musicGeneration.findFirst({
    where: {
      id: { not: generation.id },
      audioSha256: validated.report.sha256,
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new MusicGenerationError(
      'DUPLICATE_AUDIO',
      'A faixa gerada é idêntica a outra já processada.',
      true,
    );
  }

  const baseKey = `music/generated/${generation.id}`;
  const originalObjectKey = `${baseKey}/original.mp3`;
  const streamingObjectKey = `${baseKey}/streaming.mp3`;
  await R2Lib.uploadBuffer(generated.audio, originalObjectKey, generated.mimeType);
  await R2Lib.uploadBuffer(validated.streamingAudio, streamingObjectKey, 'audio/mpeg');

  const track = await prisma.$transaction(async (tx) => {
    const createdTrack = await tx.track.create({
      data: {
        title: generation.title,
        artist: ORIGINAL_MUSIC_ARTIST,
        sourceType: 's3',
        sourceId: streamingObjectKey,
        origin: generation.source === 'USER' ? 'generated_user' : 'generated_editorial',
        duration: validated.report.durationSeconds,
        bpm: generation.bpm,
        mood: generation.mood,
      },
    });

    await tx.musicGeneration.update({
      where: { id: generation.id },
      data: {
        trackId: createdTrack.id,
        audioSha256: validated.report.sha256,
        originalObjectKey,
        streamingObjectKey,
        validationResult: {
          ...validated.report,
          providerMetadata: generated.providerMetadata || {},
        } as Prisma.InputJsonValue,
      },
    });

    return createdTrack;
  });

  await finalizePublishedTrack({ ...generation, trackId: track.id }, track);
}

async function handleFailure(job: Job<MusicGenerationJobData> | undefined, error: Error): Promise<void> {
  if (!job) return;

  const generation = await prisma.musicGeneration.findUnique({ where: { id: job.data.generationId } });
  if (!generation || generation.status === 'PUBLISHED') return;

  const typedError = error instanceof MusicGenerationError ? error : null;
  const attempts = job.opts.attempts || config.musicGeneration.maxAttempts;
  const retryable = typedError ? typedError.retryable : !(error instanceof UnrecoverableError);
  const isFinalAttempt = !retryable || job.attemptsMade >= attempts;

  await prisma.musicGeneration.update({
    where: { id: generation.id },
    data: {
      status: isFinalAttempt ? 'FAILED' : 'QUEUED',
      failureCode: typedError?.code || 'GENERATION_FAILED',
      failureReason: error.message,
      completedAt: isFinalAttempt ? new Date() : null,
    },
  });

  if (isFinalAttempt) {
    await publishUpdate({
      generationId: generation.id,
      userId: generation.userId || undefined,
      status: 'failed',
      title: generation.title,
      message: `Não consegui finalizar “${generation.title}” com qualidade para a rádio. A cota foi devolvida.`,
    });
  }
}

export function startMusicGenerationWorker(): void {
  if (worker || !config.musicGeneration.enabled) return;

  workerConnection = new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
    connectionName: 'lofiever:music-generation-worker',
    lazyConnect: true,
  });
  worker = new Worker<MusicGenerationJobData>(MUSIC_GENERATION_QUEUE, async (job) => {
    try {
      await processGeneration(job);
    } catch (error) {
      if (error instanceof MusicGenerationError && !error.retryable) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }, {
    connection: workerConnection,
    concurrency: 1,
    lockDuration: 15 * 60 * 1_000,
  });

  worker.on('failed', (job, error) => {
    handleFailure(job, error).catch((failureError) => {
      console.error('[MusicGeneration] Failed to persist job failure:', failureError);
    });
  });
  worker.on('error', (error) => {
    console.error('[MusicGeneration] Worker error:', error);
  });

  console.log('[MusicGeneration] Worker started with concurrency 1');
}

export async function closeMusicGenerationWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (workerConnection) {
    await workerConnection.quit();
    workerConnection = null;
  }
}
