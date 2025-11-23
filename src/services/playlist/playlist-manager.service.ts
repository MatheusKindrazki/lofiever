import { prisma } from '@/lib/prisma';
import type { Track } from '@prisma/client';
import { redis, redisHelpers, type ChatMessage } from '@/lib/redis';
import { recommendNextTrack } from './ai-recommendation.service';

/**
 * Retorna uma faixa aleatória do banco de dados como fallback.
 * Isso é usado se a playlist ativa estiver vazia ou se ocorrer um erro.
 */
async function getFallbackTrack(): Promise<Track> {
  // A maneira mais eficiente de obter um registro aleatório pode variar de acordo com o DB.
  // Para o PostgreSQL, podemos usar TABLESAMPLE, mas para simplicidade e compatibilidade,
  // vamos buscar todos os IDs e escolher um aleatoriamente.
  const allTrackIds = await prisma.track.findMany({
    select: {
      id: true,
    },
  });

  if (allTrackIds.length === 0) {
    throw new Error('Nenhuma faixa de fallback disponível no banco de dados.');
  }

  const randomIndex = Math.floor(Math.random() * allTrackIds.length);
  const randomTrackId = allTrackIds[randomIndex].id;

  const track = await prisma.track.findUnique({
    where: { id: randomTrackId },
  });

  if (!track) {
    throw new Error('Não foi possível encontrar a faixa de fallback selecionada aleatoriamente.');
  }

  return track;
}

export const PlaylistManagerService = {
  /**
   * Garante que a fila de reprodução (Redis) tenha faixas suficientes.
   * Prioriza pedidos de usuários (TrackRequest) e preenche o resto com IA.
   */
  async refillQueue(): Promise<void> {
    const QUEUE_KEY = 'lofiever:playlist:upcoming';
    const REFILL_THRESHOLD = 3; // Refill when queue drops to this size
    const BATCH_SIZE = 5; // Add this many tracks at once

    // 1. Processar pedidos de usuários (Prioridade Máxima)
    // Buscamos pedidos aprovados e colocamos no INÍCIO da fila (LPOP/LPUSH logic)
    const pendingRequests = await prisma.trackRequest.findMany({
      where: { status: 'approved' },
      orderBy: { createdAt: 'asc' }, // FIFO: O mais antigo primeiro
      include: { track: true },
    });

    if (pendingRequests.length > 0) {
      console.log(`🗣️ Encontrados ${pendingRequests.length} pedidos pendentes. Injetando na fila...`);

      // Para manter a ordem FIFO ao usar LPUSH (que inverte), precisamos iterar do último para o primeiro
      // Ex: Pedidos [A, B, C]. Queremos fila: [A, B, C, ...].
      // LPUSH C -> [C, ...]
      // LPUSH B -> [B, C, ...]
      // LPUSH A -> [A, B, C, ...]
      const reversedRequests = [...pendingRequests].reverse();

      for (const req of reversedRequests) {
        if (!req.track) continue;

        const queueItem = {
          ...req.track,
          addedBy: req.username,
          addedByUserId: req.userId, // Store userId for dynamic name resolution
          requestId: req.id,
        };

        // Injeta no início da fila (fura fila)
        await redis.lpush(QUEUE_KEY, JSON.stringify(queueItem));

        await prisma.trackRequest.update({
          where: { id: req.id },
          data: { status: 'queued' },
        });

        console.log(`🗣️ Pedido de ${req.username} ("${req.track.title}") furou a fila (prioridade).`);
      }
    }

    // Notificar update imediatamente pois a fila mudou drasticamente
    await redis.publish('lofi-ever:queue-update', 'updated');


    // 2. Verificar tamanho atual da fila e preencher com IA se necessário
    const queueSize = await redis.llen(QUEUE_KEY);

    if (queueSize > REFILL_THRESHOLD) {
      return;
    }

    console.log(`📉 Fila baixa (${queueSize}/${REFILL_THRESHOLD}). Adicionando lote de ${BATCH_SIZE} músicas...`);

    // 3. Se precisar de faixas, usar a IA (RPUSH - fim da fila)
    // Get current queue tracks to avoid duplicates
    const currentQueueJson = await redis.lrange(QUEUE_KEY, 0, -1);
    const currentQueueIds = currentQueueJson.map(item => {
      try {
        return JSON.parse(item).id;
      } catch {
        return null;
      }
    }).filter(id => id !== null);

    // Get recent chat messages for context
    const chatMessages = await redisHelpers.getChatMessages(20);
    const chatContext = chatMessages.map((m: ChatMessage) => `${m.username}: ${m.content}`);

    // Determine mood ONCE for the whole batch
    const { determineMoodFromChat } = await import('./ai-recommendation.service');
    const batchMood = await determineMoodFromChat(chatContext);

    if (batchMood) {
      console.log(`🧠 Mood definido para o lote: ${batchMood}`);
    }

    const generatedIds: string[] = [];

    for (let i = 0; i < BATCH_SIZE; i++) {
      try {
        // Pass both current queue and newly generated IDs to avoid immediate repeats
        // Pass the pre-determined batchMood
        const recommendedTrack = await recommendNextTrack(batchMood, [...currentQueueIds, ...generatedIds], []); // Empty chatContext because we already determined mood

        const queueItem = {
          ...recommendedTrack,
          addedBy: 'ai-curator',
        };
        await redis.rpush(QUEUE_KEY, JSON.stringify(queueItem));
        generatedIds.push(recommendedTrack.id);
      } catch (err) {
        console.error('Erro ao gerar recomendação para a fila:', err);
      }
    }

    // Notificar frontend que a fila mudou
    await redis.publish('lofi-ever:queue-update', 'updated');
  },

  /**
   * Obtém a próxima faixa a ser tocada da fila dinâmica.
   * @param currentTrackId O ID da faixa que está tocando atualmente (opcional).
   * @returns A próxima faixa.
   */
  async getNextTrack(): Promise<Track> {
    const QUEUE_KEY = 'lofiever:playlist:upcoming';

    // 1. Garantir que a fila tem música
    await this.refillQueue();

    // 2. Pegar a próxima da fila (LPOP)
    const nextTrackJson = await redis.lpop(QUEUE_KEY);

    if (!nextTrackJson) {
      // Fallback extremo se o Redis falhar ou refill falhar
      console.error('🚨 CRÍTICO: Fila vazia mesmo após refill. Usando fallback aleatório.');
      return getFallbackTrack();
    }

    const nextTrack = JSON.parse(nextTrackJson);

    // Notificar que a fila mudou (um item foi removido)
    await redis.publish('lofi-ever:queue-update', 'updated');

    // Se tiver um requestId associado, podemos atualizar o status para 'playing' ou histórico aqui se quisermos,
    // mas o registro de histórico principal acontece no 'startPlayback' do DatabaseService.

    return nextTrack;
  },

  /**
   * Adiciona uma faixa diretamente à fila (furar fila ou prioridade).
   * Útil para comandos de admin ou eventos especiais.
   */
  async queueTrack(trackId: string, addedBy: string, priority: boolean = false, userId?: string): Promise<void> {
    const QUEUE_KEY = 'lofiever:playlist:upcoming';

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) throw new Error('Track not found');

    const queueItem = {
      ...track,
      addedBy,
      addedByUserId: userId,
    };

    if (priority) {
      await redis.lpush(QUEUE_KEY, JSON.stringify(queueItem)); // Coloca no início
    } else {
      await redis.rpush(QUEUE_KEY, JSON.stringify(queueItem)); // Coloca no fim
    }

    await redis.publish('lofi-ever:queue-update', 'updated');
  },

  // Mantendo compatibilidade com código antigo se necessário, mas redirecionando
  async addTrackToPlaylist(trackId: string, addedBy: string, userId?: string): Promise<void> {
    return this.queueTrack(trackId, addedBy, false, userId);
  },
};
