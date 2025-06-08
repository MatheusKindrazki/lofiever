import React from 'react';

/**
 * Serviço para gerenciar a conexão com o stream de áudio do Icecast
 */

export interface StreamInfo {
  streamUrl: string;
  format: string;
  bitrate: number;
  sampleRate: number;
  channels: number;
  status: 'live' | 'offline' | 'error';
  mount: string;
}

export interface StreamMetadata {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
}

class AudioStreamService {
  private streamUrl: string;
  private fallbackUrl: string;
  private metadata: StreamMetadata = {};
  private listeners: Array<(metadata: StreamMetadata) => void> = [];

  constructor() {
    this.streamUrl = process.env.NEXT_PUBLIC_STREAM_URL || 'http://localhost:8000/stream';
    this.fallbackUrl = '/music/example.mp3';
  }

  /**
   * Obter informações do stream
   */
  async getStreamInfo(): Promise<StreamInfo> {
    try {
      const response = await fetch('/api/stream/audio-stream');
      
      if (!response.ok) {
        throw new Error(`Stream API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Failed to get stream info:', error);
      
      // Retornar informações padrão em caso de erro
      return {
        streamUrl: this.fallbackUrl,
        format: 'mp3',
        bitrate: 128,
        sampleRate: 44100,
        channels: 2,
        status: 'error',
        mount: '/fallback',
      };
    }
  }

  /**
   * Verificar se o stream está disponível
   */
  async isStreamAvailable(): Promise<boolean> {
    try {
      const response = await fetch('/api/stream/audio-stream', { 
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        return false;
      }
      
      const data = await response.json();
      return data.status === 'live';
    } catch {
      return false;
    }
  }

  /**
   * Obter URL do stream com fallback
   */
  async getStreamUrl(): Promise<string> {
    try {
      const streamInfo = await this.getStreamInfo();
      
      if (streamInfo.status === 'live') {
        return streamInfo.streamUrl;
      }
      
      return this.fallbackUrl;
    } catch {
      return this.fallbackUrl;
    }
  }

  /**
   * Atualizar metadados da faixa atual
   */
  updateMetadata(metadata: StreamMetadata): void {
    this.metadata = { ...this.metadata, ...metadata };
    this.notifyListeners();
  }

  /**
   * Obter metadados atuais
   */
  getCurrentMetadata(): StreamMetadata {
    return { ...this.metadata };
  }

  /**
   * Adicionar listener para mudanças de metadados
   */
  addMetadataListener(callback: (metadata: StreamMetadata) => void): void {
    this.listeners.push(callback);
  }

  /**
   * Remover listener de metadados
   */
  removeMetadataListener(callback: (metadata: StreamMetadata) => void): void {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Notificar todos os listeners sobre mudanças de metadados
   */
  private notifyListeners(): void {
    this.listeners.forEach(callback => {
      try {
        callback(this.metadata);
      } catch (error) {
        console.error('Error in metadata listener:', error);
      }
    });
  }

  /**
   * Buscar metadados do servidor
   */
  async fetchCurrentMetadata(): Promise<StreamMetadata> {
    try {
      const response = await fetch('/api/stream');
      
      if (!response.ok) {
        throw new Error(`Metadata API error: ${response.status}`);
      }
      
      const data = await response.json();
      const metadata: StreamMetadata = {
        title: data.currentSong?.title,
        artist: data.currentSong?.artist,
        duration: data.currentSong?.duration,
      };
      
      this.updateMetadata(metadata);
      return metadata;
    } catch (error) {
      console.error('Failed to fetch metadata:', error);
      return this.metadata;
    }
  }

  /**
   * Iniciar polling de metadados
   */
  startMetadataPolling(intervalMs: number = 30000): void {
    // Buscar metadados imediatamente
    this.fetchCurrentMetadata();
    
    // Configurar polling
    setInterval(() => {
      this.fetchCurrentMetadata();
    }, intervalMs);
  }
}

// Singleton instance
export const audioStreamService = new AudioStreamService();

// Hook React para usar o serviço de stream
export function useAudioStream(): {
  streamInfo: StreamInfo | null;
  metadata: StreamMetadata;
  isLoading: boolean;
  getStreamUrl: () => Promise<string>;
  isStreamAvailable: () => Promise<boolean>;
} {
  const [streamInfo, setStreamInfo] = React.useState<StreamInfo | null>(null);
  const [metadata, setMetadata] = React.useState<StreamMetadata>({});
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    // Carregar informações do stream
    audioStreamService.getStreamInfo()
      .then(setStreamInfo)
      .finally(() => setIsLoading(false));

    // Configurar listener de metadados
    const metadataListener = (newMetadata: StreamMetadata): void => {
      setMetadata(newMetadata);
    };

    audioStreamService.addMetadataListener(metadataListener);
    
    // Iniciar polling de metadados
    audioStreamService.startMetadataPolling();

    // Cleanup
    return () => {
      audioStreamService.removeMetadataListener(metadataListener);
    };
  }, []);

  return {
    streamInfo,
    metadata,
    isLoading,
    getStreamUrl: audioStreamService.getStreamUrl.bind(audioStreamService),
    isStreamAvailable: audioStreamService.isStreamAvailable.bind(audioStreamService),
  };
} 