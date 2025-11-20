import { PlaylistManagerService } from './playlist-manager.service';
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
      const currentRedisTrack = await redisHelpers.getCurrentTrack();
      const nextTrack = await PlaylistManagerService.getNextTrack(currentRedisTrack?.id);

      // Omitindo a lógica de mapeamento de tipo aqui para simplicidade,
      // assumindo que a estrutura do RedisTrack é compatível o suficiente.
      await redisHelpers.setCurrentTrack(nextTrack as any);

      // Publicar o evento de nova faixa no Redis
      await redis.publish('lofi-ever:new-track', JSON.stringify(nextTrack));

      const trackUri = await buildTrackUri(nextTrack);
      console.log(`🛰️ Servindo próxima faixa para o Liquidsoap: ${trackUri.substring(0, 100)}...`);
      
      return trackUri;
    } catch (error) {
      console.error('❌ Erro ao obter a próxima faixa para o Liquidsoap:', error);
      return `${config.liquidsoap.musicDir}/${config.liquidsoap.fallback}`;
    }
  },
};