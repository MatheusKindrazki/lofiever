import { PlaylistManagerService } from './playlist-manager.service';
import { DatabaseService } from '@/services/database';
import { prisma } from '@/lib/prisma';
import { redis, redisHelpers } from '@/lib/redis'; // Import redis
import type { Track as PrismaTrack } from '@prisma/client';
import { config } from '@/lib/config';
import { R2Lib } from '@/lib/r2';

/**
 * Constrói a URI para uma faixa que o Liquidsoap pode tocar.
 * @param track O objeto da faixa do banco de dados.
 * @returns A URI para o arquivo de áudio.
 */
async function buildTrackUri(track: PrismaTrack): Promise<string> {
  switch (track.sourceType) {
    case 'local':
      return `${config.liquidsoap.musicDir}/${track.sourceId}`;

    case 's3':
      console.log(`🔑 Gerando URL pré-assinada para a chave: ${track.sourceId}`);
      return R2Lib.getPresignedUrl(track.sourceId, 300); // URL válida por 5 minutos

    default:
      console.error(`Tipo de fonte desconhecido ou não suportado: ${track.sourceType}`);
      return `${config.liquidsoap.musicDir}/${config.liquidsoap.fallback}`;
  }
}

export const LiquidsoapIntegrationService = {
  /**
   * Obtém a URI da próxima faixa a ser tocada pela rádio.
   * Este método é o ponto de entrada principal para o Liquidsoap.
   * @returns A URI da próxima faixa.
   */
  async getNextTrackUri(): Promise<string> {
    try {

      const nextTrack = await PlaylistManagerService.getNextTrack();

      // Omitindo a lógica de mapeamento de tipo aqui para simplicidade,
      // assumindo que a estrutura do RedisTrack é compatível o suficiente.
      await redisHelpers.setCurrentTrack(nextTrack as any);

      // Registrar o início da reprodução no banco de dados (Histórico)
      // Isso é crucial para a IA saber o que já tocou.
      try {
        await DatabaseService.startPlayback(nextTrack.id);
      } catch (dbError) {
        console.error('⚠️ Falha ao registrar histórico de reprodução:', dbError);
      }

      // Publicar o evento de nova faixa no Redis
      await redis.publish('lofi-ever:new-track', JSON.stringify(nextTrack));

      // --- AI DJ & Request Status Update ---
      const queueItem = nextTrack as any; // Cast para acessar propriedades extras da fila

      // 1. Se for um pedido, atualizar status para 'played'
      if (queueItem.requestId) {
        try {
          await prisma.trackRequest.update({
            where: { id: queueItem.requestId },
            data: { status: 'played', processedAt: new Date() },
          });
          console.log(`✅ Pedido ${queueItem.requestId} marcado como tocado.`);
        } catch (e) {
          console.error('Erro ao atualizar status do pedido:', e);
        }
      }

      const trackUri = await buildTrackUri(nextTrack);
      console.log(`🛰️ Servindo próxima faixa para o Liquidsoap: ${trackUri.substring(0, 100)}...`);

      return trackUri;
    } catch (error) {
      console.error('❌ Erro ao obter a próxima faixa para o Liquidsoap:', error);
      return `${config.liquidsoap.musicDir}/${config.liquidsoap.fallback}`;
    }
  },
};