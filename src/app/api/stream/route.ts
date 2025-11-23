import { NextResponse } from 'next/server';
import { DatabaseService } from '@/services/database';
import { redisHelpers, redis } from '@/lib/redis';
import { handleApiError } from '@/lib/api-utils';

// GET - Obter dados da stream atual
export async function GET(): Promise<NextResponse> {
  try {
    // Obter dados em paralelo
    const [currentRedisTrack, streamStats, bufferTracks] = await Promise.all([
      redisHelpers.getCurrentTrack(),
      DatabaseService.getStreamStats(),
      redis.lrange("lofiever:liquidsoap:buffer", 0, 4), // Get first 5 buffered tracks
    ]);

    if (!currentRedisTrack) {
      return NextResponse.json(
        { error: 'Nenhuma faixa ativa encontrada no cache do Redis.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Build nextUp from the Liquidsoap buffer (what will ACTUALLY play next)
    const nextUp = bufferTracks.map((trackJson: string) => {
      try {
        return JSON.parse(trackJson);
      } catch {
        return null;
      }
    }).filter(Boolean);

    const streamData = {
      currentSong: {
        ...currentRedisTrack,
        streamUrl: '/api/stream/audio-stream?proxy=true',
      },
      listeners: streamStats.currentListeners,
      daysActive: streamStats.daysActive,
      songsPlayed: streamStats.totalTracksPlayed,
      nextUp, // This now shows what Liquidsoap has buffered, not the DB playlist order
    };

    return NextResponse.json(streamData, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
