import { NextResponse } from 'next/server';
import { DatabaseService } from '@/services/database';
import { redisHelpers } from '@/lib/redis';
import { handleApiError } from '@/lib/api-utils';
import type { Track as PrismaTrack } from '@prisma/client';
import { R2Lib } from '@/lib/r2';

// Helper para formatar uma faixa do Prisma para a estrutura esperada pelo frontend
async function formatSongInfo(track: PrismaTrack) {
  let artworkUrl = '/default-cover.jpg'; // Fallback padrão
  if (track.artworkKey) {
    try {
      artworkUrl = await R2Lib.getPresignedUrl(track.artworkKey, 3600); // URL válida por 1 hora
    } catch (error) {
      console.error(`Erro ao gerar URL pré-assinada para artworkKey ${track.artworkKey}:`, error);
    }
  }

  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    artworkUrl: artworkUrl,
  };
}

// GET - Obter dados da stream atual
export async function GET(): Promise<NextResponse> {
  try {
    // Obter dados em paralelo
    const [currentRedisTrack, playlist, streamStats] = await Promise.all([
      redisHelpers.getCurrentTrack(),
      DatabaseService.getActivePlaylist(),
      DatabaseService.getStreamStats(),
    ]);

    if (!currentRedisTrack) {
      return NextResponse.json(
        { error: 'Nenhuma faixa ativa encontrada no cache do Redis.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }
    
    const currentTrack = await prisma.track.findUnique({ where: { id: currentRedisTrack.id }});

    if (!currentTrack) {
      return NextResponse.json(
        { error: 'A faixa ativa não foi encontrada no banco de dados.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const sortedTracks = playlist?.tracks.sort((a, b) => a.position - b.position) || [];
    const currentIndex = sortedTracks.findIndex(pt => pt.trackId === currentTrack.id);

    let nextUpDbTracks: PrismaTrack[] = [];
    if (currentIndex !== -1 && sortedTracks.length > 1) {
        const nextIndex1 = (currentIndex + 1) % sortedTracks.length;
        const nextIndex2 = (currentIndex + 2) % sortedTracks.length;
        nextUpDbTracks = [sortedTracks[nextIndex1].track, sortedTracks[nextIndex2].track]
            .filter(t => t.id !== currentTrack.id).slice(0, 2);
    }

    // Formatar a resposta usando o helper assíncrono
    const formattedCurrentSong = await formatSongInfo(currentTrack);
    const formattedNextUp = await Promise.all(nextUpDbTracks.map(formatSongInfo));

    const streamData = {
      currentSong: {
        ...formattedCurrentSong,
        streamUrl: '/api/stream/audio-stream?proxy=true',
      },
      listeners: streamStats.currentListeners,
      daysActive: streamStats.daysActive,
      songsPlayed: streamStats.totalTracksPlayed,
      nextUp: formattedNextUp,
    };

    return NextResponse.json(streamData, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
 