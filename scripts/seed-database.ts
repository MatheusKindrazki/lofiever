import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sampleTracks = [
  {
    title: "Midnight Coffee",
    artist: "Sleepy Beats",
    sourceType: "local",
    sourceId: "example.mp3",
    duration: 180,
    bpm: 75,
    mood: "calm",
  },
  {
    title: "Urban Rain",
    artist: "City Lofi",
    sourceType: "local", 
    sourceId: "example.mp3",
    duration: 195,
    bpm: 80,
    mood: "melancholic",
  },
  {
    title: "Study Break",
    artist: "Chill Academia",
    sourceType: "local",
    sourceId: "example.mp3", 
    duration: 210,
    bpm: 70,
    mood: "focused",
  },
  {
    title: "Empty Streets",
    artist: "Night Walker",
    sourceType: "local",
    sourceId: "example.mp3",
    duration: 225,
    bpm: 65,
    mood: "atmospheric",
  },
  {
    title: "Morning Pages",
    artist: "Ambient Thoughts",
    sourceType: "local",
    sourceId: "example.mp3",
    duration: 190,
    bpm: 85,
    mood: "inspired",
  },
  {
    title: "Lazy Sunday",
    artist: "Weekend Vibes",
    sourceType: "local",
    sourceId: "example.mp3",
    duration: 205,
    bpm: 72,
    mood: "relaxed",
  },
  {
    title: "Neon Dreams",
    artist: "Synthwave Lofi",
    sourceType: "local",
    sourceId: "example.mp3",
    duration: 188,
    bpm: 78,
    mood: "nostalgic",
  },
  {
    title: "Coffee Shop",
    artist: "Acoustic Chill",
    sourceType: "local",
    sourceId: "example.mp3",
    duration: 172,
    bpm: 68,
    mood: "cozy",
  }
];

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');

  // Limpar dados existentes
  await prisma.playlistTrack.deleteMany();
  await prisma.playlist.deleteMany();
  await prisma.playbackHistory.deleteMany();
  await prisma.feedback.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.track.deleteMany();

  console.log('🗑️  Cleared existing data');

  // Criar faixas
  const tracks = [];
  for (const trackData of sampleTracks) {
    const track = await prisma.track.create({
      data: trackData,
    });
    tracks.push(track);
    console.log(`✅ Created track: ${track.title} by ${track.artist}`);
  }

  // Criar playlist ativa
  const playlist = await prisma.playlist.create({
    data: {
      version: 1,
      active: true,
      tracks: {
        create: tracks.map((track, index) => ({
          trackId: track.id,
          position: index,
        })),
      },
    },
    include: {
      tracks: {
        include: {
          track: true,
        },
      },
    },
  });

  console.log(`🎵 Created playlist with ${playlist.tracks.length} tracks`);

  // Criar algumas mensagens de chat de exemplo
  const chatMessages = [
    {
      userId: 'system',
      content: 'Welcome to Lofiever! Enjoy the music 🎵',
      type: 'system',
    },
    {
      userId: 'user1',
      content: 'Love this track! Perfect for studying',
      type: 'user',
    },
    {
      userId: 'user2', 
      content: 'This playlist is amazing 🔥',
      type: 'user',
    },
  ];

  for (const messageData of chatMessages) {
    await prisma.chatMessage.create({
      data: messageData,
    });
  }

  console.log('💬 Created sample chat messages');

  console.log('🎉 Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 