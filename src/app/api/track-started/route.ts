import { NextResponse, NextRequest } from "next/server";
import { redisHelpers, redis } from "@/lib/redis";

/**
 * POST - Callback do Liquidsoap quando uma track REALMENTE começa a tocar
 * Esta rota é chamada pelos callbacks on_track do Liquidsoap
 * Ela pega a última track solicitada e a marca como "currentTrack"
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
    try {
        console.log("[Track Started] Callback received from Liquidsoap");

        let trackId: string | undefined;
        try {
            const body = await request.json();
            trackId = body.trackId;
            console.log(`[Track Started] Received trackId: ${trackId}`);
        } catch (e) {
            console.log("[Track Started] No JSON body or trackId provided");
        }

        let trackJson: string | null = null;

        if (trackId) {
            // Smart Sync: Find the track in the buffer
            const buffer = await redis.lrange("lofiever:liquidsoap:buffer", 0, -1);
            let foundIndex = -1;

            for (let i = 0; i < buffer.length; i++) {
                const t = JSON.parse(buffer[i]);
                if (t.id === trackId) {
                    foundIndex = i;
                    trackJson = buffer[i];
                    break;
                }
            }

            if (foundIndex !== -1) {
                console.log(`[Track Started] Found track ${trackId} at index ${foundIndex}. Syncing buffer...`);
                // Remove this track AND all previous tracks (they were skipped or played while we were down)
                // LTRIM to keep only elements from foundIndex + 1 onwards
                if (foundIndex < buffer.length - 1) {
                    await redis.ltrim("lofiever:liquidsoap:buffer", foundIndex + 1, -1);
                } else {
                    // If it's the last item, clear the list
                    await redis.del("lofiever:liquidsoap:buffer");
                }
            } else {
                console.warn(`[Track Started] Track ${trackId} not found in buffer. It might have been already popped or is a fallback.`);
                // If not found, we can't rely on buffer.
                // But we should try to update currentTrack if we can fetch the track details.
                // For now, let's just return success but log warning.
                return NextResponse.json({ success: true, warning: "Track not found in buffer" });
            }
        } else {
            // Legacy behavior: Pop the first track
            trackJson = await redis.lpop("lofiever:liquidsoap:buffer");
        }

        if (!trackJson) {
            console.log("[Track Started] No track found to play (Buffer empty or ID not found)");
            return NextResponse.json(
                { error: "No track found" },
                { status: 404 }
            );
        }

        const track = JSON.parse(trackJson);
        console.log(`[Track Started] Starting track: ${track.title} by ${track.artist}`);

        // Now update currentTrack in Redis (the track is ACTUALLY playing now)
        await redisHelpers.setCurrentTrack(track);

        // Publish event to connected clients
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
            })
        );

        console.log(`[Track Started] Updated currentTrack in Redis: ${track.title}`);

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error) {
        console.error("[Track Started] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
