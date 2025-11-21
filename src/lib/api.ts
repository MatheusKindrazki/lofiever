/**
 * API utilities for the Lofiever application
 * These functions handle the communication with the backend services
 */

interface SongInfo {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string;
  duration: number;
  streamUrl?: string; // URL to the audio stream
}

interface StreamData {
  currentSong: SongInfo;
  listeners: number;
  daysActive: number;
  songsPlayed: number;
  nextUp: SongInfo[];
}

export interface AIRecommendation {
  title: string;
  artist: string;
  mood: string;
  bpm: number;
  duration: number;
  description?: string;
}

export interface AIRecommendationResponse {
  recommendations: AIRecommendation[];
}

// Function to fetch current stream data
export async function getStreamData(): Promise<StreamData> {
  try {
    const response = await fetch('/api/stream', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Include credentials for any authenticated requests
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to fetch stream data:', error);
    throw error;
  }
}

// Function to get the current track with streaming URL
export async function getCurrentTrack(): Promise<SongInfo> {
  try {
    const response = await fetch('/api/stream/current', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
    });

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to fetch current track:', error);
    throw error;
  }
}

// Function to get AI-curated music recommendations
export async function getAIRecommendations(prompt: string): Promise<AIRecommendationResponse> {
  try {
    const response = await fetch('/api/curation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get AI recommendations:', error);
    throw error;
  }
}

export { defaultCurationPrompt } from '@/lib/prompts';
