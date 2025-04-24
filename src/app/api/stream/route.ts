import { NextResponse } from 'next/server';
import { DatabaseService } from '@/services/database';
import { redisHelpers } from '@/lib/redis';
import { handleApiError } from '@/lib/api-utils';
import type { Track } from '@/lib/redis';

// GET - Obter dados da stream atual
export async function GET(): Promise<NextResponse> {
  try {
    // Get current playback state and listeners count from Redis
    const [currentTrack, listenersCount] = await Promise.all([
      redisHelpers.getCurrentTrack(),
      redisHelpers.getListenersCount(),
    ]);
    
    if (!currentTrack) {
      return NextResponse.json(
        { error: 'No active track found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get upcoming tracks from the active playlist
    const playlist = await DatabaseService.getActivePlaylist();
    
    // Find the position of the current track in the playlist
    const currentPosition = playlist?.tracks.findIndex(item => item.track.id === currentTrack.id) || 0;
    
    // Get the next 2 tracks in the playlist
    const nextUp = playlist?.tracks
      .slice(currentPosition + 1, currentPosition + 3) // Only get next 2 tracks
      .map(item => {
        // The track from the database might have different properties than our Redis Track
        const track = item.track as unknown as Track;
        return {
          id: track.id,
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          artworkUrl: track.artworkUrl || `https://lofiever-assets.s3.amazonaws.com/covers/${track.id}.jpg`,
        };
      }) || [];
    
    // Format the current track response
    const formattedCurrentTrack = {
      id: currentTrack.id,
      title: currentTrack.title,
      artist: currentTrack.artist,
      duration: currentTrack.duration,
      artworkUrl: currentTrack.artworkUrl || `https://lofiever-assets.s3.amazonaws.com/covers/${currentTrack.id}.jpg`,
      streamUrl: `/api/stream/audio/${currentTrack.id}`,
    };
    
    // Calculate days the stream has been active (for demo purposes)
    const launchDate = new Date('2023-01-01');
    const now = new Date();
    const daysActive = Math.floor((now.getTime() - launchDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // Calculate total songs played (for demo purposes)
    const songsPlayed = playlist?.version ? playlist.version * 20 : 1000;
    
    // Construct the stream data response
    const streamData = {
      currentSong: formattedCurrentTrack,
      listeners: listenersCount,
      daysActive,
      songsPlayed,
      nextUp,
    };
    
    return NextResponse.json(streamData, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
} 