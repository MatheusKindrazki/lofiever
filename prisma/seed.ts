import { PrismaClient } from '@prisma/client';
import { DatabaseService } from '@/services/database';

const prisma = new PrismaClient();

// Interface para os dados de música
interface TrackData {
  title: string;
  artist: string;
  sourceType: string;
  sourceId: string;
  duration: number;
  bpm: number;
  mood: string;
}

// Lista de músicas lofi sem copyright
const lofiTracks: TrackData[] = [
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

// Lista de músicas gratuitas de Benjamin Tissot (bensound.com)
const freeMusicTracks: TrackData[] = [
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

/**
 * Script unificado para popular o banco de dados com músicas lofi e músicas gratuitas
 * Execute com:
 * npx tsx prisma/seeds/seed.ts
 */
async function seedDatabase(): Promise<void> {
  console.log('🚀 Iniciando seed do banco de dados...');
  
  try {
    // Contagem inicial de músicas
    const initialCount = await prisma.track.count();
    console.log(`ℹ️ O banco já possui ${initialCount} músicas.`);
    
    let totalCreated = 0;
    
    // Função para processar uma lista de músicas
    async function processTrackList(tracks: TrackData[], source: string): Promise<number> {
      let createdCount = 0;
      
      console.log(`\n📀 Processando ${tracks.length} músicas de ${source}...`);
      
      for (const track of tracks) {
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
      
      console.log(`🎵 ${createdCount} novas músicas de ${source} adicionadas.`);
      return createdCount;
    }
    
    // Processar listas de músicas
    const lofiCreated = await processTrackList(lofiTracks, 'Lofi Collection');
    const freeCreated = await processTrackList(freeMusicTracks, 'Bensound Collection');
    
    totalCreated = lofiCreated + freeCreated;
    
    // Criar uma playlist ativa com todas as músicas se houver novas músicas
    if (totalCreated > 0) {
      console.log('\n⏳ Criando playlist ativa...');
      
      // Obter todos os IDs de faixas
      const tracks = await prisma.track.findMany({
        select: { id: true },
      });
      
      const trackIds = tracks.map((t: { id: string }) => t.id);
      
      // Criar nova playlist
      const playlist = await DatabaseService.createNewPlaylist(trackIds);
      
      console.log(`✅ Playlist ativa criada com ${playlist.tracks.length} músicas!`);
    }
    
    const finalCount = await prisma.track.count();
    console.log('\n📊 Resultados finais:');
    console.log(`   Músicas iniciais: ${initialCount}`);
    console.log(`   Músicas adicionadas: ${totalCreated}`);
    console.log(`   Total de músicas: ${finalCount}`);
    console.log('\n🎉 Seed concluído com sucesso!');
  } catch (error) {
    console.error('❌ Erro durante o seed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar o seed
seedDatabase()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })