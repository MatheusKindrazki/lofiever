/**
 * API utilities for the Lofiever application
 * These functions handle the communication with the backend services
 */

interface SongInfo {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  duration: number;
}

interface StreamData {
  currentSong: SongInfo;
  listeners: number;
  daysActive: number;
  songsPlayed: number;
  nextUp: SongInfo[];
}

interface AIRecommendation {
  title: string;
  artist: string;
  mood: string;
  bpm: number;
  duration: number;
}

interface AIRecommendationResponse {
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

// Default prompt for AI curation if none is provided
export const defaultCurationPrompt = 
  "Generate a playlist of lofi music for a streaming service. " +
  "Focus on music that's great for studying or relaxing. " +
  "Include a mix of moods, but keep the BPM between 65-85 for a consistent vibe. " +
  "Avoid recommending the same artists repeatedly."; 