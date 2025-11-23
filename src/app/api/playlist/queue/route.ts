import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redisHelpers, redis } from '@/lib/redis';
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import { validateRequest, RATE_LIMITS } from '@/lib/api-security';

// Force Node.js runtime
export const runtime = 'nodejs';

const UPCOMING_LIMIT = 10;
const HISTORY_LIMIT = 5;

// Handler implementation
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Security Check
  const securityError = await validateRequest(request, {
    rateLimit: RATE_LIMITS.api,
  });
  if (securityError) return securityError;

  try {
    // Get current track from Redis
    const currentTrack = await redisHelpers.getCurrentTrack();

    // Get current position from Redis
    const currentPositionStr = await redis.get('lofiever:playlist:position');
    const currentPosition = currentPositionStr ? parseInt(currentPositionStr, 10) : 0;

    // Ensure queue is populated
    await PlaylistManagerService.refillQueue();

    // Get upcoming tracks from Redis Queue
    const queueRaw = await redis.lrange('lofiever:playlist:upcoming', 0, UPCOMING_LIMIT - 1);

    // Get tracks currently buffered in Liquidsoap (these will play BEFORE the queue)
    const bufferRaw = await redis.lrange('lofiever:liquidsoap:buffer', 0, 4);

    // Parse buffer tracks
    const bufferTracks = bufferRaw.map(item => {
      try {
        const track = JSON.parse(item);
        return {
          id: track.id,
          title: track.title,
          artist: track.artist,
          mood: track.mood,
          duration: track.duration,
          addedBy: track.addedBy,
          isBuffered: true // Flag to indicate this is already in Liquidsoap
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Parse queue tracks
    const queueTracks = queueRaw.map((item) => {
      try {
        const track = JSON.parse(item);
        return {
          id: track.id,
          title: track.title,
          artist: track.artist,
          mood: track.mood,
          duration: track.duration,
          addedBy: track.addedBy,
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    // Combine buffer + queue for the true "Upcoming" list
    // Filter out any duplicates if necessary (though buffer should be distinct from queue)
    const upcoming = [...bufferTracks, ...queueTracks].slice(0, UPCOMING_LIMIT);

    // Get playback history from database
    const playbackHistory = await prisma.playbackHistory.findMany({
      take: HISTORY_LIMIT,
      orderBy: { startedAt: 'desc' },
      include: {
        track: true,
      },
    });

    // Format history (exclude current track)
    const history = playbackHistory
      .filter((ph) => ph.track && ph.trackId !== currentTrack?.id)
      .slice(0, HISTORY_LIMIT)
      .map((ph) => ({
        id: ph.track.id,
        title: ph.track.title,
        artist: ph.track.artist,
        mood: ph.track.mood,
        duration: ph.track.duration,
        playedAt: ph.startedAt,
      }));

    console.log('[Playlist Queue API] Position:', currentPosition, 'Upcoming:', upcoming.length, 'History:', history.length);

    return NextResponse.json({
      current: currentTrack
        ? {
          id: currentTrack.id,
          title: currentTrack.title,
          artist: currentTrack.artist,
          mood: currentTrack.mood,
          duration: currentTrack.duration,
        }
        : null,
      upcoming,
      history,
      position: currentPosition,
      totalTracks: upcoming.length,
    });
  } catch (error) {
    console.error('Error fetching playlist queue:', error);
    return NextResponse.json({ error: 'Failed to fetch playlist data' }, { status: 500 });
  }
}
