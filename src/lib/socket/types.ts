import type { Track } from '../redis';
import type { ChatMessage } from '../redis';

// Message payload with idempotency key to prevent duplicates
export interface ChatMessagePayload {
  content: string;
  type: 'user' | 'system' | 'ai';
  isPrivate?: boolean;
  locale?: 'pt' | 'en';
  clientMessageId?: string; // Idempotency key - prevents duplicate processing on retry
}

// AI message complete with optional skip flag
export interface AIMessageCompletePayload {
  messageId: string;
  skipped?: boolean; // True if AI processing was skipped (e.g., no listeners)
}

export const SOCKET_EVENTS = {
  // Connection events
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',

  // Playback events
  PLAYBACK_START: 'playback:start',
  PLAYBACK_PAUSE: 'playback:pause',
  TRACK_CHANGE: 'track:change',
  SYNC_REQUEST: 'sync:request',
  SYNC_RESPONSE: 'sync:response',

  // Chat events
  CHAT_MESSAGE: 'chat:message',
  CHAT_REACTION: 'chat:reaction',
  CHAT_HISTORY: 'chat:history',

  // Playlist events
  PLAYLIST_UPDATE: 'playlist:update',
  PLAYLIST_VOTE: 'playlist:vote',
  PLAYLIST_VOTE_UPDATE: 'playlist:vote:update',

  // Analytics events
  LISTENERS_UPDATE: 'listeners:update',
  HEARTBEAT: 'heartbeat',

  // System events
  ERROR: 'error',

  // AI Chat events
  AI_MESSAGE_CHUNK: 'ai:message:chunk',
  AI_MESSAGE_COMPLETE: 'ai:message:complete',

  // DJ Announcement events
  DJ_ANNOUNCEMENT: 'dj:announcement',

  // User events
  USER_UPDATE: 'user:update',
} as const;

export type SocketEvents = typeof SOCKET_EVENTS;

export interface ServerToClientEvents {
  [SOCKET_EVENTS.PLAYBACK_START]: (track: Track) => void;
  [SOCKET_EVENTS.PLAYBACK_PAUSE]: () => void;
  [SOCKET_EVENTS.TRACK_CHANGE]: (track: Track) => void;
  [SOCKET_EVENTS.SYNC_RESPONSE]: (data: { track: Track; position: number; isPlaying: boolean }) => void;
  [SOCKET_EVENTS.CHAT_MESSAGE]: (message: ChatMessage) => void;
  [SOCKET_EVENTS.CHAT_HISTORY]: (data: { messages: ChatMessage[] }) => void;
  [SOCKET_EVENTS.PLAYLIST_UPDATE]: (tracks: Track[]) => void;
  [SOCKET_EVENTS.PLAYLIST_VOTE_UPDATE]: (data: { trackId: string; votes: number }) => void;
  [SOCKET_EVENTS.LISTENERS_UPDATE]: (data: { count: number }) => void;
  [SOCKET_EVENTS.ERROR]: (error: { message: string }) => void;
  [SOCKET_EVENTS.AI_MESSAGE_CHUNK]: (data: { chunk: string; messageId: string }) => void;
  [SOCKET_EVENTS.AI_MESSAGE_COMPLETE]: (data: AIMessageCompletePayload) => void;
  [SOCKET_EVENTS.DJ_ANNOUNCEMENT]: (data: { message: string; track?: Track }) => void;
  [SOCKET_EVENTS.USER_UPDATE]: (data: { username: string }) => void;
}

export interface ClientToServerEvents {
  [SOCKET_EVENTS.SYNC_REQUEST]: () => void;
  [SOCKET_EVENTS.CHAT_MESSAGE]: (message: ChatMessagePayload) => void;
  [SOCKET_EVENTS.PLAYLIST_VOTE]: (trackId: string) => void;
  [SOCKET_EVENTS.HEARTBEAT]: () => void;
}

// Using the ChatMessage interface from Redis
export type ChatMessageType = 'user' | 'system' | 'ai'; 
