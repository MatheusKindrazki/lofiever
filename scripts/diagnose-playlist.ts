import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { KEYS } from '../src/lib/redis';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function diagnose() {
  console.log('=== DIAGNÓSTICO DA PLAYLIST ===\n');

  // 1. Check active playlist
  console.log('1. PLAYLIST ATIVA:');
  const playlist = await prisma.playlist.findFirst({
    where: { active: true },
    include: {
      tracks: {
        orderBy: { position: 'asc' },
        take: 5,
        include: { track: true },
      },
      _count: { select: { tracks: true } },
    },
  });

  if (playlist) {
    console.log(`   ID: ${playlist.id}`);
    console.log(`   Version: ${playlist.version}`);
    console.log(`   Total tracks: ${playlist._count.tracks}`);
    console.log(`   Primeiras 5 tracks:`);
    playlist.tracks.forEach((pt, i) => {
      console.log(`     ${i}. [pos ${pt.position}] ${pt.track.title} - ${pt.track.artist}`);
    });
  } else {
    console.log('   ❌ Nenhuma playlist ativa encontrada!');
  }

  // 2. Check Redis state
  console.log('\n2. ESTADO NO REDIS:');
  const position = await redis.get('lofiever:playlist:position');
  const currentTrack = await redis.get(KEYS.CURRENT_TRACK);
  const listenersCount = await redis.get(KEYS.LISTENERS_COUNT);

  console.log(`   Posição atual: ${position || 'não definida'}`);
  console.log(`   Listeners: ${listenersCount || '0'}`);

  if (currentTrack) {
    const track = JSON.parse(currentTrack);
    console.log(`   Track atual: "${track.title}" - ${track.artist}`);
  } else {
    console.log('   Track atual: não definida');
  }

  // 3. Check playback history
  console.log('\n3. HISTÓRICO DE PLAYBACK:');
  const historyCount = await prisma.playbackHistory.count();
  const recentHistory = await prisma.playbackHistory.findMany({
    take: 5,
    orderBy: { startedAt: 'desc' },
    include: { track: true },
  });

  console.log(`   Total de registros: ${historyCount}`);

  if (recentHistory.length > 0) {
    console.log('   Últimas 5 músicas tocadas:');
    recentHistory.forEach((h, i) => {
      const time = h.startedAt.toLocaleTimeString('pt-BR');
      console.log(`     ${i + 1}. [${time}] ${h.track.title} - ${h.track.artist}`);
    });
  } else {
    console.log('   ❌ Nenhum histórico encontrado!');
  }

  // 4. Check track sample
  console.log('\n4. AMOSTRA DE TRACKS:');
  const sampleTrack = await prisma.track.findFirst({
    select: {
      id: true,
      title: true,
      artist: true,
      sourceType: true,
      sourceId: true,
      artworkKey: true,
    },
  });

  if (sampleTrack) {
    console.log(`   ID: ${sampleTrack.id}`);
    console.log(`   Title: ${sampleTrack.title}`);
    console.log(`   Artist: ${sampleTrack.artist}`);
    console.log(`   Source Type: ${sampleTrack.sourceType}`);
    console.log(`   Source ID: ${sampleTrack.sourceId?.substring(0, 50)}...`);
    console.log(`   Artwork Key: ${sampleTrack.artworkKey || 'não definido'}`);
  }

  // 5. Simulate next-track call
  console.log('\n5. SIMULAÇÃO DE /api/next-track:');
  if (playlist && playlist.tracks.length > 0) {
    const currentPos = position ? parseInt(position, 10) : -1;
    const nextPos = (currentPos + 1) % playlist._count.tracks;

    // Get track at next position
    const nextTrackItem = await prisma.playlistTrack.findFirst({
      where: {
        playlistId: playlist.id,
        position: nextPos,
      },
      include: { track: true },
    });

    if (nextTrackItem) {
      console.log(`   Próxima posição: ${nextPos}`);
      console.log(`   Próxima track: "${nextTrackItem.track.title}" - ${nextTrackItem.track.artist}`);
      console.log(`   Source: ${nextTrackItem.track.sourceType} -> ${nextTrackItem.track.sourceId?.substring(0, 50)}...`);
    } else {
      console.log(`   ❌ Não encontrou track na posição ${nextPos}`);
    }
  }

  // 6. Summary
  console.log('\n=== RESUMO ===');
  const issues: string[] = [];

  if (!playlist) {
    issues.push('Criar playlist ativa');
  }
  if (!position) {
    issues.push('Inicializar posição da playlist (pnpm playlist:reset)');
  }
  if (historyCount === 0) {
    issues.push('Histórico vazio - precisa chamar /api/next-track');
  }

  if (issues.length === 0) {
    console.log('✅ Tudo parece OK!');
  } else {
    console.log('❌ Problemas encontrados:');
    issues.forEach(issue => console.log(`   - ${issue}`));
  }

  await prisma.$disconnect();
  await redis.quit();
}

diagnose().catch(console.error);
