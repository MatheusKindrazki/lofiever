/**
 * Utilitário para gerenciar fontes de reprodução de mídia no player
 */

// Interface para informações da faixa atual
export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  sourceType: string;
  sourceId: string;
  duration: number;
  bpm?: number | null;
  mood?: string | null;
}

/**
 * Obtém a URL da capa da música com base no seu tipo de fonte
 */
export function getCoverUrl(track: TrackInfo): string {
  switch (track.sourceType) {
    case 'youtube':
      return `https://img.youtube.com/vi/${track.sourceId}/maxresdefault.jpg`;
    case 'spotify':
      // Spotify exige autenticação para obter imagens, então usamos um placeholder
      return `https://via.placeholder.com/500x500.png?text=${encodeURIComponent(track.title)}`;
    case 'local':
      // Assumindo que as capas locais estão na pasta public/covers/
      return `/covers/${track.id}.jpg`;
    case 's3': {
      // Assumindo que a URL base do S3 está definida em uma variável de ambiente
      const s3BaseUrl = process.env.NEXT_PUBLIC_S3_BASE_URL || 'https://lofiever-assets.s3.amazonaws.com';
      return `${s3BaseUrl}/covers/${track.id}.jpg`;
    }
    case 'free-api':
      // Placeholder para APIs de música gratuita
      return `https://via.placeholder.com/500x500.png?text=${encodeURIComponent(track.title)}`;
    default:
      // Imagem padrão
      return 'https://images.unsplash.com/photo-1569982175971-d92b01cf8694?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3';
  }
}

/**
 * Obtém a URL de reprodução da música com base no seu tipo de fonte
 */
export function getPlaybackUrl(track: TrackInfo): string {
  switch (track.sourceType) {
    case 'youtube':
      // Para YouTube, precisaríamos de uma API como youtube-dl ou similar
      // Aqui retornamos apenas um URL de embed como exemplo
      return `https://www.youtube.com/embed/${track.sourceId}?autoplay=1`;
    case 'spotify':
      // Spotify exige autenticação e SDK para reprodução
      return `https://open.spotify.com/embed/track/${track.sourceId}`;
    case 'local':
      // Arquivos locais na pasta public/music/
      return `/music/${track.sourceId}`;
    case 's3': {
      // Arquivos no S3
      const s3BaseUrl = process.env.NEXT_PUBLIC_S3_BASE_URL || 'https://lofiever-assets.s3.amazonaws.com';
      return `${s3BaseUrl}/${track.sourceId}`;
    }
    case 'free-api': {
      // Aqui seria necessário uma lógica específica para cada API
      // Apenas um exemplo genérico
      const apiBaseUrl = process.env.NEXT_PUBLIC_MUSIC_API_URL || 'https://api.lofiever.com';
      return `${apiBaseUrl}/stream/${track.sourceId}`;
    }
    default:
      // URL padrão para fallback (pode ser um arquivo de silêncio)
      return '/music/silence.mp3';
  }
}

/**
 * Verifica se a fonte requer um player especial (como YouTube ou Spotify)
 */
export function requiresSpecialPlayer(track: TrackInfo): boolean {
  return ['youtube', 'spotify'].includes(track.sourceType);
}

/**
 * Obtém configurações adicionais para o player com base no tipo de fonte
 */
export function getPlayerConfig(track: TrackInfo): Record<string, unknown> {
  switch (track.sourceType) {
    case 'youtube':
      return {
        youtube: {
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
          },
        },
      };
    case 'spotify':
      return {
        spotify: {
          autoPlay: true,
        },
      };
    default:
      return {
        html5: true,
        preload: 'auto',
        autoplay: true,
      };
  }
} 