import { NextResponse } from 'next/server';
import { DatabaseService } from '@/services/database';
import { handleApiError } from '@/lib/api-utils';

// GET - Obter a playlist atual
export async function GET(): Promise<NextResponse> {
  try {
    const playlist = await DatabaseService.getActivePlaylist();
    
    if (!playlist) {
      return NextResponse.json(
        { error: 'No active playlist found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }
    
    // Formatar a resposta
    const formattedPlaylist = {
      id: playlist.id,
      version: playlist.version,
      createdAt: playlist.createdAt,
      tracks: playlist.tracks.map(item => ({
        id: item.track.id,
        title: item.track.title,
        artist: item.track.artist,
        duration: item.track.duration,
        position: item.position,
        addedAt: item.addedAt,
      })),
    };
    
    return NextResponse.json(formattedPlaylist, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST - Criar uma nova playlist
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Extrair IDs de faixas do corpo da requisição
    const data = await request.json();
    
    if (!data.trackIds || !Array.isArray(data.trackIds)) {
      return NextResponse.json(
        { error: 'trackIds must be an array', code: 'INVALID_REQUEST' },
        { status: 400 }
      );
    }
    
    // Criar nova playlist
    const newPlaylist = await DatabaseService.createNewPlaylist(data.trackIds);
    
    // Formatar a resposta
    const formattedPlaylist = {
      id: newPlaylist.id,
      version: newPlaylist.version,
      createdAt: newPlaylist.createdAt,
      tracks: newPlaylist.tracks.map(item => ({
        id: item.track.id,
        title: item.track.title,
        artist: item.track.artist,
        duration: item.track.duration,
        position: item.position,
        addedAt: item.addedAt,
      })),
    };
    
    return NextResponse.json(formattedPlaylist, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
} 