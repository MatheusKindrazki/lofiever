import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const freeMusicData = [
  {
    title: "Dreams",
    artist: "Benjamin Tissot",
    sourceType: "free-api",
    sourceId: "https://www.bensound.com/bensound-music/bensound-dreams.mp3",
    duration: 202, // 3:22
    bpm: 130,
    mood: "chill",
  },
  {
    title: "Acoustic Breeze",
    artist: "Benjamin Tissot",
    sourceType: "free-api",
    sourceId: "https://www.bensound.com/bensound-music/bensound-acousticbreeze.mp3",
    duration: 159, // 2:39
    bpm: 90,
    mood: "peaceful",
  },
  {
    title: "A New Beginning",
    artist: "Benjamin Tissot",
    sourceType: "free-api",
    sourceId: "https://www.bensound.com/bensound-music/bensound-anewbeginning.mp3",
    duration: 164, // 2:44
    bpm: 120,
    mood: "inspirational",
  },
  {
    title: "Creative Minds",
    artist: "Benjamin Tissot",
    sourceType: "free-api",
    sourceId: "https://www.bensound.com/bensound-music/bensound-creativeminds.mp3",
    duration: 106, // 1:46
    bpm: 100,
    mood: "focus",
  },
  {
    title: "Ukulele",
    artist: "Benjamin Tissot",
    sourceType: "free-api",
    sourceId: "https://www.bensound.com/bensound-music/bensound-ukulele.mp3",
    duration: 146, // 2:26
    bpm: 95,
    mood: "happy",
  },
];

async function main(): Promise<void> {
  console.log('Start seeding free music tracks...');

  for (const track of freeMusicData) {
    // Verificar se a música já existe para evitar duplicatas
    const existing = await prisma.track.findFirst({
      where: {
        sourceId: track.sourceId,
      },
    });

    if (!existing) {
      await prisma.track.create({
        data: track,
      });
      console.log(`Added track: ${track.title} by ${track.artist}`);
    } else {
      console.log(`Track already exists: ${track.title} by ${track.artist}`);
    }
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 