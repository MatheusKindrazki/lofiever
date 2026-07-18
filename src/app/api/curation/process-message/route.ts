// src/app/api/curation/process-message/route.ts
import { streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { ModerationService } from '@/services/moderation/moderation.service';
import { prisma } from '@/lib/prisma';
import { redisHelpers, redis } from '@/lib/redis';
import { handleApiError } from '@/lib/api-utils';
import {
  InvalidYouTubeVideoIdError,
  normalizeYouTubeVideoId,
  YouTubeAuthenticationError,
  YouTubeService,
  type YouTubeTrackInfo,
} from '@/services/youtube';
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import { config } from '@/lib/config';
import { MusicGenerationService } from '@/services/music-generation/service';

export const maxDuration = 30;

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const YOUTUBE_MAX_DURATION_SECONDS = 20 * 60;
const YOUTUBE_MIN_DURATION_SECONDS = 30;
const YOUTUBE_SEARCH_LIMIT = 8;

const SYSTEM_PROMPT = `
Você é "Lofine", DJ virtual da rádio lo-fi Lofiever.

## Tom e estilo
- Natural, humano, curto e relaxado.
- Responda em 1-2 frases na maior parte dos casos.
- Sem linguagem robótica, sem frases repetitivas e sem roteiro engessado.
- Só faça pergunta quando for necessário para desambiguar um pedido.

## Comportamento
- Comentário casual/elogio: responda de forma leve e curta (sem oferecer serviço toda hora).
- Pedido explícito de música: use ferramentas para adicionar faixa.
- Pedido explícito para criar uma música nova/original: use request_original_track, nunca request_track.
- Pedido por mood (estudo, foco, relaxar etc.): use request_tracks_by_mood.
- Mudança de nome: use update_username.
- Sempre responda após usar ferramenta.

## YouTube (fallback automático)
- Primeiro tente catálogo local via request_track.
- Se não houver no catálogo, use YouTube automaticamente.
- Não exponha resultado bruto de ferramenta; fale como DJ.
- Não adicione faixas acima de 20 minutos.

## Regras
- Nunca invente música inexistente.
- Faixas originais são sempre lo-fi instrumentais. Não use nomes de artistas, músicas existentes ou pedidos de imitação na descrição enviada à ferramenta.
- Preserve o contexto (público vs privado) e fale de forma inclusiva no público.
`;

function isAllowedYouTubeDuration(duration: number): boolean {
  return duration > YOUTUBE_MIN_DURATION_SECONDS && duration <= YOUTUBE_MAX_DURATION_SECONDS;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function scoreYouTubeMatch(track: YouTubeTrackInfo, query: string): number {
  const q = query.toLowerCase();
  const title = track.title.toLowerCase();
  const artist = track.artist.toLowerCase();
  const tokens = tokenize(query);

  let score = 0;
  if (title.includes(q)) score += 6;
  if (artist.includes(q)) score += 4;

  for (const token of tokens) {
    if (title.includes(token)) score += 2;
    if (artist.includes(token)) score += 1;
  }

  if (track.duration > 0) {
    const distanceToTarget = Math.abs(track.duration - 180);
    score -= Math.min(distanceToTarget / 120, 2);
  }

  return score;
}

function pickBestYouTubeMatch(results: YouTubeTrackInfo[], query: string): YouTubeTrackInfo | null {
  if (results.length === 0) return null;

  return [...results]
    .sort((a, b) => scoreYouTubeMatch(b, query) - scoreYouTubeMatch(a, query))[0];
}

function normalizeToolOutput(value: unknown): string {
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value
      .map(normalizeToolOutput)
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (!value || typeof value !== 'object') return '';

  const data = value as Record<string, unknown>;

  if (typeof data.text === 'string') return data.text;
  if (typeof data.message === 'string') return data.message;
  if (typeof data.content === 'string') return data.content;

  if (Array.isArray(data.content)) {
    const text = data.content
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && typeof (entry as { text?: unknown }).text === 'string') {
          return (entry as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    if (text) return text;
  }

  return '';
}

function getToolResultText(toolResult: unknown): string {
  if (!toolResult || typeof toolResult !== 'object') {
    return normalizeToolOutput(toolResult);
  }

  const data = toolResult as Record<string, unknown>;
  return (
    normalizeToolOutput(data.output)
    || normalizeToolOutput(data.result)
    || normalizeToolOutput(data.text)
    || normalizeToolOutput(data.content)
  );
}

export async function POST(req: Request) {
  try {
    const { messages, data } = await req.json();
    const userId = data.userId || 'anonymous-user';
    const username = data.username || `user_${userId.substring(0, 5)}`;
    const isPrivate = data.isPrivate || false;
    const locale: 'pt' | 'en' = data.locale === 'en' ? 'en' : 'pt';
    const internalSecret = process.env.API_SECRET_KEY;
    const trustedInternalRequest = !internalSecret
      || req.headers.get('x-lofiever-internal-key') === internalSecret;
    const authenticatedUserId = trustedInternalRequest && typeof data.authenticatedUserId === 'string'
      ? data.authenticatedUserId
      : undefined;
    const ipAddress = trustedInternalRequest && typeof data.ipAddress === 'string'
      ? data.ipAddress
      : undefined;
    const clientMessageId = trustedInternalRequest && typeof data.clientMessageId === 'string'
      ? data.clientMessageId
      : undefined;

    const t = {
      youtubeDisabled: locale === 'en'
        ? 'YouTube integration is currently disabled.'
        : 'A integração com YouTube está desativada no momento.',
      invalidYoutubeId: locale === 'en'
        ? 'Invalid YouTube track link/ID.'
        : 'Link/ID do YouTube inválido.',
      youtubeLongTrack: locale === 'en'
        ? 'This track is too long for the radio queue (max 20 minutes).'
        : 'Essa faixa é longa demais para a fila da rádio (máximo de 20 minutos).',
      youtubeNotFound: locale === 'en'
        ? 'I could not find a good YouTube version for this request.'
        : 'Não encontrei uma versão boa no YouTube para esse pedido.',
      youtubeSearchError: locale === 'en'
        ? 'Failed to search YouTube right now. Try again in a moment.'
        : 'Falhei ao buscar no YouTube agora. Tenta de novo em instantes.',
      youtubeAuthError: locale === 'en'
        ? 'YouTube is temporarily unavailable due to authentication. Please try again in a bit.'
        : 'O YouTube está indisponível no momento por autenticação/cookies. Tenta de novo em instantes.',
      youtubeAddError: locale === 'en'
        ? 'Could not add this YouTube track right now.'
        : 'Não consegui adicionar essa faixa do YouTube agora.',
      youtubeAlreadyQueued: (title: string) => locale === 'en'
        ? `"${title}" is already in queue and will play soon.`
        : `"${title}" já está na fila e toca em breve.`,
      youtubeAdded: (title: string, artist: string) => locale === 'en'
        ? `Added "${title}" by ${artist} from YouTube. It should play soon.`
        : `Adicionei "${title}" de ${artist} pelo YouTube. Deve tocar em breve.`,
      localNotFoundFallbackFailed: (query: string) => locale === 'en'
        ? `I couldn't find "${query}" in the local catalog or YouTube.`
        : `Não encontrei "${query}" no catálogo local nem no YouTube.`,
    };

    console.log('[AI Curation] Processing message for user:', userId);
    console.log('[AI Curation] Messages count:', messages.length);
    console.log('[AI Curation] Is Private:', isPrivate);
    console.log('[AI Curation] Locale:', locale);

    let systemPrompt = SYSTEM_PROMPT;
    systemPrompt += '\n\n## Idioma\n';
    if (locale === 'en') {
      systemPrompt += '- Reply in natural English with a chill DJ tone.\n';
      systemPrompt += '- Keep answers short and avoid repeated phrasing.\n';
    } else {
      systemPrompt += '- Responda em português brasileiro natural, curto e fluido.\n';
      systemPrompt += '- Evite respostas mecânicas e frases repetidas.\n';
    }

    if (isPrivate) {
      systemPrompt += `\n\n[CONTEXTO: CONVERSA PRIVADA com ${username}]\nSó esse usuário está lendo.`;
    } else {
      systemPrompt += '\n\n[CONTEXTO: CHAT PÚBLICO]\nSua resposta será lida por todos os ouvintes.';
    }

    const recordTrackRequest = async (
      query: string,
      status: string,
      reason: string,
      trackId?: string,
    ): Promise<void> => {
      try {
        await prisma.trackRequest.create({
          data: {
            userId,
            username,
            query,
            trackId: trackId || null,
            status,
            reason,
            processedAt: new Date(),
            processedBy: 'auto',
          },
        });
      } catch (error) {
        console.error('[AI Curation] Failed to persist track request audit:', error);
      }
    };

    const addYouTubeTrackToQueue = async ({
      videoId,
      title,
      artist,
      query,
      enforceCooldown = true,
    }: {
      videoId: string;
      title?: string;
      artist?: string;
      query: string;
      enforceCooldown?: boolean;
    }): Promise<string> => {
      if (!config.youtube.enabled) {
        return `❌ ${t.youtubeDisabled}`;
      }

      let normalizedVideoId: string;
      try {
        normalizedVideoId = normalizeYouTubeVideoId(videoId);
      } catch (error) {
        if (error instanceof InvalidYouTubeVideoIdError) {
          await recordTrackRequest(query, 'rejected', 'Invalid YouTube ID');
          return `❌ ${t.invalidYoutubeId}`;
        }
        throw error;
      }

      if (enforceCooldown) {
        const cooldownCheck = await ModerationService.checkCooldown(userId);
        if (!cooldownCheck.approved) {
          await recordTrackRequest(query, 'rejected', cooldownCheck.reason);
          return `❌ ${cooldownCheck.reason}`;
        }
      }

      const rateCheck = await ModerationService.checkRateLimit(userId);
      if (!rateCheck.approved) {
        await recordTrackRequest(query, 'rejected', rateCheck.reason);
        return `❌ ${rateCheck.reason}`;
      }

      let info: YouTubeTrackInfo;
      try {
        info = await YouTubeService.getTrackInfo(normalizedVideoId);
      } catch (error) {
        console.error('[AI Curation] Failed to load YouTube metadata:', error);
        if (error instanceof YouTubeAuthenticationError) {
          await recordTrackRequest(query, 'rejected', 'YouTube authentication required');
          return `❌ ${t.youtubeAuthError}`;
        }
        await recordTrackRequest(query, 'rejected', 'Failed to fetch YouTube metadata');
        return `❌ ${t.youtubeAddError}`;
      }

      if (!isAllowedYouTubeDuration(info.duration)) {
        await recordTrackRequest(query, 'rejected', `Duration not allowed: ${info.duration}`);
        return `❌ ${t.youtubeLongTrack}`;
      }

      const resolvedTitle = (title || info.title).trim();
      const resolvedArtist = (artist || info.artist).trim();

      const track = await prisma.track.upsert({
        where: {
          sourceType_sourceId: {
            sourceType: 'youtube',
            sourceId: normalizedVideoId,
          },
        },
        update: {
          title: resolvedTitle,
          artist: resolvedArtist,
          duration: info.duration,
        },
        create: {
          title: resolvedTitle,
          artist: resolvedArtist,
          sourceType: 'youtube',
          sourceId: normalizedVideoId,
          duration: info.duration,
          mood: 'relaxed',
        },
      });

      const duplicateCheck = await ModerationService.checkDuplicate(track.id);
      if (!duplicateCheck.approved) {
        await recordTrackRequest(query, 'rejected', duplicateCheck.reason, track.id);
        return `🎧 ${t.youtubeAlreadyQueued(track.title)}`;
      }

      await PlaylistManagerService.queueTrack(track.id, username, false, userId);
      await ModerationService.incrementUserStats(userId, true);
      await recordTrackRequest(query, 'auto_approved', 'YouTube request approved', track.id);

      return `✅ ${t.youtubeAdded(track.title, track.artist)}`;
    };

    const searchAndAddYouTubeFallback = async (query: string): Promise<string> => {
      if (!config.youtube.enabled) {
        return `❌ ${t.youtubeDisabled}`;
      }

      try {
        const rawResults = await YouTubeService.search(query, YOUTUBE_SEARCH_LIMIT);

        const filtered = rawResults.filter((result) => {
          if (result.duration <= 0) return true;
          return isAllowedYouTubeDuration(result.duration);
        });

        const best = pickBestYouTubeMatch(filtered, query);
        if (!best) {
          await recordTrackRequest(query, 'not_found', 'No suitable YouTube result');
          return `❌ ${t.localNotFoundFallbackFailed(query)}`;
        }

        return addYouTubeTrackToQueue({
          videoId: best.videoId,
          title: best.title,
          artist: best.artist,
          query,
          enforceCooldown: false,
        });
      } catch (error) {
        console.error('[AI Curation] YouTube fallback search failed:', error);
        if (error instanceof YouTubeAuthenticationError) {
          await recordTrackRequest(query, 'rejected', 'YouTube authentication required');
          return `❌ ${t.youtubeAuthError}`;
        }
        await recordTrackRequest(query, 'rejected', 'YouTube search fallback failed');
        return `❌ ${t.youtubeSearchError}`;
      }
    };

    const result = streamText({
      model: openai('gpt-4o-mini'),
      system: systemPrompt,
      messages,

      onFinish: async ({ text, toolResults }) => {
        console.log('[AI Curation] Finished');
        console.log('[AI Curation] Final text length:', text?.length || 0);
        if (toolResults && toolResults.length > 0) {
          console.log('[AI Curation] Tool results count:', toolResults.length);
        }
      },
      tools: {
        request_original_track: tool({
          description: 'Cria uma faixa lo-fi instrumental original para o Lofiever. Use somente quando o ouvinte pedir explicitamente uma música nova, original ou feita para ele.',
          inputSchema: z.object({
            description: z.string().min(10).max(600).describe('Descrição por instrumentos, clima, textura e ritmo, sem nomes de artistas ou músicas existentes'),
            title: z.string().min(3).max(80).describe('Título original curto para a nova faixa'),
            mood: z.string().min(3).max(30).describe('Mood curto, como calm, focused, rainy, night ou warm'),
            bpm: z.number().int().min(55).max(95).optional().describe('BPM lo-fi entre 55 e 95'),
          }),
          execute: async ({ description, title, mood, bpm }) => {
            const generation = await MusicGenerationService.requestGeneration({
              source: 'USER',
              prompt: description,
              title,
              mood,
              bpm,
              locale,
              userId: authenticatedUserId,
              username,
              ipAddress,
              idempotencyKey: clientMessageId,
            });

            return generation.accepted
              ? `✅ ${generation.message}`
              : `❌ ${generation.message}`;
          },
        }),

        request_track: tool({
          description: 'Solicita uma música específica. Primeiro tenta catálogo local; se não achar, cai para YouTube automaticamente.',
          inputSchema: z.object({
            query: z.string().describe('O nome da música, artista, ou ambos. Ex: "Kupla", "Shook - Holding On", "algo do idealism"'),
          }),
          execute: async ({ query }) => {
            console.log('[Tool: request_track] Executing with query:', query);

            const cooldownCheck = await ModerationService.checkCooldown(userId);
            if (!cooldownCheck.approved) {
              await recordTrackRequest(query, 'rejected', cooldownCheck.reason);
              return `❌ ${cooldownCheck.reason}`;
            }

            const candidates = await prisma.track.findMany({
              where: {
                OR: [
                  { title: { contains: query, mode: 'insensitive' } },
                  { artist: { contains: query, mode: 'insensitive' } },
                ],
              },
              take: 10,
            });

            if (candidates.length === 0) {
              return searchAndAddYouTubeFallback(query);
            }

            const shuffled = candidates.sort(() => Math.random() - 0.5);
            let lastDuplicateTitle = '';

            for (const track of shuffled) {
              const dupCheck = await ModerationService.checkDuplicate(track.id);
              if (!dupCheck.approved) {
                lastDuplicateTitle = track.title;
                continue;
              }

              const moderationResult = await ModerationService.processTrackRequest(
                userId,
                username,
                track.title,
                { ignoreCooldown: true },
              );

              if (moderationResult.approved) {
                return locale === 'en'
                  ? `✅ Added "${moderationResult.trackTitle}" by ${moderationResult.trackArtist} to the queue.`
                  : `✅ Adicionei "${moderationResult.trackTitle}" de ${moderationResult.trackArtist} na fila!`;
              }

              if (moderationResult.reason.includes('limite') || moderationResult.reason.includes('Aguarde')) {
                return `❌ ${moderationResult.reason}`;
              }
            }

            if (lastDuplicateTitle) {
              return locale === 'en'
                ? `🎧 Good news: tracks like "${lastDuplicateTitle}" are already in queue.`
                : `🎧 Boa notícia: músicas desse tipo (como "${lastDuplicateTitle}") já estão na fila.`;
            }

            return locale === 'en'
              ? '❌ Could not add your request right now. Try another song.'
              : '❌ Não consegui adicionar seu pedido agora. Tenta outra música!';
          },
        }),

        request_tracks_by_mood: tool({
          description: 'Solicita músicas aleatórias. Use para pedidos como "algo pra estudar", "música relaxante", etc.',
          inputSchema: z.object({
            mood: z.string().describe('O mood/clima desejado (ex: focused, relaxed, calm, energetic)'),
            count: z.number().min(1).max(3).optional().describe('Quantas músicas adicionar (1-3)'),
          }),
          execute: async ({ mood, count = 1 }) => {
            try {
              console.log('[Tool: request_tracks_by_mood] Executing with mood:', mood, 'count:', count);

              const cooldownCheck = await ModerationService.checkCooldown(userId);
              if (!cooldownCheck.approved) {
                return `❌ ${cooldownCheck.reason}`;
              }

              const poolSize = 50;
              let tracks = await prisma.track.findMany({
                where: { mood: { contains: mood, mode: 'insensitive' } },
                take: poolSize,
              });

              if (tracks.length === 0) {
                const allTracks = await prisma.track.findMany({
                  select: { id: true },
                });

                const shuffled = allTracks.sort(() => Math.random() - 0.5);
                const randomIds = shuffled.slice(0, poolSize).map((track) => track.id);

                tracks = await prisma.track.findMany({
                  where: { id: { in: randomIds } },
                });
              }

              tracks = tracks.sort(() => Math.random() - 0.5);

              if (tracks.length === 0) {
                return locale === 'en'
                  ? `❌ I don't have tracks with "${mood}" vibe right now.`
                  : `❌ Poxa, não tenho músicas com o clima "${mood}" agora.`;
              }

              const added: string[] = [];
              let lastFailureReason = '';

              for (const track of tracks) {
                if (added.length >= count) break;

                const dupCheck = await ModerationService.checkDuplicate(track.id);
                if (!dupCheck.approved) {
                  continue;
                }

                const moderationResult = await ModerationService.processTrackRequest(
                  userId,
                  username,
                  track.title,
                  { ignoreCooldown: true },
                );

                if (moderationResult.approved) {
                  added.push(`"${track.title}"`);
                  continue;
                }

                lastFailureReason = moderationResult.reason;
                if (moderationResult.reason.includes('limite')) {
                  if (added.length > 0) {
                    return locale === 'en'
                      ? `✅ Added ${added.length} track(s): ${added.join(', ')}. You hit your request limit for now.`
                      : `✅ Adicionei ${added.length} música(s): ${added.join(', ')}. Você atingiu seu limite por enquanto.`;
                  }
                  return `❌ ${moderationResult.reason}`;
                }
              }

              if (added.length === 0) {
                if (lastFailureReason && lastFailureReason.includes('limite')) {
                  return `❌ ${lastFailureReason}`;
                }

                return locale === 'en'
                  ? '⚠️ All suggestions are already in queue. Try a specific request.'
                  : '⚠️ Todas as sugestões que encontrei já estão na fila. Tenta pedir uma específica!';
              }

              return locale === 'en'
                ? `✅ Added ${added.length} track(s): ${added.join(', ')}.`
                : `✅ Pronto! Adicionei ${added.length} música(s): ${added.join(', ')}.`;
            } catch (error) {
              console.error('[Tool: request_tracks_by_mood] Error:', error);
              return locale === 'en'
                ? '❌ Error while searching mood tracks. Try again.'
                : '❌ Ops, ocorreu um erro ao buscar músicas. Tenta novamente!';
            }
          },
        }),

        get_user_stats: tool({
          description: 'Mostra as estatísticas de pedidos do usuário (quantos pedidos restam, etc).',
          inputSchema: z.object({
            _unused: z.string().optional().describe('Parâmetro não utilizado'),
          }),
          execute: async () => {
            const stats = await ModerationService.getUserStats(userId);

            if (locale === 'en') {
              return `Your requests:\n- ${stats.remainingHourly} requests left this hour (max 5)\n- ${stats.remainingDaily} requests left today (max 20)\n- Total approved requests: ${stats.approvedRequests}`;
            }

            return `Seus pedidos:\n- Restam ${stats.remainingHourly} pedidos nessa hora (de 5)\n- Restam ${stats.remainingDaily} pedidos hoje (de 20)\n- Total de pedidos aprovados: ${stats.approvedRequests}`;
          },
        }),

        get_current_track: tool({
          description: 'Obtém informações sobre a música tocando agora.',
          inputSchema: z.object({
            _unused: z.string().optional().describe('Parâmetro não utilizado'),
          }),
          execute: async () => {
            const track = await redisHelpers.getCurrentTrack();
            if (!track) {
              return locale === 'en'
                ? 'I cannot see the current track right now. It may still be loading.'
                : 'Não sei qual música está tocando agora. Deve estar carregando!';
            }

            const bpmInfo = track.bpm ? ` (${track.bpm} BPM)` : '';
            const moodInfo = track.mood ? ` | Mood: ${track.mood}` : '';

            return locale === 'en'
              ? `Now playing "${track.title}" by ${track.artist}${bpmInfo}${moodInfo}`
              : `Agora tá tocando "${track.title}" de ${track.artist}${bpmInfo}${moodInfo}`;
          },
        }),

        get_playlist_queue: tool({
          description: 'Mostra as próximas músicas na fila.',
          inputSchema: z.object({
            limit: z.number().min(1).max(5).default(3).describe('Quantas músicas mostrar'),
          }),
          execute: async ({ limit }) => {
            const activePlaylist = await redisHelpers.getActivePlaylist();

            if (!activePlaylist || activePlaylist.length === 0) {
              return locale === 'en'
                ? 'Queue is empty right now. Want to request something?'
                : 'A fila tá vazia no momento. Que tal sugerir uma música?';
            }

            const upcoming = activePlaylist.slice(0, limit);
            if (upcoming.length === 0) {
              return locale === 'en'
                ? 'Only current track is in queue. Send a request!'
                : 'Só tem a música atual na fila. Manda um pedido!';
            }

            const list = upcoming
              .map((track, index) => `${index + 1}. "${track.title}" - ${track.artist}`)
              .join('\n');

            return locale === 'en'
              ? `Up next:\n${list}`
              : `Próximas na fila:\n${list}`;
          },
        }),

        update_username: tool({
          description: 'Atualiza o nome de exibição do usuário.',
          inputSchema: z.object({
            newUsername: z.string().min(2).max(20).describe('O novo nome desejado'),
          }),
          execute: async ({ newUsername }) => {
            console.log('[Tool: update_username] Request:', newUsername);

            if (newUsername.toLowerCase().includes('admin') || newUsername.toLowerCase().includes('dj')) {
              return locale === 'en'
                ? '❌ This name is not allowed. Please choose another.'
                : '❌ Esse nome não é permitido. Escolha outro!';
            }

            try {
              await redisHelpers.setUserName(userId, newUsername);
              await redis.publish('lofi-ever:user-update', JSON.stringify({ userId, username: newUsername }));

              return locale === 'en'
                ? `✅ Done! I'll call you ${newUsername} now.`
                : `✅ Feito! Agora vou te chamar de ${newUsername}.`;
            } catch (error) {
              console.error('[Tool: update_username] Error:', error);
              return locale === 'en'
                ? '❌ Could not save your name right now. Try again?'
                : '❌ Tive um problema pra salvar seu nome. Tenta de novo?';
            }
          },
        }),

        search_youtube: tool({
          description: 'Busca faixas no YouTube e retorna resultados filtrados por duração.',
          inputSchema: z.object({
            query: z.string().describe('Search query (e.g. "lofi chill beats", "nujabes feather")'),
            limit: z.number().min(1).max(5).default(3).describe('Max results'),
          }),
          execute: async ({ query, limit }) => {
            if (!config.youtube.enabled) {
              return `❌ ${t.youtubeDisabled}`;
            }

            try {
              const rawResults = await YouTubeService.search(query, Math.min(limit * 3, YOUTUBE_SEARCH_LIMIT));
              const results = rawResults
                .filter((result) => result.duration <= 0 || isAllowedYouTubeDuration(result.duration))
                .slice(0, limit);

              if (results.length === 0) {
                return `❌ ${t.youtubeNotFound}`;
              }

              const list = results
                .map((result, index) => {
                  const duration = result.duration > 0
                    ? `${Math.floor(result.duration / 60)}:${String(result.duration % 60).padStart(2, '0')}`
                    : '--:--';
                  return `${index + 1}. "${result.title}" - ${result.artist} (${duration}) [ID: ${result.videoId}]`;
                })
                .join('\n');

              return locale === 'en'
                ? `YouTube results for "${query}":\n${list}`
                : `Resultados no YouTube para "${query}":\n${list}`;
            } catch (error) {
              console.error('[Tool: search_youtube] Error:', error);
              if (error instanceof YouTubeAuthenticationError) {
                return `❌ ${t.youtubeAuthError}`;
              }
              return `❌ ${t.youtubeSearchError}`;
            }
          },
        }),

        add_youtube_track: tool({
          description: 'Adiciona uma faixa do YouTube na fila da rádio.',
          inputSchema: z.object({
            videoId: z.string().describe('The YouTube video ID or URL'),
            title: z.string().optional().describe('Track title (optional, metadata fallback)'),
            artist: z.string().optional().describe('Track artist (optional, metadata fallback)'),
          }),
          execute: async ({ videoId, title, artist }) => {
            console.log('[Tool: add_youtube_track] Adding:', videoId, title, artist);
            return addYouTubeTrackToQueue({
              videoId,
              title,
              artist,
              query: `${title || ''} ${artist || ''}`.trim() || videoId,
            });
          },
        }),
      },
    });

    const transformedStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let hasText = false;

        try {
          for await (const chunk of result.textStream) {
            if (chunk) {
              hasText = true;
              controller.enqueue(encoder.encode(chunk));
            }
          }

          if (!hasText) {
            const toolResults = await result.toolResults;
            console.log('[AI Curation] No text generated, using tool results');

            if (toolResults && toolResults.length > 0) {
              let wroteToolOutput = false;
              for (const toolResult of toolResults) {
                const output = getToolResultText(toolResult).trim();
                if (output) {
                  wroteToolOutput = true;
                  controller.enqueue(encoder.encode(output));
                }
              }

              if (!wroteToolOutput) {
                controller.enqueue(encoder.encode(
                  locale === 'en'
                    ? 'I had a small issue while handling your request. Please try again in a moment.'
                    : 'Tive um pequeno problema pra processar isso. Tenta novamente em instantes.',
                ));
              }
            } else {
              controller.enqueue(encoder.encode(
                locale === 'en'
                  ? 'Sorry, I could not process that right now. Try again?'
                  : 'Desculpa, não consegui processar seu pedido agora. Tenta de novo?',
              ));
            }
          }
        } catch (error) {
          console.error('[AI Curation] Stream error:', error);
          controller.enqueue(encoder.encode(
            locale === 'en'
              ? 'Oops, something went wrong. Please try again.'
              : 'Ops, ocorreu um erro. Tenta novamente!',
          ));
        }

        controller.close();
      },
    });

    return new Response(transformedStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
