// src/app/api/curation/process-message/route.ts
import { streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { ModerationService } from '@/services/moderation/moderation.service';
import { prisma } from '@/lib/prisma';
import { redisHelpers, redis } from '@/lib/redis';
import { handleApiError } from '@/lib/api-utils';
import { YouTubeService } from '@/services/youtube';
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import { config } from '@/lib/config';

export const maxDuration = 30;

// Inicializa o provedor da OpenAI com a chave de API
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
Você é "Lofine", o DJ virtual da rádio Lo-Fi "Lofiever". Você é carismático, descontraído e apaixonado por música lo-fi.

## Personalidade:
- Fala de forma casual e amigável, como um DJ de rádio real
- Adapte as expressões ao idioma do usuário, mantendo naturalidade e fluidez
- É bem-humorado mas não força piadas
- **EXTREMAMENTE IMPORTANTE**: Você é "chill". Não fique oferecendo ajuda ou perguntando o que o usuário quer ouvir a todo momento.
- Se o usuário apenas comentar algo (ex: "que vibe boa"), apenas concorde e celebre o momento. NÃO pergunte "quer pedir algo?".

## Suas responsabilidades:
1. **Pedidos de música**: Apenas quando o usuário PEDIR EXPLICITAMENTE (ex: "toca X", "quero ouvir Y"). Use 'request_track'.
2. **Pedidos por mood**: Apenas quando o usuário PEDIR EXPLICITAMENTE (ex: "manda algo pra estudar"). Use 'request_tracks_by_mood'.
3. **Informações**: Use 'get_user_stats' se perguntarem sobre limites.
4. **Conversa geral**: Responda de forma natural, curta e "good vibes".

## Regras importantes:
- NUNCA invente músicas que não existem
- Seja conciso (1-2 frases no máximo para chat geral)
- **NÃO FAÇA PERGUNTAS** a menos que precise esclarecer um pedido ambíguo.
- Se o usuário elogiar a rádio, agradeça e só. Não ofereça serviços.
- **NOVOS USUÁRIOS**: Se o nome do usuário for genérico (ex: "user_xxxxx") e for a primeira interação, pergunte casualmente: "E aí! Como você quer ser chamado por aqui?".
- **MUDANÇA DE NOME**: Se o usuário pedir para mudar o nome, use a ferramenta 'update_username'.
- IMPORTANTE: Após usar qualquer ferramenta, SEMPRE responda ao usuário com o resultado.

- **Pedidos de música**: Apenas quando o usuário PEDIR EXPLICITAMENTE com verbos de ação (ex: "toca", "pede", "adiciona", "quero ouvir").
- **NÃO USE FERRAMENTAS** para comentários vagos ou elogios (ex: "show", "que música foda", "braba", "curti"). Apenas responda no chat.

## Exemplos de interação:
- Usuário: "Show essa musica em"
  - Ação: Nenhuma ferramenta
  - Resposta: "Né? Vibe boa demais!"

- Usuário (user_12345): "Oi"
  - Ação: Nenhuma
  - Resposta: "Fala user_12345! Tudo certo? Como prefere ser chamado?"

- Usuário: "Me chama de Juca"
  - Ação: update_username({ newUsername: 'Juca' })
  - Resposta: "Fechou, Juca! Tá anotado."

- Usuário: "Nossa, que música boa"
  - Ação: Nenhuma ferramenta
  - Resposta: "Demais né? Essa bate diferente."

- Usuário: "Eae! Toca aquela do Kupla?"
  - Ação: Usa request_track
  - Resposta: "Boa escolha! Adicionei na fila."

- Usuário: "Quero algo pra estudar"
  - Ação: Usa request_tracks_by_mood com mood 'focused'
  - Resposta: "Separei umas faixas pra foco total. Bons estudos!"

- Usuário: "Nossa, que música boa"
  - Ação: Nenhuma ferramenta
  - Resposta: "Demais né? Essa bate diferente." (NÃO DIGA: "Quer pedir outra?")

- Usuário: "Oi!"
  - Ação: Nenhuma ferramenta
  - Resposta: "E aí! Tudo na paz?" (NÃO DIGA: "Posso ajudar?")

## Modos de Conversa:
- **Público**: Você está falando com TODOS. Seja breve e inclusivo.
- **Privado**: Você está falando apenas com UM usuário. Pode ser mais pessoal, mas mantenha o estilo "chill".
- Se o usuário disser que está em "modo privado" ou "conversa privada", saiba que só ele está lendo.

## YouTube Integration:
- If a user requests a song NOT in the local database, use 'search_youtube' to find it on YouTube.
- After finding results, use 'add_youtube_track' to add the chosen track.
- ALWAYS search local database first (via request_track). Only use YouTube as a secondary source.
- When showing YouTube results, let the user choose which one to add.

## Moods disponíveis:
calm, melancholic, focused, inspired, relaxed, nostalgic, cozy, happy, energetic, studious, nocturnal, peaceful
`;

export async function POST(req: Request) {
  try {
    const { messages, data } = await req.json();
    const userId = data.userId || 'anonymous-user';
    const username = data.username || `user_${userId.substring(0, 5)}`;
    const isPrivate = data.isPrivate || false;
    const locale: 'pt' | 'en' = data.locale === 'en' ? 'en' : 'pt';

    console.log('[AI Curation] Processing message for user:', userId);
    console.log('[AI Curation] Messages count:', messages.length);
    console.log('[AI Curation] Is Private:', isPrivate);
    console.log('[AI Curation] Locale:', locale);

    let systemPrompt = SYSTEM_PROMPT;
    systemPrompt += '\n\n## Idioma\n';
    if (locale === 'en') {
      systemPrompt += '- Respond in natural, friendly English (no Portuguese terms or slang)\n';
      systemPrompt += '- Keep the chill lo-fi DJ vibe and stay concise (1-2 sentences)\n';
    } else {
      systemPrompt += '- Responda em português brasileiro, de forma natural e coloquial (gírias leves são bem-vindas)\n';
      systemPrompt += '- Mantenha o tom chill de DJ lo-fi e seja conciso (1-2 frases)\n';
    }

    if (isPrivate) {
      systemPrompt += `\n\n[CONTEXTO ATUAL: CONVERSA PRIVADA com ${username}]\nVocê está conversando apenas com este usuário. Ninguém mais está lendo.`;
    } else {
      systemPrompt += `\n\n[CONTEXTO ATUAL: CHAT PÚBLICO]\nSua resposta será vista por todos na rádio.`;
    }

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
        request_track: tool({
          description: 'Solicita uma música específica. O sistema de moderação vai verificar rate limits e duplicatas antes de adicionar.',
          inputSchema: z.object({
            query: z.string().describe('O nome da música, artista, ou ambos. Ex: "Kupla", "Shook - Holding On", "algo do idealism"'),
          }),
          execute: async ({ query }) => {
            console.log('[Tool: request_track] Executing with query:', query);

            // 0. Check cooldown first (once for the whole interaction)
            const cooldownCheck = await ModerationService.checkCooldown(userId);
            if (!cooldownCheck.approved) {
              return `❌ ${cooldownCheck.reason}`;
            }

            // 1. Search for multiple candidates to allow for retries/alternatives
            const candidates = await prisma.track.findMany({
              where: {
                OR: [
                  { title: { contains: query, mode: 'insensitive' } },
                  { artist: { contains: query, mode: 'insensitive' } },
                ],
              },
              take: 10, // Look at top 10 matches
            });

            if (candidates.length === 0) {
              return `❌ Não encontrei nenhuma música com "${query}". Tenta outro nome ou artista!`;
            }

            // Shuffle candidates slightly to give variety if query is broad (e.g. "jazz")
            // But keep relevance if it's a specific match (exact matches should be prioritized ideally, but random is okay for "chill" vibe)
            const shuffled = candidates.sort(() => Math.random() - 0.5);

            let lastDuplicateTitle = '';

            for (const track of shuffled) {
              // Pre-check for duplicates
              const dupCheck = await ModerationService.checkDuplicate(track.id);
              if (!dupCheck.approved) {
                console.log(`[Tool: request_track] Skipping duplicate candidate "${track.title}"`);
                lastDuplicateTitle = track.title;
                continue;
              }

              // Try to add the valid candidate
              // We ignore cooldown here because we already checked it at the start,
              // and we don't want retries (due to other reasons) to be blocked by the cooldown update from a failed attempt.
              const result = await ModerationService.processTrackRequest(userId, username, track.title, { ignoreCooldown: true });

              if (result.approved) {
                const response = `✅ Adicionei "${result.trackTitle}" de ${result.trackArtist} na fila! Logo mais ela toca.`;
                console.log('[Tool: request_track] Returning:', response);
                return response;
              } else {
                // If rejected for rate limit, stop immediately
                if (result.reason.includes('limite')) {
                  return `❌ ${result.reason}`;
                }
                // If rejected for cooldown (shouldn't happen with ignoreCooldown, but safe to keep)
                if (result.reason.includes('Aguarde')) {
                  return `❌ ${result.reason}`;
                }
              }
            }

            // If we get here, all candidates were skipped (likely duplicates)
            if (lastDuplicateTitle) {
              return `🎧 Boa notícia! Músicas desse tipo (como "${lastDuplicateTitle}") já estão na fila. Fique ligado que logo toca!`;
            }

            return `❌ Não consegui adicionar seu pedido agora. Tenta outra música!`;
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

              // 0. Check cooldown first (once for the whole interaction)
              const cooldownCheck = await ModerationService.checkCooldown(userId);
              if (!cooldownCheck.approved) {
                return `❌ ${cooldownCheck.reason}`;
              }

              // Fetch a larger pool of candidates to allow for retries (duplicates)
              const poolSize = 50; // Fixed large pool size to handle small catalog/duplicates
              let tracks = await prisma.track.findMany({
                where: { mood: { contains: mood, mode: 'insensitive' } },
                take: poolSize,
              });

              // If no tracks found with mood, get random tracks
              if (tracks.length === 0) {
                console.log('[Tool: request_tracks_by_mood] No tracks with mood, getting random tracks');
                const allTracks = await prisma.track.findMany({
                  select: { id: true },
                });

                // Shuffle and pick random tracks
                const shuffled = allTracks.sort(() => Math.random() - 0.5);
                const randomIds = shuffled.slice(0, poolSize).map(t => t.id);

                tracks = await prisma.track.findMany({
                  where: { id: { in: randomIds } },
                });
              }

              // Shuffle the tracks to ensure variety
              tracks = tracks.sort(() => Math.random() - 0.5);

              console.log('[Tool: request_tracks_by_mood] Found candidate tracks:', tracks.length);

              if (tracks.length === 0) {
                const noTracksResponse = `❌ Poxa, não tenho músicas com o clima "${mood}" agora. Tenta outro mood?`;
                console.log('[Tool: request_tracks_by_mood] No tracks found, returning:', noTracksResponse);
                return noTracksResponse;
              }

              // Try to add tracks through moderation
              const added: string[] = [];
              let lastFailureReason = '';

              for (const track of tracks) {
                // Stop if we have enough tracks
                if (added.length >= count) break;

                // Pre-check for duplicates to avoid triggering user cooldown/stats for system-selected duplicates
                const dupCheck = await ModerationService.checkDuplicate(track.id);
                if (!dupCheck.approved) {
                  console.log(`[Tool: request_tracks_by_mood] Skipping duplicate candidate "${track.title}": ${dupCheck.reason}`);
                  continue;
                }

                console.log('[Tool: request_tracks_by_mood] Processing track:', track.title);
                // Ignore cooldown for individual tracks in the batch/retry loop
                const result = await ModerationService.processTrackRequest(userId, username, track.title, { ignoreCooldown: true });

                if (result.approved) {
                  added.push(`"${track.title}"`);
                } else {
                  lastFailureReason = result.reason;

                  // Check if we should stop trying (Rate Limit)
                  if (result.reason.includes('limite')) {
                    console.log('[Tool: request_tracks_by_mood] Aborting due to rate limit');

                    if (added.length > 0) {
                      return `✅ Adicionei ${added.length} música(s) (${added.join(', ')}), mas você atingiu seu limite de pedidos por enquanto! Aproveita essas.`;
                    }

                    return `❌ ${result.reason}`;
                  }

                  // If rejected for other reasons, continue
                  console.log('[Tool: request_tracks_by_mood] Track rejected, trying next...');
                }
              }

              console.log('[Tool: request_tracks_by_mood] Added:', added.length);

              if (added.length === 0) {
                // If we failed to add any tracks after trying the whole pool
                if (lastFailureReason && lastFailureReason.includes('limite')) {
                  return `❌ ${lastFailureReason}`;
                }
                return `⚠️ Todas as sugestões que encontrei já estão na fila! A rádio tá bombando hoje. Tenta pedir uma específica!`;
              }

              const response = `✅ Pronto! Adicionei ${added.length} música(s) na fila: ${added.join(', ')}. Aproveita!`;
              console.log('[Tool: request_tracks_by_mood] Returning:', response);
              return response;
            } catch (error) {
              console.error('[Tool: request_tracks_by_mood] Error:', error);
              return `❌ Ops, ocorreu um erro ao buscar músicas. Tenta novamente!`;
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

            return `Seus pedidos:
- Restam ${stats.remainingHourly} pedidos nessa hora (de 5)
- Restam ${stats.remainingDaily} pedidos hoje (de 20)
- Total de pedidos aprovados: ${stats.approvedRequests}`;
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
              return "Não sei qual música está tocando agora. Deve estar carregando!";
            }

            const bpmInfo = track.bpm ? ` (${track.bpm} BPM)` : '';
            const moodInfo = track.mood ? ` | Mood: ${track.mood}` : '';

            return `Agora tá tocando "${track.title}" de ${track.artist}${bpmInfo}${moodInfo}`;
          },
        }),

        get_playlist_queue: tool({
          description: 'Mostra as próximas músicas na fila.',
          inputSchema: z.object({
            limit: z.number().min(1).max(5).default(3).describe('Quantas músicas mostrar'),
          }),
          execute: async ({ limit }) => {
            // Fetch from Redis to match what users see in the frontend
            const activePlaylist = await redisHelpers.getActivePlaylist();

            if (!activePlaylist || activePlaylist.length === 0) {
              return "A fila tá vazia no momento. Que tal sugerir uma música?";
            }

            // The first track in activePlaylist is usually the current one or the next one depending on implementation
            // But typically getActivePlaylist returns the *upcoming* queue.
            // Let's verify: redisHelpers.getActivePlaylist() returns the list.
            // In many implementations, index 0 is the *next* track if "current" is stored separately.
            // Let's assume the list is the queue.

            const upcoming = activePlaylist.slice(0, limit);

            if (upcoming.length === 0) {
              return "Só tem a música atual na fila. Manda um pedido!";
            }

            const list = upcoming
              .map((track, i) => `${i + 1}. "${track.title}" - ${track.artist}`)
              .join('\n');

            return `Próximas na fila:\n${list}`;
          },
        }),

        update_username: tool({
          description: 'Atualiza o nome de exibição do usuário.',
          inputSchema: z.object({
            newUsername: z.string().min(2).max(20).describe('O novo nome desejado'),
          }),
          execute: async ({ newUsername }) => {
            console.log('[Tool: update_username] Request:', newUsername);

            // 1. Validate name (simple check for now)
            // In a real app, we would check for profanity here
            if (newUsername.toLowerCase().includes('admin') || newUsername.toLowerCase().includes('dj')) {
              return "❌ Esse nome não é permitido. Escolha outro!";
            }

            try {
              // 2. Update in Redis
              await redisHelpers.setUserName(userId, newUsername);

              // 3. Notify Socket Server via Redis Pub/Sub
              await redis.publish('lofi-ever:user-update', JSON.stringify({ userId, username: newUsername }));

              return `✅ Feito! Agora vou te chamar de ${newUsername}.`;
            } catch (error) {
              console.error('[Tool: update_username] Error:', error);
              return "❌ Tive um problema pra salvar seu nome. Tenta de novo?";
            }
          },
        }),

        search_youtube: tool({
          description: 'Search YouTube for tracks. Use when a user requests a song not found in the local database, or when exploring new music.',
          inputSchema: z.object({
            query: z.string().describe('Search query (e.g. "lofi chill beats", "nujabes feather")'),
            limit: z.number().min(1).max(5).default(3).describe('Max results'),
          }),
          execute: async ({ query, limit }) => {
            if (!config.youtube.enabled) {
              return '❌ YouTube integration is currently disabled.';
            }

            try {
              console.log('[Tool: search_youtube] Searching:', query);
              const results = await YouTubeService.search(query, limit);

              if (results.length === 0) {
                return `❌ No results found for "${query}".`;
              }

              const list = results
                .map((r, i) => `${i + 1}. "${r.title}" - ${r.artist} (${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}) [ID: ${r.videoId}]`)
                .join('\n');

              return `YouTube results for "${query}":\n${list}\n\nUse add_youtube_track to add any of these to the queue.`;
            } catch (error) {
              console.error('[Tool: search_youtube] Error:', error);
              return '❌ Failed to search YouTube. Try again later.';
            }
          },
        }),

        add_youtube_track: tool({
          description: 'Add a YouTube track to the radio queue. Use after search_youtube to add a specific result.',
          inputSchema: z.object({
            videoId: z.string().describe('The YouTube video ID'),
            title: z.string().describe('Track title'),
            artist: z.string().describe('Track artist'),
          }),
          execute: async ({ videoId, title, artist }) => {
            if (!config.youtube.enabled) {
              return '❌ YouTube integration is currently disabled.';
            }

            try {
              console.log('[Tool: add_youtube_track] Adding:', videoId, title, artist);

              // Check cooldown
              const cooldownCheck = await ModerationService.checkCooldown(userId);
              if (!cooldownCheck.approved) {
                return `❌ ${cooldownCheck.reason}`;
              }

              // Get full metadata if needed
              let duration = 180;
              try {
                const info = await YouTubeService.getTrackInfo(videoId);
                duration = info.duration;
              } catch {
                console.warn('[Tool: add_youtube_track] Could not get metadata, using defaults');
              }

              // Upsert track in database
              const track = await prisma.track.upsert({
                where: {
                  sourceType_sourceId: {
                    sourceType: 'youtube',
                    sourceId: videoId,
                  },
                },
                update: { title, artist, duration },
                create: {
                  title,
                  artist,
                  sourceType: 'youtube',
                  sourceId: videoId,
                  duration,
                  mood: 'relaxed',
                },
              });

              // Check duplicate in queue
              const dupCheck = await ModerationService.checkDuplicate(track.id);
              if (!dupCheck.approved) {
                return `🎧 "${title}" already in queue! It'll play soon.`;
              }

              // Check rate limit
              const rateCheck = await ModerationService.checkRateLimit(userId);
              if (!rateCheck.approved) {
                return `❌ ${rateCheck.reason}`;
              }

              // Queue track directly by ID (avoids fuzzy title search finding wrong track)
              await PlaylistManagerService.queueTrack(track.id, username, false, userId);

              return `✅ Added "${title}" by ${artist} from YouTube! It'll play soon.`;
            } catch (error) {
              console.error('[Tool: add_youtube_track] Error:', error);
              return '❌ Failed to add YouTube track. Try again later.';
            }
          },
        }),
      },
    });

    // Create a custom stream that includes tool results when no text is generated
    const transformedStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let hasText = false;

        try {
          // Stream text chunks
          for await (const chunk of result.textStream) {
            if (chunk) {
              hasText = true;
              controller.enqueue(encoder.encode(chunk));
            }
          }

          // If no text was generated, use tool results
          if (!hasText) {
            const toolResults = await result.toolResults;
            console.log('[AI Curation] No text generated, using tool results');

            if (toolResults && toolResults.length > 0) {
              for (const tr of toolResults) {
                const output = (tr as any).output || (tr as any).result;
                if (output) {
                  controller.enqueue(encoder.encode(output));
                }
              }
            } else {
              controller.enqueue(encoder.encode('Desculpa, não consegui processar seu pedido. Tenta de novo?'));
            }
          }
        } catch (error) {
          console.error('[AI Curation] Stream error:', error);
          controller.enqueue(encoder.encode('Ops, ocorreu um erro. Tenta novamente!'));
        }

        controller.close();
      }
    });

    return new Response(transformedStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });

  } catch (error) {
    return handleApiError(error);
  }
}
