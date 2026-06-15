import { prisma } from '@/lib/prisma';
import { PlaylistManagerService } from './playlist-manager.service';
import type { Prisma, Track } from '@prisma/client';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getAllowedSourceTypes } from './source-policy';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Processa uma mensagem de chat, procura por uma faixa correspondente e a adiciona à playlist.
 * Esta é uma implementação simplista que usa correspondência de palavras-chave.
 * @param message O conteúdo da mensagem de chat a ser processada.
 * @returns A faixa que foi adicionada, ou null se nenhuma faixa foi encontrada.
 */
export async function processChatMessageAndAddTrack(
  message: string
): Promise<Track | null> {
  console.log(`🤖 Processando mensagem do chat: "${message}"`);

  // Extrai palavras-chave da mensagem. Simplista: apenas pega as palavras.
  const keywords = message.toLowerCase().split(' ');

  if (keywords.length === 0) {
    return null;
  }

  // Procura por uma faixa que corresponda a uma das palavras-chave no título.
  // A busca é case-insensitive no PostgreSQL se a collation for configurada corretamente.
  const foundTrack = await prisma.track.findFirst({
    where: {
      title: {
        contains: keywords[0], // Simplificado para buscar pela primeira palavra
        mode: 'insensitive',
      },
    },
  });

  if (foundTrack) {
    console.log(`✅ Faixa encontrada para a sugestão: "${foundTrack.title}"`);
    try {
      await PlaylistManagerService.addTrackToPlaylist(
        foundTrack.id,
        'ai-curator'
      );
      console.log(`🎶 Faixa "${foundTrack.title}" adicionada à playlist.`);
      return foundTrack;
    } catch (error) {
      console.error('Erro ao adicionar faixa sugerida à playlist:', error);
      return null;
    }
  } else {
    console.log('🧐 Nenhuma faixa encontrada para a sugestão.');
    return null;
  }
}

/**
 * Analisa o contexto do chat para determinar o melhor mood.
 */
/**
 * Analisa o contexto do chat para determinar o melhor mood.
 */
export async function determineMoodFromChat(chatMessages: string[]): Promise<string | undefined> {
  if (!chatMessages || chatMessages.length === 0) return undefined;

  try {
    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      system: `
        Você é um DJ especialista em ler a vibe da galera.
        Analise as últimas mensagens do chat e decida qual o melhor mood musical para agora.
        
        Moods disponíveis: calm, melancholic, focused, inspired, relaxed, nostalgic, cozy, happy, energetic, studious, nocturnal, peaceful.
        
        Regras:
        - Se o chat estiver muito quieto ou com baixo engajamento, sugira algo 'energetic' ou 'happy' para animar.
        - Se o pessoal estiver conversando de boa, mantenha 'relaxed' ou 'cozy'.
        - Se estiverem falando de estudos/trabalho, 'focused' ou 'studious'.
        - Retorne APENAS a palavra do mood, nada mais.
      `,
      prompt: `Mensagens recentes:\n${chatMessages.join('\n')}`,
    });

    const mood = text.trim().toLowerCase();
    console.log(`🧠 AI analisou o chat e sugeriu mood: ${mood}`);
    return mood;
  } catch (error) {
    console.error('Erro ao analisar mood do chat:', error);
    return undefined;
  }
}

/**
 * Recomenda a próxima faixa baseada no histórico recente e (opcionalmente) no mood.
 * Evita repetições das músicas tocadas na última hora.
 * @param mood O 'mood' desejado (opcional).
 * @param excludeIds IDs para excluir (ex: fila atual).
 * @param chatContext Mensagens recentes do chat para análise de mood.
 * @returns Uma faixa recomendada.
 */
export async function recommendNextTrack(
  mood?: string,
  excludeIds: string[] = [],
  chatContext: string[] = []
): Promise<Track> {
  try {
    // 1. Determinar mood baseado no chat se não for especificado
    let targetMood = mood;
    if (!targetMood && chatContext.length > 0) {
      targetMood = await determineMoodFromChat(chatContext);
    }

    // 2. Obter histórico das últimas 24 horas para evitar repetições
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentHistory = await prisma.playbackHistory.findMany({
      where: {
        startedAt: {
          gte: oneDayAgo,
        },
      },
      select: { trackId: true },
    });

    const recentTrackIds = recentHistory.map((h) => h.trackId);

    // Combine history with explicit excludes (queue)
    const allExcludedIds = [...new Set([...recentTrackIds, ...excludeIds])];

    // 3. Construir filtro de exclusão.
    // O filtro de sourceType é SEMPRE aplicado (whitelist tocável; youtube só
    // quando habilitado) e nunca é removido nos caminhos relaxados abaixo, para
    // que linhas 'youtube' jamais vazem de volta quando o YouTube está fora.
    const allowedSourceTypes = getAllowedSourceTypes();
    const whereClause: Prisma.TrackWhereInput = {
      id: { notIn: allExcludedIds },
      sourceType: { in: allowedSourceTypes },
    };

    if (targetMood) {
      whereClause.mood = { equals: targetMood, mode: 'insensitive' };
    }

    // 4. Contar quantas faixas disponíveis existem
    const count = await prisma.track.count({ where: whereClause });

    let tracks: Track[] = [];

    // Se não houver faixas suficientes (ex: banco pequeno), relaxar o filtro de histórico
    if (count === 0) {
      console.warn(`⚠️ AI: Poucas faixas disponíveis para mood ${targetMood}. Relaxando filtros.`);

      // Tenta remover o filtro de mood primeiro
      if (targetMood) {
        delete whereClause.mood;
        const countWithoutMood = await prisma.track.count({ where: whereClause });
        if (countWithoutMood > 0) {
          console.log('⚠️ Usando qualquer mood, mas mantendo restrição de histórico.');
        } else {
          // Se ainda não der, remove restrição de histórico
          delete whereClause.id;
          console.log('⚠️ Removendo restrição de histórico.');
        }
      } else {
        delete whereClause.id;
      }

      // Se ainda assim não tiver nada (banco vazio?), erro.
      // Conta respeitando o whitelist de fontes para não reportar faixas
      // 'youtube' inalcançáveis quando o YouTube está desabilitado.
      const totalCount = await prisma.track.count({
        where: { sourceType: { in: allowedSourceTypes } },
      });
      if (totalCount === 0) {
        throw new Error('Nenhuma faixa tocável encontrada no banco de dados.');
      }
    }

    // 5. Selecionar uma faixa aleatória
    const availableCount = await prisma.track.count({ where: whereClause });
    const skip = Math.floor(Math.random() * availableCount);

    tracks = await prisma.track.findMany({
      where: whereClause,
      take: 1,
      skip: skip,
    });

    if (tracks.length > 0) {
      console.log(`🤖 AI recomendou: "${tracks[0].title}" (Mood: ${targetMood || 'any'})`);
      return tracks[0];
    }

    throw new Error('Falha ao selecionar faixa recomendada.');
  } catch (error) {
    console.error('❌ Erro na recomendação da IA:', error);
    // Fallback de emergência: pegar qualquer uma TOCÁVEL (respeita o whitelist
    // de fontes para nunca devolver uma faixa 'youtube' inalcançável).
    const fallback = await prisma.track.findFirst({
      where: { sourceType: { in: getAllowedSourceTypes() } },
    });
    if (!fallback) throw new Error('CRÍTICO: Nenhuma faixa tocável no banco de dados.');
    return fallback;
  }
}
