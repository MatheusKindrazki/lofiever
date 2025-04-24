import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { useEffect, useState, useRef, useCallback } from 'react';
import type { ClientToServerEvents, ServerToClientEvents } from './types';
import { SOCKET_EVENTS } from './types';
import { config } from '../config';
import type { Track, ChatMessage } from '../redis';

// Singleton socket instance
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

/**
 * Initialize socket connection (should be called only once)
 */
export function initializeSocket(auth: { userId?: string; username?: string } = {}): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io({
      path: config.socket.path,
      transports: ['websocket'],
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      auth,
    });

    // Global event listeners
    socket.on('connect', () => {
      console.log('Socket connected');
    });

    socket.on('disconnect', (reason) => {
      console.log(`Socket disconnected: ${reason}`);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
    });
  }

  return socket;
}

/**
 * Get the socket instance (throws if not initialized)
 */
export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    throw new Error('Socket not initialized. Call initializeSocket first.');
  }
  return socket;
}

/**
 * Hook to use the socket connection
 */
export function useSocket() {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  useEffect(() => {
    try {
      // Get existing socket or create a new one
      socketRef.current = socket || initializeSocket();
      
      // Set up connection event listeners
      const onConnect = () => setIsConnected(true);
      const onDisconnect = () => setIsConnected(false);

      socketRef.current.on('connect', onConnect);
      socketRef.current.on('disconnect', onDisconnect);
      
      // Set initial connection state
      setIsConnected(socketRef.current.connected);

      // Cleanup event listeners
      return () => {
        const socket = socketRef.current;
        if (socket) {
          socket.off('connect', onConnect);
          socket.off('disconnect', onDisconnect);
        }
      };
    } catch (error) {
      console.error('Error initializing socket in hook:', error);
      return () => {};
    }
  }, []);

  // Request sync from server
  const requestSync = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(SOCKET_EVENTS.SYNC_REQUEST);
    }
  }, []);

  // Send chat message
  const sendChatMessage = useCallback((content: string, type: 'user' | 'system' | 'ai' = 'user') => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(SOCKET_EVENTS.CHAT_MESSAGE, { content, type });
    }
  }, []);

  // Vote for track
  const voteForTrack = useCallback((trackId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(SOCKET_EVENTS.PLAYLIST_VOTE, trackId);
    }
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    requestSync,
    sendChatMessage,
    voteForTrack,
  };
}

/**
 * Hook to listen for playback state changes
 */
export function usePlaybackSync() {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [position, setPosition] = useState<number>(0);
  const { socket, isConnected, requestSync } = useSocket();

  useEffect(() => {
    if (!socket) return;

    // Request initial sync when connected
    if (isConnected) {
      requestSync();
    }

    // Handle sync response
    const onSyncResponse = (data: { track: Track; position: number; isPlaying: boolean }) => {
      setCurrentTrack(data.track);
      setPosition(data.position);
      setIsPlaying(data.isPlaying);
    };

    // Handle playback events
    const onPlaybackStart = (track: Track) => {
      setCurrentTrack(track);
      setIsPlaying(true);
    };

    const onPlaybackPause = () => {
      setIsPlaying(false);
    };

    const onTrackChange = (track: Track) => {
      setCurrentTrack(track);
      setPosition(0);
    };

    // Register event listeners
    socket.on(SOCKET_EVENTS.SYNC_RESPONSE, onSyncResponse);
    socket.on(SOCKET_EVENTS.PLAYBACK_START, onPlaybackStart);
    socket.on(SOCKET_EVENTS.PLAYBACK_PAUSE, onPlaybackPause);
    socket.on(SOCKET_EVENTS.TRACK_CHANGE, onTrackChange);

    // Cleanup
    return () => {
      socket.off(SOCKET_EVENTS.SYNC_RESPONSE, onSyncResponse);
      socket.off(SOCKET_EVENTS.PLAYBACK_START, onPlaybackStart);
      socket.off(SOCKET_EVENTS.PLAYBACK_PAUSE, onPlaybackPause);
      socket.off(SOCKET_EVENTS.TRACK_CHANGE, onTrackChange);
    };
  }, [socket, isConnected, requestSync]);

  return {
    currentTrack,
    isPlaying,
    position,
    requestSync,
  };
}

/**
 * Hook to listen for chat messages
 */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { socket, sendChatMessage } = useSocket();

  useEffect(() => {
    if (!socket) return;

    // Handle new messages
    const onChatMessage = (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    };

    // Handle chat history
    const onChatHistory = (data: { messages: ChatMessage[] }) => {
      setMessages(data.messages);
    };

    // Register event listeners
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, onChatMessage);
    socket.on(SOCKET_EVENTS.CHAT_HISTORY, onChatHistory);

    // Cleanup
    return () => {
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE, onChatMessage);
      socket.off(SOCKET_EVENTS.CHAT_HISTORY, onChatHistory);
    };
  }, [socket]);

  return {
    messages,
    sendMessage: sendChatMessage,
  };
}

/**
 * Hook to listen for listeners count
 */
export function useListeners() {
  const [listenersCount, setListenersCount] = useState<number>(0);
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;

    // Handle listeners update
    const onListenersUpdate = (data: { count: number }) => {
      setListenersCount(data.count);
    };

    // Register event listener
    socket.on(SOCKET_EVENTS.LISTENERS_UPDATE, onListenersUpdate);

    // Cleanup
    return () => {
      socket.off(SOCKET_EVENTS.LISTENERS_UPDATE, onListenersUpdate);
    };
  }, [socket]);

  return { listenersCount };
} 