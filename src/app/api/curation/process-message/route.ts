// src/app/api/curation/process-message/route.ts
import { NextResponse } from 'next/server';
import { streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import { prisma } from '@/lib/prisma';
import { handleApiError } from '@/lib/api-utils';

export const maxDuration = 30;

// Inicializa o provedor da OpenAI com a chave de API
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { messages, data } = await req.json();
    const userId = data.userId || 'anonymous-user';

    const result = await streamText({
      model: openai('gpt-4o-mini'),
      system: `
        Você é "Lofine", um DJ de IA para a rádio Lo-Fi "Lofiever". Sua função é interagir com os ouvintes no chat.
        - Se um ouvinte sugerir uma música, use a ferramenta 'find_and_queue_song'.
        - Se um ouvinte pedir por um tipo de som (mood), use 'find_and_queue_songs_by_mood'.
        - Se a mensagem for apenas uma saudação ou conversa, use 'respond_to_user' para responder de forma amigável e curta.
        - Você só pode usar as ferramentas fornecidas. Não invente músicas que não existem no banco. Se não encontrar, diga que não encontrou.
        - Responda sempre em português do Brasil.
      `,
      messages,
      tools: {
        find_and_queue_song: tool({
          description: 'Encontra uma música pelo título e/ou artista e a adiciona à fila de reprodução.',
          parameters: z.object({
            title: z.string().describe('O título da música a ser procurada.'),
            artist: z.string().optional().describe('O artista da música (opcional).'),
          }),
          execute: async function* ({ title, artist }) {
            yield `Procurando por "${title}"...`;
            const track = await prisma.track.findFirst({
              where: {
                title: { contains: title, mode: 'insensitive' },
                ...(artist && { artist: { contains: artist, mode: 'insensitive' } }),
              },
            });
            if (track) {
              await PlaylistManagerService.addTrackToPlaylist(track.id, userId);
              return `Certo! Adicionei "${track.title}" de ${track.artist} à playlist.`;
            }
            return `Poxa, não encontrei "${title}" no nosso catálogo.`;
          },
        }),
        find_and_queue_songs_by_mood: tool({
            description: 'Encontra e adiciona músicas com base em um "mood" (clima/sentimento).',
            parameters: z.object({
                mood: z.enum(['calm', 'melancholic', 'focused', 'inspired', 'relaxed', 'nostalgic', 'cozy', 'happy', 'energetic', 'studious', 'nocturnal', 'peaceful']),
                count: z.number().default(1).describe('O número de músicas a serem adicionadas.'),
            }),
            execute: async function* ({ mood, count }) {
                yield `Procurando por músicas com o clima "${mood}"...`;
                const tracks = await prisma.track.findMany({
                    where: { mood: { equals: mood, mode: 'insensitive' } },
                    take: count,
                });
                if (tracks.length > 0) {
                    for (const track of tracks) {
                        await PlaylistManagerService.addTrackToPlaylist(track.id, userId);
                    }
                    return `Adicionado! Coloquei ${tracks.length} música(s) com o clima "${mood}" na playlist para você.`;
                }
                return `Não encontrei músicas com o clima "${mood}" no momento.`;
            },
        }),
        respond_to_user: tool({
          description: 'Use para responder a uma saudação ou conversa geral.',
          parameters: z.object({
            response_message: z.string().describe('A mensagem de resposta amigável para o usuário.'),
          }),
          execute: async function* ({ response_message }) {
            return response_message;
          }
        }),
      },
    });

    return new NextResponse(result.toAIStream(), {
      headers: {
        'Content-Type': 'text/plain',
      },
    });

  } catch (error) {
    return handleApiError(error);
  }
}
