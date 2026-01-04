import { NextResponse } from "next/server";
import { PlaylistManagerService } from "@/services/playlist/playlist-manager.service";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { R2Lib } from "@/lib/r2";
import type { Track } from "@prisma/client";

interface QueueTrack extends Track {
  addedBy?: string;
  addedByUserId?: string;
  requestId?: string;
}

/**
 * GET - Endpoint para o Liquidsoap obter a próxima faixa
 * Esta rota é chamada pelo script Liquidsoap para obter a URL da próxima música
 */
export async function GET(): Promise<NextResponse> {
  try {
    // 1. Obter a próxima faixa da fila dinâmica (Redis)
    // Isso já lida com refill automático via IA e prioridade de pedidos
    const nextTrack = (await PlaylistManagerService.getNextTrack()) as QueueTrack;

    if (!nextTrack) {
      console.error("[Next Track] Failed to get next track from PlaylistManager");
      return new NextResponse("/music/example.mp3", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 2. Registrar no histórico de playback (Prisma)
    try {
      // Obter versão da playlist (opcional, mantendo compatibilidade)
      const versionStr = await redis.get("lofiever:playlist:version");
      const version = versionStr ? parseInt(versionStr, 10) : 1;

      await prisma.playbackHistory.create({
        data: {
          trackId: nextTrack.id,
          startedAt: new Date(),
          version: version,
        },
      });
      console.log(
        "[Next Track] Recorded playback history for:",
        nextTrack.title,
      );
    } catch (historyError) {
      console.error("[Next Track] Failed to record history:", historyError);
    }

    // NOTE: We do NOT update currentTrack here anymore!
    // The track will be updated when Liquidsoap calls /api/track-started
    // This prevents pre-buffering desync issues

    // 4. Construir URL do arquivo para o Liquidsoap
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
      `[Next Track] Serving: "${nextTrack.title}" by ${nextTrack.artist} (ID: ${nextTrack.id})`,
    );
    console.log(`[Next Track] URL: ${trackUrl.substring(0, 100)}...`);

    // Store this track as "last-requested" for the track-started callback
    // Construct artwork URL
    let artworkUrl = "/images/default-cover.jpg";
    if (nextTrack.artworkKey) {
      try {
        // Generate presigned URL valid for 1 hour
        artworkUrl = await R2Lib.getPresignedUrl(nextTrack.artworkKey, 3600);
      } catch (error) {
        console.error(`[Next Track] Failed to generate presigned artwork URL:`, error);
        // Fallback to default if generation fails
        artworkUrl = "/images/default-cover.jpg";
      }
    }

    const trackForBuffer = {
      id: nextTrack.id,
      title: nextTrack.title,
      artist: nextTrack.artist,
      sourceType: nextTrack.sourceType,
      sourceId: nextTrack.sourceId,
      duration: nextTrack.duration,
      bpm: nextTrack.bpm || undefined,
      mood: nextTrack.mood || undefined,
      artworkUrl,
    };

    await redis.set(
      "lofiever:last-requested-track",
      JSON.stringify(trackForBuffer),
      "EX",
      600 // Expire after 10 minutes
    );

    // Add track to Liquidsoap buffer (this represents what Liquidsoap has buffered to play)
    await redis.rpush(
      "lofiever:liquidsoap:buffer",
      JSON.stringify(trackForBuffer)
    );

    console.log(`[Next Track] Added to Liquidsoap buffer: ${nextTrack.title}`);

    // Retornar URL da faixa como texto simples
    // Também incluímos metadados no header para o Liquidsoap usar no callback
    return new NextResponse(trackUrl.trim(), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Track-Id": nextTrack.id,
        "X-Track-Title": nextTrack.title,
        "X-Track-Artist": nextTrack.artist,
      },
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
