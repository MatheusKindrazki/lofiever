import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { redisHelpers, redis } from '@/lib/redis';
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import { isPlayableSourceType } from '@/services/playlist/source-policy';
import { authOptions } from '@/lib/auth/options';
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
      } catch {
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
      } catch {
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

interface AddToQueueBody {
  trackId?: unknown;
}

// POST - Adiciona uma faixa do catálogo (já tocável) à fila de reprodução.
// Recebe { trackId }, autentica via NextAuth, valida que a faixa existe e que
// a fonte é tocável (sem depender do YouTube), então delega ao
// PlaylistManagerService.queueTrack. Não usa nenhuma API externa.
//
// Nota de design: a validação usa `isPlayableSourceType` (r2/s3/local apenas) e
// NÃO `getAllowedSourceTypes`. Isso é intencional: um pedido manual de faixa
// YouTube é o caminho frágil (yt-dlp/bot-detection) que a rádio evita — portanto
// enfileirar YouTube por este endpoint é sempre bloqueado, mesmo quando
// config.youtube.enabled é true. O YouTube só entra via seleção automática.
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Security Check (origin + rate limit)
  const securityError = await validateRequest(request, {
    rateLimit: RATE_LIMITS.api,
  });
  if (securityError) return securityError;

  // Authentication (NextAuth session required)
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.email) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  try {
    let body: AddToQueueBody;
    try {
      body = (await request.json()) as AddToQueueBody;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 }
      );
    }

    const trackId = body.trackId;
    if (typeof trackId !== 'string' || trackId.trim().length === 0) {
      return NextResponse.json(
        { error: "Field 'trackId' is required", code: 'INVALID_TRACK_ID' },
        { status: 400 }
      );
    }

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) {
      return NextResponse.json(
        { error: 'Track not found', code: 'TRACK_NOT_FOUND' },
        { status: 404 }
      );
    }

    if (!isPlayableSourceType(track.sourceType)) {
      return NextResponse.json(
        {
          error: 'Track source is not playable without YouTube',
          code: 'UNPLAYABLE_SOURCE',
          sourceType: track.sourceType,
        },
        { status: 422 }
      );
    }

    // Identidade estável do usuário derivada da sessão NextAuth.
    // Cria um rótulo público não sensível em vez de expor o email.
    const buildPublicLabel = (email: string): string => {
      const localPart = email.split('@')[0];
      return `Usuário ${localPart.charAt(0).toUpperCase() + localPart.slice(1)}`;
    };
    const publicLabel = user.name || buildPublicLabel(user.email);
    const userId = user.email;

    await PlaylistManagerService.queueTrack(track.id, publicLabel, false, userId);

    return NextResponse.json(
      {
        queued: {
          id: track.id,
          title: track.title,
          artist: track.artist,
          mood: track.mood,
          duration: track.duration,
          sourceType: track.sourceType,
          addedBy: publicLabel,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error adding track to queue:', error);
    return NextResponse.json(
      { error: 'Failed to add track to queue', code: 'QUEUE_ADD_FAILED' },
      { status: 500 }
    );
  }
}
