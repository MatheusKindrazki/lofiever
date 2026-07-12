/**
 * API utilities for the Lofiever application
 * These functions handle the communication with the backend services
 */

/**
 * Standardized API error class that carries status code and message
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Shared fetch error handling utility
 * Validates response.ok, parses error JSON, and throws standardized ApiError
 */
async function fetchWithErrorHandling(response: Response): Promise<any> {
  if (!response.ok) {
    let message = `Error: ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) {
        message = data.error;
      }
    } catch {
      // Ignore JSON parse errors; fall back to status message.
    }
    throw new ApiError(message, response.status);
  }

  return response.json();
}

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

// A playable catalog track returned by the DB search endpoint (/api/tracks).
// These are real, queueable tracks — never YouTube-only display cards.
export interface CatalogTrack {
  id: string;
  title: string;
  artist: string;
  sourceType: string;
  duration: number;
  bpm: number | null;
  mood: string | null;
}

export interface TrackSearchResponse {
  tracks: CatalogTrack[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface SearchTracksOptions {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface QueuedTrack {
  id: string;
  title: string;
  artist: string;
  mood: string | null;
  duration: number;
  sourceType: string;
  addedBy: string;
}

export interface AddTrackToQueueResponse {
  queued: QueuedTrack;
}

interface PersistedGuestSession {
  userId: string;
  username: string;
  token: string;
  isGuest: boolean;
}

interface GuestSessionResponse {
  token: string;
  user: {
    id: string;
    name: string;
    isGuest: boolean;
  };
}

const getPersistedGuestSession = (): PersistedGuestSession | null => {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem('lofiever:session');
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<PersistedGuestSession>;
    if (
      typeof parsed.userId !== 'string'
      || typeof parsed.username !== 'string'
      || typeof parsed.token !== 'string'
      || !parsed.token
      || parsed.isGuest !== true
    ) {
      return null;
    }
    return parsed as PersistedGuestSession;
  } catch {
    return null;
  }
};

const renewGuestSession = async (session: PersistedGuestSession): Promise<string> => {
  const response = await fetch('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ username: session.username }),
  });
  const renewed = await fetchWithErrorHandling(response) as GuestSessionResponse;
  const nextSession: PersistedGuestSession = {
    userId: renewed.user.id,
    username: renewed.user.name,
    token: renewed.token,
    isGuest: renewed.user.isGuest,
  };
  window.localStorage.setItem('lofiever:session', JSON.stringify(nextSession));
  return nextSession.token;
};

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

// Search the catalog for playable tracks by title/artist (DB-backed, no YouTube).
// Backed by GET /api/tracks?search= which restricts results to playable sources.
export async function searchTracks(
  query: string,
  opts: SearchTracksOptions = {}
): Promise<TrackSearchResponse> {
  const params = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed) {
    params.set('search', trimmed);
  }
  if (opts.limit !== undefined) {
    params.set('limit', String(opts.limit));
  }
  if (opts.offset !== undefined) {
    params.set('offset', String(opts.offset));
  }

  const response = await fetch(`/api/tracks?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    signal: opts.signal,
  });

  return fetchWithErrorHandling(response) as Promise<TrackSearchResponse>;
}

// Add a known catalog track to the play queue (POST /api/playlist/queue).
// Requires an authenticated session; the server validates the source is playable.
export async function addTrackToQueue(trackId: string): Promise<AddTrackToQueueResponse> {
  const guestSession = getPersistedGuestSession();
  const requestQueue = (guestToken: string | null): Promise<Response> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (guestToken) headers['X-Guest-Token'] = guestToken;
    return fetch('/api/playlist/queue', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ trackId }),
    });
  };

  let response = await requestQueue(guestSession?.token ?? null);
  if (response.status === 401 && guestSession) {
    const renewedToken = await renewGuestSession(guestSession);
    response = await requestQueue(renewedToken);
  }

  return fetchWithErrorHandling(response) as Promise<AddTrackToQueueResponse>;
}

export { defaultCurationPrompt } from '@/lib/prompts';
