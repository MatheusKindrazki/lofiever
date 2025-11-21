import { NextResponse } from "next/server";
import { DatabaseService } from "@/services/database";
import { redisHelpers, redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { R2Lib } from "@/lib/r2";

/**
 * GET - Endpoint para o Liquidsoap obter a próxima faixa
 * Esta rota é chamada pelo script Liquidsoap para obter a URL da próxima música
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Obter playlist ativa
    const playlist = await DatabaseService.getActivePlaylist();

    if (!playlist || playlist.tracks.length === 0) {
      console.log("[Next Track] No active playlist, returning fallback");
      return new NextResponse("/music/example.mp3", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Obter posição atual da playlist do Redis
    const currentPositionStr = await redis.get("lofiever:playlist:position");
    let currentPosition = currentPositionStr
      ? parseInt(currentPositionStr, 10)
      : -1;

    // Calcular próxima posição (circular)
    const nextPosition = (currentPosition + 1) % playlist.tracks.length;
    const nextTrackItem = playlist.tracks[nextPosition];

    if (!nextTrackItem || !nextTrackItem.track) {
      console.error("[Next Track] No track found at position", nextPosition);
      return new NextResponse("/music/example.mp3", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const nextTrack = nextTrackItem.track;

    // Atualizar posição no Redis
    await redis.set("lofiever:playlist:position", nextPosition.toString());

    // Registrar no histórico de playback
    try {
      await prisma.playbackHistory.create({
        data: {
          trackId: nextTrack.id,
          startedAt: new Date(),
          version: playlist.version,
        },
      });
      console.log(
        "[Next Track] Recorded playback history for:",
        nextTrack.title,
      );
    } catch (historyError) {
      console.error("[Next Track] Failed to record history:", historyError);
    }

    // Construir artwork URL
    let artworkUrl = "/images/default-cover.jpg";
    if (nextTrack.artworkKey) {
      artworkUrl = nextTrack.artworkKey;
    }

    // Atualizar faixa atual no Redis
    await redisHelpers.setCurrentTrack({
      id: nextTrack.id,
      title: nextTrack.title,
      artist: nextTrack.artist,
      sourceType: nextTrack.sourceType as "spotify" | "youtube",
      sourceId: nextTrack.sourceId,
      duration: nextTrack.duration,
      bpm: nextTrack.bpm || undefined,
      mood: nextTrack.mood || undefined,
      artworkUrl,
    });

    // Publicar evento de nova track para os clientes
    await redis.publish(
      "lofi-ever:new-track",
      JSON.stringify({
        id: nextTrack.id,
        title: nextTrack.title,
        artist: nextTrack.artist,
        duration: nextTrack.duration,
        artworkUrl,
        mood: nextTrack.mood,
        bpm: nextTrack.bpm,
      }),
    );

    // Construir URL do arquivo baseado no sourceType
    let trackUrl = "";

    switch (nextTrack.sourceType) {
      case "local":
        trackUrl = `/music/${nextTrack.sourceId}`;
        break;
      case "s3":
      case "r2":
        // Gerar URL pré-assinada do R2/S3 (expira em 1 hora)
        trackUrl = await R2Lib.getPresignedUrl(nextTrack.sourceId, 3600);
        break;
      default:
        console.warn(
          `[Next Track] Unknown sourceType: ${nextTrack.sourceType}, using fallback`,
        );
        trackUrl = "/music/example.mp3";
    }

    console.log(
      `[Next Track] Position ${nextPosition}: "${nextTrack.title}" by ${nextTrack.artist}`,
    );
    console.log(`[Next Track] URL: ${trackUrl.substring(0, 100)}...`);

    // Retornar URL da faixa como texto simples (formato esperado pelo Liquidsoap)
    return new NextResponse(trackUrl, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (error) {
    console.error("Error getting next track:", error);

    // Retornar faixa padrão em caso de erro
    return new NextResponse("/music/example.mp3", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
