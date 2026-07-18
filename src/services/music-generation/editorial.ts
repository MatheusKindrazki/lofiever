import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { MusicGenerationService } from './service';

const SCHEDULER_INTERVAL_MS = 60 * 60 * 1_000;
const FORMATION_GAP_MS = 10 * 60 * 60 * 1_000;
const MAINTENANCE_GAP_MS = 48 * 60 * 60 * 1_000;
const LOCK_KEY = 'lofiever:music-generation:editorial-lock';

const EDITORIAL_DIRECTIONS = [
  {
    title: 'Rain on the Reading Room',
    mood: 'rainy',
    bpm: 68,
    prompt: 'Warm Rhodes chords, soft vinyl texture, light rain outside a reading room, brushed drums and a restrained bass line',
  },
  {
    title: 'First Train Home',
    mood: 'night',
    bpm: 72,
    prompt: 'Muted jazz guitar, distant electric piano, gentle train ambience, dusty drums and a peaceful late-night progression',
  },
  {
    title: 'Notes Between Pages',
    mood: 'focused',
    bpm: 76,
    prompt: 'Minimal piano motif, subtle tape wobble, soft boom bap drums and an unobtrusive arrangement for deep focus',
  },
  {
    title: 'Window Seat Sunlight',
    mood: 'warm',
    bpm: 80,
    prompt: 'Warm acoustic guitar harmonics, mellow keys, compact drums and a bright but relaxed morning atmosphere',
  },
  {
    title: 'Quiet Neon Crossing',
    mood: 'calm',
    bpm: 70,
    prompt: 'Soft analog pads, sparse vibraphone, gentle sub bass and rain-softened city ambience with patient transitions',
  },
  {
    title: 'After the Last Email',
    mood: 'melancholic',
    bpm: 66,
    prompt: 'Felt piano, low cello textures, restrained vinyl noise and slow brushed percussion with a comforting resolution',
  },
] as const;

let schedulerInterval: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function sevenDaysAgo(now: Date): Date {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
}

export async function runEditorialMusicGenerationTick(now: Date = new Date()): Promise<void> {
  if (!config.musicGeneration.enabled) return;

  const locked = await redis.set(LOCK_KEY, String(process.pid), 'EX', 5 * 60, 'NX');
  if (locked !== 'OK') return;

  try {
    const publishedCount = await prisma.musicGeneration.count({
      where: { source: 'EDITORIAL', status: 'PUBLISHED' },
    });
    const formingCatalog = publishedCount < config.musicGeneration.editorialCatalogTarget;
    const periodStart = formingCatalog ? utcDayStart(now) : sevenDaysAgo(now);
    const periodTarget = formingCatalog
      ? config.musicGeneration.editorialDailyTarget
      : config.musicGeneration.editorialWeeklyTarget;
    const gapMs = formingCatalog ? FORMATION_GAP_MS : MAINTENANCE_GAP_MS;

    const [periodCount, latest] = await Promise.all([
      prisma.musicGeneration.count({
        where: {
          source: 'EDITORIAL',
          status: { in: ['QUEUED', 'GENERATING', 'VALIDATING', 'PUBLISHED'] },
          createdAt: { gte: periodStart },
        },
      }),
      prisma.musicGeneration.findFirst({
        where: {
          source: 'EDITORIAL',
          status: { in: ['QUEUED', 'GENERATING', 'VALIDATING', 'PUBLISHED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    if (periodCount >= periodTarget) return;
    if (latest && now.getTime() - latest.createdAt.getTime() < gapMs) return;

    const slot = Math.floor(now.getTime() / gapMs);
    const direction = EDITORIAL_DIRECTIONS[slot % EDITORIAL_DIRECTIONS.length];
    const result = await MusicGenerationService.requestGeneration({
      source: 'EDITORIAL',
      prompt: direction.prompt,
      title: direction.title,
      mood: direction.mood,
      bpm: direction.bpm,
      locale: 'pt',
      idempotencyKey: `editorial-${formingCatalog ? 'formation' : 'maintenance'}-${slot}`,
    });

    if (result.accepted) {
      console.log(`[MusicGeneration] Editorial generation queued: ${result.generationId}`);
    } else {
      console.warn(`[MusicGeneration] Editorial generation skipped: ${result.code}`);
    }
  } finally {
    await redis.del(LOCK_KEY);
  }
}

export function startEditorialMusicScheduler(): void {
  if (schedulerInterval || !config.musicGeneration.enabled) return;

  startupTimer = setTimeout(() => {
    runEditorialMusicGenerationTick().catch((error) => {
      console.error('[MusicGeneration] Editorial startup tick failed:', error);
    });
  }, 30_000);
  startupTimer.unref();

  schedulerInterval = setInterval(() => {
    runEditorialMusicGenerationTick().catch((error) => {
      console.error('[MusicGeneration] Editorial scheduler tick failed:', error);
    });
  }, SCHEDULER_INTERVAL_MS);
  schedulerInterval.unref();

  console.log('[MusicGeneration] Editorial scheduler started');
}

export function stopEditorialMusicScheduler(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
