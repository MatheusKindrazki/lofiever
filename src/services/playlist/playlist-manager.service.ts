import { prisma } from '@/lib/prisma';
import type { Track } from '@prisma/client';
import { redis, redisHelpers, type ChatMessage } from '@/lib/redis';
import { recommendNextTrack } from './ai-recommendation.service';
import { YouTubeCacheService } from '@/services/youtube';
import { config } from '@/lib/config';
import { getAllowedSourceTypes } from './source-policy';

/**
 * Retorna uma faixa aleatória TOCÁVEL do banco de dados como fallback.
 * Isso é usado se a playlist ativa estiver vazia ou se ocorrer um erro.
 * Aplica o whitelist de fontes (r2/s3/local; youtube só quando habilitado)
 * para nunca devolver uma faixa 'youtube' inalcançável.
 */
async function getFallbackTrack(): Promise<Track> {
  // A maneira mais eficiente de obter um registro aleatório pode variar de acordo com o DB.
  // Para o PostgreSQL, podemos usar TABLESAMPLE, mas para simplicidade e compatibilidade,
  // vamos buscar todos os IDs (tocáveis) e escolher um aleatoriamente.
  const allTrackIds = await prisma.track.findMany({
    where: { sourceType: { in: getAllowedSourceTypes() } },
    select: {
      id: true,
    },
  });

  if (allTrackIds.length === 0) {
    throw new Error('Nenhuma faixa de fallback tocável disponível no banco de dados.');
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

/**
 * Triggers background pre-fetch for YouTube tracks in the queue.
 * Fire-and-forget: errors are logged but don't block the queue.
 */
function triggerYouTubePreFetch(track: Track): void {
  if (track.sourceType !== 'youtube' || !config.youtube.enabled) return;

  YouTubeCacheService.has(track.sourceId).then((cached) => {
    if (!cached) {
      console.log(`[Pre-fetch] Starting download for YouTube track: ${track.sourceId}`);
      YouTubeCacheService.ensureCached(track.sourceId).catch((err) => {
        console.error(`[Pre-fetch] Failed for ${track.sourceId}:`, err);
      });
    }
  }).catch(() => {
    // Silently ignore has() errors
  });
}

function isGeneratedUserQueueItem(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const item = JSON.parse(value) as { origin?: string; generatedRequest?: boolean };
    return item.origin === 'generated_user' || item.generatedRequest === true;
  } catch {
    return false;
  }
}

function keepsGeneratedRequestRunWithinLimit(
  combinedItems: string[],
  insertionIndex: number,
): boolean {
  let adjacentGenerated = 0;
  for (let index = insertionIndex - 1; index >= 0; index -= 1) {
    if (!isGeneratedUserQueueItem(combinedItems[index])) break;
    adjacentGenerated += 1;
  }
  for (let index = insertionIndex; index < combinedItems.length; index += 1) {
    if (!isGeneratedUserQueueItem(combinedItems[index])) break;
    adjacentGenerated += 1;
  }
  return adjacentGenerated < 2;
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
        triggerYouTubePreFetch(req.track);

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
    const currentQueueItems = currentQueueJson.map(item => {
      try {
        return JSON.parse(item) as { id?: string; origin?: string };
      } catch {
        return null;
      }
    }).filter((item): item is { id: string; origin?: string } => Boolean(item?.id));
    const currentQueueIds = currentQueueItems.map((item) => item.id);

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
    const scheduledOrigins = currentQueueItems.map((item) => item.origin || 'catalog');

    for (let i = 0; i < BATCH_SIZE; i++) {
      try {
        // Pass both current queue and newly generated IDs to avoid immediate repeats
        // Pass the pre-determined batchMood
        const allowGenerated = !scheduledOrigins
          .slice(-4)
          .some((origin) => origin === 'generated_user' || origin === 'generated_editorial');
        const recommendedTrack = await recommendNextTrack(
          batchMood,
          [...currentQueueIds, ...generatedIds],
          [],
          { allowGenerated },
        ); // Empty chatContext because we already determined mood

        const queueItem = {
          ...recommendedTrack,
          addedBy: 'ai-curator',
        };
        await redis.rpush(QUEUE_KEY, JSON.stringify(queueItem));
        triggerYouTubePreFetch(recommendedTrack);
        generatedIds.push(recommendedTrack.id);
        scheduledOrigins.push(recommendedTrack.origin);
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

    triggerYouTubePreFetch(track);
    await redis.publish('lofi-ever:queue-update', 'updated');
  },

  /**
   * Agenda um pedido direto dentro da janela prioritária sem ultrapassar o
   * áudio que o Liquidsoap já armazenou. A inserção usa Lua para permanecer
   * atômica mesmo com múltiplas instâncias do servidor.
   */
  async queueTrackWithinNext(
    trackId: string,
    addedBy: string,
    userId: string,
    minPosition: number = 3,
    maxPosition: number = 5,
    idempotencyKey?: string,
  ): Promise<{ targetPosition: number; effectivePosition: number }> {
    const QUEUE_KEY = 'lofiever:playlist:upcoming';
    const BUFFER_KEY = 'lofiever:liquidsoap:buffer';
    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) throw new Error('Track not found');

    const lower = Math.max(1, Math.floor(minPosition));
    const upper = Math.max(lower, Math.floor(maxPosition));
    const [bufferSize, bufferItems, queueItems] = await Promise.all([
      redis.llen(BUFFER_KEY),
      redis.lrange(BUFFER_KEY, 0, -1),
      redis.lrange(QUEUE_KEY, 0, -1),
    ]);
    const combinedItems = [...bufferItems, ...queueItems];
    const candidateQueueIndexes = [...new Set(
      Array.from(
        { length: upper - lower + 1 },
        (_, offset) => Math.max(0, lower + offset - bufferSize - 1),
      ),
    )];
    const safeQueueIndexes = track.origin === 'generated_user'
      ? candidateQueueIndexes.filter((index) => (
        keepsGeneratedRequestRunWithinLimit(combinedItems, bufferSize + index)
      ))
      : candidateQueueIndexes;
    const availableIndexes = safeQueueIndexes.length > 0
      ? safeQueueIndexes
      : Array.from({ length: queueItems.length + 1 }, (_, index) => index)
        .filter((index) => keepsGeneratedRequestRunWithinLimit(combinedItems, bufferSize + index));
    const queueIndex = availableIndexes.length > 0
      ? availableIndexes[Math.floor(Math.random() * availableIndexes.length)]
      : queueItems.length;
    const targetPosition = bufferSize + queueIndex + 1;
    const queueItem = JSON.stringify({
      ...track,
      addedBy,
      addedByUserId: userId,
      generatedRequest: track.origin === 'generated_user',
    });
    const guardKey = idempotencyKey
      ? `lofiever:playlist:priority:${idempotencyKey}`
      : `lofiever:playlist:priority:unguarded:${track.id}:${Date.now()}`;

    const insertionScript = `
      local queue = KEYS[1]
      local guard = KEYS[2]
      local value = ARGV[1]
      local requestedIndex = tonumber(ARGV[2])
      if redis.call('EXISTS', guard) == 1 then
        return -1
      end
      local length = redis.call('LLEN', queue)
      local insertedIndex = requestedIndex
      if requestedIndex <= 0 then
        redis.call('LPUSH', queue, value)
        insertedIndex = 0
      elseif requestedIndex >= length then
        redis.call('RPUSH', queue, value)
        insertedIndex = length
      else
        local pivot = redis.call('LINDEX', queue, requestedIndex)
        redis.call('LINSERT', queue, 'BEFORE', pivot, value)
      end
      redis.call('SET', guard, '1', 'EX', 604800)
      return insertedIndex
    `;

    const insertedIndex = Number(await redis.eval(
      insertionScript,
      2,
      QUEUE_KEY,
      guardKey,
      queueItem,
      String(queueIndex),
    ));

    if (insertedIndex >= 0) {
      triggerYouTubePreFetch(track);
      await redis.publish('lofi-ever:queue-update', 'updated');
    }

    return {
      targetPosition,
      effectivePosition: insertedIndex >= 0 ? bufferSize + insertedIndex + 1 : -1,
    };
  },

  // Mantendo compatibilidade com código antigo se necessário, mas redirecionando
  async addTrackToPlaylist(trackId: string, addedBy: string, userId?: string): Promise<void> {
    return this.queueTrack(trackId, addedBy, false, userId);
  },
};
