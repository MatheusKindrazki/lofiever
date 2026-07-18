import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Track as RedisTrack } from "@/lib/redis";
import { redisHelpers, redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";

const LIQUIDSOAP_BUFFER_KEY = "lofiever:liquidsoap:buffer";

interface BufferedTrack extends RedisTrack {
  origin?: "catalog" | "generated_user" | "generated_editorial";
  addedByUserId?: string;
  requestId?: string;
}

interface TrackStartedPayload {
  trackId?: string;
  generationId?: string;
}

function parseBufferedTrack(trackJson: string | null): BufferedTrack | null {
  if (!trackJson) return null;

  try {
    return JSON.parse(trackJson) as BufferedTrack;
  } catch (error) {
    console.error("[Track Started] Invalid track JSON in Liquidsoap buffer:", error);
    return null;
  }
}

async function trimBufferThroughIndex(bufferLength: number, foundIndex: number): Promise<void> {
  if (foundIndex < bufferLength - 1) {
    await redis.ltrim(LIQUIDSOAP_BUFFER_KEY, foundIndex + 1, -1);
    return;
  }

  await redis.del(LIQUIDSOAP_BUFFER_KEY);
}

async function resolveTrackFromDatabase(trackId: string): Promise<BufferedTrack | null> {
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) return null;

  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    sourceType: track.sourceType as BufferedTrack["sourceType"],
    sourceId: track.sourceId,
    origin: track.origin as BufferedTrack["origin"],
    duration: track.duration,
    bpm: track.bpm ?? undefined,
    mood: track.mood ?? undefined,
    artworkUrl: "/images/default-cover.jpg",
  };
}

async function takeStartedTrack(trackId?: string): Promise<BufferedTrack | null> {
  if (!trackId) {
    return parseBufferedTrack(await redis.lpop(LIQUIDSOAP_BUFFER_KEY));
  }

  const buffer = await redis.lrange(LIQUIDSOAP_BUFFER_KEY, 0, -1);

  for (let index = 0; index < buffer.length; index += 1) {
    const track = parseBufferedTrack(buffer[index]);
    if (track?.id !== trackId) continue;

    console.log(`[Track Started] Found track ${trackId} at index ${index}. Syncing buffer...`);
    await trimBufferThroughIndex(buffer.length, index);
    return track;
  }

  // Compatibility with the old Liquidsoap parser. Generated object keys use
  // /music/generated/{generationId}/..., but the old script sent the first 36
  // characters after /music/ (for example "generated/80ce...") as trackId.
  // In that case the actual started track is still the first buffered item.
  if (trackId.startsWith("generated/")) {
    console.warn(
      `[Track Started] Received legacy generated id ${trackId}; consuming the buffer head.`,
    );
    return parseBufferedTrack(await redis.lpop(LIQUIDSOAP_BUFFER_KEY));
  }

  // If the application restarted after Liquidsoap downloaded the audio, the
  // Redis buffer may be empty. A regular object URL still carries the Track id,
  // so recover its metadata from Postgres instead of leaving clients stale.
  const recoveredTrack = await resolveTrackFromDatabase(trackId);
  if (recoveredTrack) {
    console.warn(`[Track Started] Recovered track ${trackId} from Postgres after buffer miss.`);
    return recoveredTrack;
  }

  return null;
}

/**
 * Callback do Liquidsoap quando uma faixa realmente começa a tocar.
 * Este é o único ponto que avança currentTrack, relógio e histórico.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    console.log("[Track Started] Callback received from Liquidsoap");

    let payload: TrackStartedPayload = {};
    try {
      payload = (await request.json()) as TrackStartedPayload;
    } catch {
      console.log("[Track Started] No JSON body provided; using buffer order");
    }

    let trackId = payload.trackId;
    if (payload.generationId) {
      const generation = await prisma.musicGeneration.findUnique({
        where: { id: payload.generationId },
        select: { trackId: true },
      });
      trackId = generation?.trackId ?? undefined;
      console.log(
        `[Track Started] Resolved generation ${payload.generationId} to track ${trackId ?? "none"}`,
      );
    } else {
      console.log(`[Track Started] Received trackId: ${trackId ?? "none"}`);
    }

    const track = await takeStartedTrack(trackId);
    if (!track) {
      console.warn(
        `[Track Started] Could not resolve started track (${trackId ?? payload.generationId ?? "buffer head"}).`,
      );
      return NextResponse.json(
        { success: true, warning: "Track could not be resolved" },
        { status: 200 },
      );
    }

    console.log(`[Track Started] Starting track: ${track.title} by ${track.artist}`);

    const startedAt = new Date();
    const startedAtMs = startedAt.getTime();

    // Redis and the realtime event follow the audio start, never the prefetch.
    await redisHelpers.setCurrentTrack(track);
    await redisHelpers.setPlaybackState({
      isPlaying: true,
      timestamp: startedAtMs,
      position: 0,
      startedAt: startedAtMs,
    });

    // History is observational: a database problem must not prevent live UI
    // synchronization, but it is logged and retriable from the next callback.
    try {
      const versionStr = await redis.get("lofiever:playlist:version");
      const version = versionStr ? Number.parseInt(versionStr, 10) : 1;

      await prisma.playbackHistory.create({
        data: {
          trackId: track.id,
          startedAt,
          version: Number.isNaN(version) ? 1 : version,
        },
      });
      await prisma.track.update({
        where: { id: track.id },
        data: { lastPlayed: startedAt },
      });

      if (track.requestId) {
        await prisma.trackRequest.update({
          where: { id: track.requestId },
          data: { status: "played", processedAt: startedAt },
        });
      }
    } catch (historyError) {
      console.error("[Track Started] Failed to persist actual playback:", historyError);
    }

    await redis.publish(
      "lofi-ever:new-track",
      JSON.stringify({
        id: track.id,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        artworkUrl: track.artworkUrl,
        mood: track.mood,
        bpm: track.bpm,
        origin: track.origin,
        addedBy: track.addedBy,
        addedByUserId: track.addedByUserId,
        requestId: track.requestId,
      }),
    );
    await redis.publish("lofi-ever:queue-update", "updated");

    console.log(`[Track Started] Synchronized actual playback: ${track.title}`);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("[Track Started] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
