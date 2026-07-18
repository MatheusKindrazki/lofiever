import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PlaylistManagerService } from "@/services/playlist/playlist-manager.service";
import { recommendNextTrack } from "@/services/playlist/ai-recommendation.service";
import { redis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { R2Lib } from "@/lib/r2";
import type { Track } from "@prisma/client";
import { YouTubeCacheService } from '@/services/youtube';
import { normalizeYouTubeVideoId } from '@/services/youtube';
import { config } from '@/lib/config';
import { isPlayableSourceType } from "@/services/playlist/source-policy";

interface QueueTrack extends Track {
  addedBy?: string;
  addedByUserId?: string;
  requestId?: string;
}

function resolveInternalServeBaseUrl(request: NextRequest): string {
  if (process.env.APP_INTERNAL_URL) {
    return process.env.APP_INTERNAL_URL.replace(/\/$/, '');
  }

  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (forwardedHost) {
    const protocol = forwardedProto || request.nextUrl.protocol.replace(':', '') || 'http';
    return `${protocol}://${forwardedHost}`.replace(/\/$/, '');
  }

  if (config.app.internalUrl) {
    return config.app.internalUrl.replace(/\/$/, '');
  }

  return 'http://localhost:3000';
}

const LAST_RESORT_URL = "/music/example.mp3";

/**
 * Resolve a URL tocável de uma faixa garantidamente de fonte tocável
 * (local / s3 / r2). NÃO lida com YouTube e, por isso, nunca recursa de volta
 * ao caminho de YouTube. Retorna null se a fonte não for tocável diretamente.
 */
async function resolvePlayableSourceUrl(track: Track): Promise<string | null> {
  switch (track.sourceType) {
    case "local":
      return `/music/${track.sourceId}`;
    case "s3":
    case "r2":
      // Gerar URL pré-assinada do R2/S3 (expira em 1 hora)
      return await R2Lib.getPresignedUrl(track.sourceId, 3600);
    default:
      return null;
  }
}

/**
 * Re-seleciona uma faixa garantidamente tocável (R2/S3/local) quando a faixa
 * de YouTube escolhida não pôde ser resolvida ou o YouTube está desabilitado.
 *
 * Limitado e SEM recursão: faz UMA chamada a recommendNextTrack. Com o YouTube
 * desabilitado, recommendNextTrack só pode devolver fontes tocáveis; e mesmo
 * quando habilitado, só aceitamos o resultado se for de fonte tocável
 * (isPlayableSourceType), descartando qualquer linha 'youtube'. Garante término.
 *
 * @returns A faixa tocável e sua URL, ou null se não houver alternativa.
 */
async function reselectPlayableTrack(
  excludeId: string,
): Promise<{ track: Track; trackUrl: string } | null> {
  try {
    const candidate = await recommendNextTrack(undefined, [excludeId], []);
    if (!candidate || !isPlayableSourceType(candidate.sourceType)) {
      console.warn(
        `[Next Track] Re-selection yielded non-playable source (${candidate?.sourceType ?? 'none'}); falling back to last resort.`,
      );
      return null;
    }
    const url = await resolvePlayableSourceUrl(candidate);
    if (!url) return null;
    console.log(
      `[Next Track] Re-selected playable track "${candidate.title}" (${candidate.sourceType}) after YouTube failure.`,
    );
    return { track: candidate, trackUrl: url };
  } catch (error) {
    console.error("[Next Track] Re-selection of playable track failed:", error);
    return null;
  }
}

/**
 * Resolve a faixa que será efetivamente servida e sua URL.
 * Para YouTube: tenta resolver; se desabilitado ou falhar, re-seleciona uma
 * faixa tocável (R2/S3/local) em vez de cair direto no placeholder.
 * `/music/example.mp3` permanece APENAS como último recurso guardado.
 */
async function resolveServedTrack(
  request: NextRequest,
  nextTrack: QueueTrack,
): Promise<{ track: QueueTrack; trackUrl: string }> {
  // Fontes tocáveis diretas (local/s3/r2) nunca falham por dependência externa.
  const directUrl = await resolvePlayableSourceUrl(nextTrack);
  if (directUrl) {
    return { track: nextTrack, trackUrl: directUrl };
  }

  if (nextTrack.sourceType === "youtube") {
    if (config.youtube.enabled) {
      try {
        const normalizedVideoId = normalizeYouTubeVideoId(nextTrack.sourceId);
        await YouTubeCacheService.ensureCached(normalizedVideoId);
        const baseUrl = resolveInternalServeBaseUrl(request);
        return {
          track: nextTrack,
          trackUrl: `${baseUrl}/api/youtube/serve/${normalizedVideoId}`,
        };
      } catch (error) {
        console.error(
          `[Next Track] YouTube cache failed for ${nextTrack.sourceId}, re-selecting playable track:`,
          error,
        );
      }
    } else {
      console.warn(
        "[Next Track] YouTube disabled; re-selecting a playable R2/S3/local track.",
      );
    }
  } else {
    console.warn(
      `[Next Track] Unknown sourceType: ${nextTrack.sourceType}; re-selecting a playable track.`,
    );
  }

  // Re-seleção limitada para uma faixa tocável garantida.
  const reselected = await reselectPlayableTrack(nextTrack.id);
  if (reselected) {
    return {
      track: { ...reselected.track } as QueueTrack,
      trackUrl: reselected.trackUrl,
    };
  }

  // Último recurso guardado: só chega aqui se a re-seleção não achou NENHUMA
  // faixa tocável (catálogo sem r2/s3/local). Mantém a rádio no ar.
  console.error(
    "[Next Track] No playable track available after re-selection; using last-resort placeholder.",
  );
  return { track: nextTrack, trackUrl: LAST_RESORT_URL };
}

/**
 * GET - Endpoint para o Liquidsoap obter a próxima faixa
 * Esta rota é chamada pelo script Liquidsoap para obter a URL da próxima música
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Obter a próxima faixa da fila dinâmica (Redis)
    // Isso já lida com refill automático via IA e prioridade de pedidos
    const selectedTrack = (await PlaylistManagerService.getNextTrack()) as QueueTrack;

    if (!selectedTrack) {
      console.error("[Next Track] Failed to get next track from PlaylistManager");
      return new NextResponse(LAST_RESORT_URL, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 2. Resolver a URL tocável (com re-seleção R2/S3/local se o YouTube falhar
    //    ou estiver desabilitado). A faixa efetivamente servida (`nextTrack`)
    //    pode diferir da escolhida na fila quando houve re-seleção.
    const { track: nextTrack, trackUrl } = await resolveServedTrack(
      request,
      selectedTrack,
    );

    // 3. Registrar no histórico de playback (Prisma) — usa a faixa servida.
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
      origin: nextTrack.origin,
      duration: nextTrack.duration,
      bpm: nextTrack.bpm || undefined,
      mood: nextTrack.mood || undefined,
      artworkUrl,
      addedBy: nextTrack.addedBy,
      addedByUserId: nextTrack.addedByUserId,
      requestId: nextTrack.requestId,
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
