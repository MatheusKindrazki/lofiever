import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import { closeMusicGenerationQueue } from '@/services/music-generation/queue';
import { MusicGenerationService } from '@/services/music-generation/service';

const DIRECTIONS = [
  {
    title: 'Chuva Entre Páginas',
    mood: 'rainy',
    bpm: 68,
    prompt: 'Warm electric piano chords, soft vinyl texture, light rain around a quiet reading room, brushed drums, restrained bass, and a patient melody',
  },
  {
    title: 'Último Trem da Noite',
    mood: 'night',
    bpm: 72,
    prompt: 'Muted jazz guitar, distant electric piano, gentle train ambience, dusty drums, rounded bass, and a peaceful late-night progression',
  },
  {
    title: 'Luzes na Janela',
    mood: 'calm',
    bpm: 74,
    prompt: 'Soft analog pads, sparse vibraphone, warm electric piano, gentle sub bass, compact drums, and rain-softened city ambience',
  },
  {
    title: 'Café Antes do Sol',
    mood: 'warm',
    bpm: 78,
    prompt: 'Warm acoustic guitar harmonics, mellow keys, subtle tape texture, compact drums, and a bright but relaxed early-morning atmosphere',
  },
  {
    title: 'Silêncio Depois do E-mail',
    mood: 'melancholic',
    bpm: 66,
    prompt: 'Felt piano, low cello textures, restrained vinyl noise, slow brushed percussion, and a comforting harmonic resolution',
  },
] as const;

function requestedCount(): number {
  const value = Number.parseInt(process.argv[2] || '3', 10);
  if (!Number.isInteger(value) || value < 1 || value > DIRECTIONS.length) {
    throw new Error(`Informe uma quantidade entre 1 e ${DIRECTIONS.length}.`);
  }
  return value;
}

async function main(): Promise<void> {
  const count = requestedCount();
  const batchDate = new Date().toISOString().slice(0, 10);

  for (const direction of DIRECTIONS.slice(0, count)) {
    const result = await MusicGenerationService.requestGeneration({
      source: 'EDITORIAL',
      prompt: direction.prompt,
      title: direction.title,
      mood: direction.mood,
      bpm: direction.bpm,
      locale: 'pt',
      idempotencyKey: `production-launch-${batchDate}-${direction.bpm}`,
    });

    if (!result.accepted) {
      throw new Error(`${direction.title}: ${result.code} — ${result.message}`);
    }

    console.log(`QUEUED ${result.generationId} ${result.title}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMusicGenerationQueue();
    await prisma.$disconnect();
  });
