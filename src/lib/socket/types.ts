import type { Track } from '../redis';

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
  
  // Playlist events
  PLAYLIST_UPDATE: 'playlist:update',
  PLAYLIST_VOTE: 'playlist:vote',
  
  // System events
  ERROR: 'error',
} as const;

export type SocketEvents = typeof SOCKET_EVENTS;

export interface ServerToClientEvents {
  [SOCKET_EVENTS.PLAYBACK_START]: (track: Track) => void;
  [SOCKET_EVENTS.PLAYBACK_PAUSE]: () => void;
  [SOCKET_EVENTS.TRACK_CHANGE]: (track: Track) => void;
  [SOCKET_EVENTS.SYNC_RESPONSE]: (data: { track: Track; position: number; isPlaying: boolean }) => void;
  [SOCKET_EVENTS.CHAT_MESSAGE]: (message: ChatMessage) => void;
  [SOCKET_EVENTS.PLAYLIST_UPDATE]: (tracks: Track[]) => void;
  [SOCKET_EVENTS.ERROR]: (error: { message: string }) => void;
}

export interface ClientToServerEvents {
  [SOCKET_EVENTS.SYNC_REQUEST]: () => void;
  [SOCKET_EVENTS.CHAT_MESSAGE]: (message: { content: string; type: ChatMessageType }) => void;
  [SOCKET_EVENTS.PLAYLIST_VOTE]: (trackId: string) => void;
}

export interface ChatMessage {
  id: string;
  userId: string;
  content: string;
  type: ChatMessageType;
  createdAt: string;
}

export type ChatMessageType = 'message' | 'suggestion' | 'feedback'; 