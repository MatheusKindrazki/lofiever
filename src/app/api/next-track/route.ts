import { NextResponse } from 'next/server';
import { DatabaseService } from '@/services/database';
import { redisHelpers } from '@/lib/redis';

/**
 * GET - Endpoint para o Liquidsoap obter a próxima faixa
 * Esta rota é chamada pelo script Liquidsoap para obter a URL da próxima música
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Obter playlist ativa
    const playlist = await DatabaseService.getActivePlaylist();
    
    if (!playlist || playlist.tracks.length === 0) {
      // Retornar faixa padrão se não houver playlist
      return new NextResponse('/music/example.mp3', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    
    // Obter faixa atual do Redis
    const currentTrack = await redisHelpers.getCurrentTrack();
    
    // Encontrar posição atual na playlist
    let currentPosition = 0;
    if (currentTrack) {
      const currentIndex = playlist.tracks.findIndex(
        item => item.track.id === currentTrack.id
      );
      currentPosition = currentIndex >= 0 ? currentIndex : 0;
    }
    
    // Obter próxima faixa (circular)
    const nextPosition = (currentPosition + 1) % playlist.tracks.length;
    const nextTrack = playlist.tracks[nextPosition].track;
    
    // Atualizar faixa atual no Redis
    await redisHelpers.setCurrentTrack({
      id: nextTrack.id,
      title: nextTrack.title,
      artist: nextTrack.artist,
      sourceType: nextTrack.sourceType as 'spotify' | 'youtube',
      sourceId: nextTrack.sourceId,
      duration: nextTrack.duration,
      bpm: nextTrack.bpm || undefined,
      mood: nextTrack.mood || undefined,
      artworkUrl: `https://lofiever-assets.s3.amazonaws.com/covers/${nextTrack.id}.jpg`,
    });
    
    // Construir URL do arquivo
    let trackUrl = '';
    
    if (nextTrack.sourceType === 'local') {
      trackUrl = `/music/${nextTrack.sourceId}`;
    } else {
      // Para outros tipos, usar arquivo padrão
      trackUrl = '/music/example.mp3';
    }
    
    console.log(`Next track requested: ${nextTrack.title} by ${nextTrack.artist} -> ${trackUrl}`);
    
    // Retornar URL da faixa como texto simples (formato esperado pelo Liquidsoap)
    return new NextResponse(trackUrl, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
    
  } catch (error) {
    console.error('Error getting next track:', error);
    
    // Retornar faixa padrão em caso de erro
    return new NextResponse('/music/example.mp3', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
} 