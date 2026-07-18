import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { config } from '@/lib/config';

export const MUSIC_GENERATION_QUEUE = 'lofiever-music-generation';

export interface MusicGenerationJobData {
  generationId: string;
}

let queue: Queue<MusicGenerationJobData> | null = null;
let queueConnection: Redis | null = null;

function getQueue(): Queue<MusicGenerationJobData> {
  if (!queue) {
    queueConnection = new Redis(config.redis.url, {
      maxRetriesPerRequest: null,
      connectionName: 'lofiever:music-generation-queue',
      lazyConnect: true,
    });
    queue = new Queue<MusicGenerationJobData>(MUSIC_GENERATION_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: config.musicGeneration.maxAttempts,
        backoff: { type: 'exponential', delay: 15_000 },
        removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1_000 },
      },
    });
  }
  return queue;
}

export async function enqueueMusicGeneration(generationId: string): Promise<void> {
  await getQueue().add('generate', { generationId }, { jobId: generationId });
}

export async function closeMusicGenerationQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (queueConnection) {
    await queueConnection.quit();
    queueConnection = null;
  }
}
