import { prisma } from '@/lib/prisma';
import { DatabaseService } from '@/services/database';

// Lista de músicas sem copyright
const lofiTracks = [
  // YouTube
  {
    title: 'Lofi Hip Hop Radio - Beats to Relax/Study to',
    artist: 'Lofi Girl',
    sourceType: 'youtube',
    sourceId: 'jfKfPfyJRdk', // ID real do vídeo da Lofi Girl
    duration: 3600, // 1 hora em segundos
    bpm: 85,
    mood: 'relaxed'
  },
  {
    title: 'Coffee Shop Radio - Relaxing Jazz & Bossa Nova',
    artist: 'Cafe Music BGM',
    sourceType: 'youtube',
    sourceId: 'DSGyEsJ17cI',
    duration: 3200,
    bpm: 78,
    mood: 'chill'
  },
  // Local (arquivos que estariam em public/music/)
  {
    title: 'Morning Coffee',
    artist: 'Local Artist',
    sourceType: 'local',
    sourceId: 'morning-coffee.mp3',
    duration: 180,
    bpm: 90,
    mood: 'energetic'
  },
  {
    title: 'Rainy Day',
    artist: 'Local Artist',
    sourceType: 'local',
    sourceId: 'rainy-day.mp3',
    duration: 210,
    bpm: 72,
    mood: 'melancholic'
  },
  // S3/Cloud Storage
  {
    title: 'Deep Focus',
    artist: 'Ambient Works',
    sourceType: 's3',
    sourceId: 'music/deep-focus.mp3',
    duration: 240,
    bpm: 65,
    mood: 'focused'
  },
  {
    title: 'Ocean Waves',
    artist: 'Nature Sounds',
    sourceType: 's3',
    sourceId: 'music/ocean-waves.mp3',
    duration: 300,
    bpm: 60,
    mood: 'peaceful'
  },
  // Free Copyright Music APIs
  {
    title: 'Study Session',
    artist: 'ChillHop Records',
    sourceType: 'free-api',
    sourceId: 'chillhop/study-session',
    duration: 185,
    bpm: 80,
    mood: 'studious'
  },
  {
    title: 'Midnight Jazz',
    artist: 'JazzLib',
    sourceType: 'free-api',
    sourceId: 'jazzlib/midnight-jazz',
    duration: 220,
    bpm: 75,
    mood: 'nocturnal'
  }
];

/**
 * Script para popular o banco de dados com músicas lofi sem copyright
 * Execute com:
 * npx ts-node -r tsconfig-paths/register src/scripts/seed-tracks.ts
 */
async function seedTracks(): Promise<void> {
  console.log('🚀 Iniciando seed de músicas lofi...');
  
  try {
    // Verificar se já existem músicas no banco
    const existingCount = await prisma.track.count();
    console.log(`ℹ️ O banco já possui ${existingCount} músicas.`);
    
    // Criar as músicas
    let createdCount = 0;
    
    for (const track of lofiTracks) {
      // Verificar se a música já existe
      const existing = await prisma.track.findFirst({
        where: {
          sourceType: track.sourceType,
          sourceId: track.sourceId,
        },
      });
      
      if (existing) {
        console.log(`⚠️ A música "${track.title}" já existe no banco.`);
        continue;
      }
      
      // Criar nova música
      const newTrack = await prisma.track.create({
        data: track,
      });
      
      console.log(`✅ Música criada: ${newTrack.title} (${newTrack.id})`);
      createdCount++;
    }
    
    console.log(`\n🎵 ${createdCount} novas músicas foram adicionadas ao banco.`);
    
    // Criar uma playlist ativa com essas músicas
    if (createdCount > 0) {
      console.log('⏳ Criando playlist ativa...');
      
      // Obter todos os IDs de faixas
      const tracks = await prisma.track.findMany({
        select: { id: true },
      });
      
      const trackIds = tracks.map((t: { id: string }) => t.id);
      
      // Criar nova playlist
      const playlist = await DatabaseService.createNewPlaylist(trackIds);
      
      console.log(`✅ Playlist ativa criada com ${playlist.tracks.length} músicas!`);
    }
    
    console.log('\n🎉 Seed concluído com sucesso!');
  } catch (error) {
    console.error('❌ Erro durante o seed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar o seed
seedTracks(); 