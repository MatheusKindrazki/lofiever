import { prisma } from '@/lib/prisma';
import type { Track } from '@prisma/client';
import { redis, redisHelpers } from '@/lib/redis';
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
    const MIN_QUEUE_SIZE = 2;

    // 1. Verificar tamanho atual da fila
    const queueSize = await redis.llen(QUEUE_KEY);

    if (queueSize >= MIN_QUEUE_SIZE) {
      return;
    }

    console.log(`📉 Fila baixa (${queueSize}/${MIN_QUEUE_SIZE}). Reabastecendo...`);

    // 2. Buscar pedidos de usuários aprovados e pendentes
    // Processamos pedidos um por um para garantir a ordem
    const pendingRequests = await prisma.trackRequest.findMany({
      where: { status: 'approved' },
      orderBy: { createdAt: 'asc' },
      take: MIN_QUEUE_SIZE - queueSize,
      include: { track: true },
    });

    for (const req of pendingRequests) {
      if (req.track) {
        // Adiciona à fila do Redis
        const queueItem = {
          ...req.track,
          addedBy: req.username, // Metadado importante para o frontend
          requestId: req.id,
        };
        await redis.rpush(QUEUE_KEY, JSON.stringify(queueItem));

        // Marca o pedido como "queued" ou deleta (vamos marcar como processed no momento do play ou agora?)
        // Melhor marcar agora como 'queued' para não pegar de novo, mas o status 'approved' é o que usamos.
        // Vamos mudar o status para 'queued' para evitar duplicidade se o refill rodar de novo.
        await prisma.trackRequest.update({
          where: { id: req.id },
          data: { status: 'queued' },
        });

        console.log(`🗣️ Pedido de ${req.username} ("${req.track.title}") movido para a fila.`);
      }
    }

    // 3. Se ainda precisar de faixas, usar a IA
    const newQueueSize = await redis.llen(QUEUE_KEY);
    const needed = MIN_QUEUE_SIZE - newQueueSize;

    if (needed > 0) {
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
      const chatContext = chatMessages.map((m: any) => `${m.username}: ${m.content}`);

      const generatedIds: string[] = [];

      for (let i = 0; i < needed; i++) {
        try {
          // Pass both current queue and newly generated IDs to avoid immediate repeats
          // Also pass chat context for mood analysis
          const recommendedTrack = await recommendNextTrack(undefined, [...currentQueueIds, ...generatedIds], chatContext);

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
    }

    // Notificar frontend que a fila mudou (opcional, via pub/sub)
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
  async queueTrack(trackId: string, addedBy: string, priority: boolean = false): Promise<void> {
    const QUEUE_KEY = 'lofiever:playlist:upcoming';

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) throw new Error('Track not found');

    const queueItem = {
      ...track,
      addedBy,
    };

    if (priority) {
      await redis.lpush(QUEUE_KEY, JSON.stringify(queueItem)); // Coloca no início
    } else {
      await redis.rpush(QUEUE_KEY, JSON.stringify(queueItem)); // Coloca no fim
    }

    await redis.publish('lofi-ever:queue-update', 'updated');
  },

  // Mantendo compatibilidade com código antigo se necessário, mas redirecionando
  async addTrackToPlaylist(trackId: string, addedBy: string): Promise<void> {
    return this.queueTrack(trackId, addedBy, false);
  },
};
