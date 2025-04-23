import { NextResponse } from 'next/server';
import { DatabaseService } from '@/services/database';
import { handleApiError } from '@/lib/api-utils';

export async function GET(): Promise<NextResponse> {
  try {
    // Obter a música atual
    const currentTrack = await DatabaseService.getCurrentTrack();
    
    // Se não houver música atual, usar dados mockados para desenvolvimento
    if (!currentTrack) {
      return NextResponse.json({
        currentSong: {
          id: "song123",
          title: "Rainy Day Lofi",
          artist: "Lofi Artist",
          coverUrl: "https://images.unsplash.com/photo-1569982175971-d92b01cf8694?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
          duration: 180, // in seconds
        },
        listeners: 128,
        daysActive: 7,
        songsPlayed: 342,
        nextUp: [
          {
            id: "song124",
            title: "Coffee Shop Vibes",
            artist: "Chill Beats",
            coverUrl: "https://images.unsplash.com/photo-1542320662-b15547e0c1fe?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
            duration: 165,
          },
          {
            id: "song125",
            title: "Late Night Study",
            artist: "Lo-fi Dreamer",
            coverUrl: "https://images.unsplash.com/photo-1534531173927-aeb928d54385?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
            duration: 195,
          }
        ]
      }, { status: 200 });
    }
    
    // Obter a lista de reprodução ativa
    const playlist = await DatabaseService.getActivePlaylist();
    
    // Obter estatísticas do stream
    const stats = await DatabaseService.getStreamStats();
    
    // Montar resposta
    const response = {
      currentSong: {
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        coverUrl: `https://img.youtube.com/vi/${currentTrack.sourceType === 'youtube' ? currentTrack.sourceId : 'dQw4w9WgXcQ'}/maxresdefault.jpg`,
        duration: currentTrack.duration,
        mood: currentTrack.mood,
        bpm: currentTrack.bpm,
      },
      listeners: stats.currentListeners,
      daysActive: stats.daysActive,
      songsPlayed: stats.totalTracksPlayed,
      nextUp: playlist?.tracks.slice(0, 5).map(item => ({
        id: item.track.id,
        title: item.track.title,
        artist: item.track.artist,
        coverUrl: `https://img.youtube.com/vi/${item.track.sourceType === 'youtube' ? item.track.sourceId : 'dQw4w9WgXcQ'}/maxresdefault.jpg`,
        duration: item.track.duration,
      })) || [],
    };
    
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
} 