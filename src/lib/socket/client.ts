import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { useEffect, useState, useRef, useCallback } from 'react';
import type { ClientToServerEvents, ServerToClientEvents } from './types';
import { SOCKET_EVENTS } from './types';
import { config } from '../config';
import type { Track, ChatMessage } from '../redis';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

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
  const [isConnected, setIsConnected] = useState(false);
  const [userId, setUserId] = useState<string>('');
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Initialize socket on client side
    if (typeof window === 'undefined') return;

    // Get or create userId
    const storedUserId = localStorage.getItem('userId') || nanoid();
    setUserId(storedUserId);

    if (!socket) {
      // Set up connection event listeners
      const onConnect = () => {
        console.log('Socket connected:', socket?.id);
        setIsConnected(true);

        // Start heartbeat when connected
        if (socket && !heartbeatIntervalRef.current) {
          heartbeatIntervalRef.current = setInterval(() => {
            socket?.emit(SOCKET_EVENTS.HEARTBEAT);
          }, 10000); // Send heartbeat every 10 seconds
        }
      };
      const onDisconnect = () => {
        console.log('Socket disconnected');
        setIsConnected(false);

        // Clear heartbeat when disconnected
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
      };

      try {
        const username = localStorage.getItem('username') || `user_${storedUserId.substring(0, 5)}`;

        // Save to local storage for future sessions
        localStorage.setItem('userId', storedUserId);
        localStorage.setItem('username', username);

        console.log('[Client] Initializing socket with:', { userId: storedUserId, username });
        socket = initializeSocket({ userId: storedUserId, username });

        socket.on(SOCKET_EVENTS.CONNECT, onConnect);
        socket.on(SOCKET_EVENTS.DISCONNECT, onDisconnect);

        if (socket.connected) {
          setIsConnected(true);
          // Start heartbeat if already connected
          if (!heartbeatIntervalRef.current) {
            heartbeatIntervalRef.current = setInterval(() => {
              socket?.emit(SOCKET_EVENTS.HEARTBEAT);
            }, 10000);
          }
        }
      } catch (error) {
        console.error('Failed to initialize socket:', error);
      }

      return () => {
        if (socket) {
          socket.off(SOCKET_EVENTS.CONNECT, onConnect);
          socket.off(SOCKET_EVENTS.DISCONNECT, onDisconnect);
        }

        // Clear heartbeat interval on cleanup
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
      };
    } else {
      setIsConnected(socket.connected);

      // Ensure heartbeat is running if socket exists and is connected
      if (socket.connected && !heartbeatIntervalRef.current) {
        heartbeatIntervalRef.current = setInterval(() => {
          socket?.emit(SOCKET_EVENTS.HEARTBEAT);
        }, 10000);
      }
    }
  }, []);

  // Request sync from server
  const requestSync = useCallback(() => {
    if (socket?.connected) {
      socket.emit(SOCKET_EVENTS.SYNC_REQUEST);
    }
  }, []);

  // Send chat message
  const sendChatMessage = useCallback((content: string, options: { isPrivate?: boolean } = {}) => {
    if (socket?.connected) {
      socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, {
        content,
        type: 'user',
        isPrivate: options.isPrivate
      });
    }
  }, []);

  // Vote for track
  const voteForTrack = useCallback((trackId: string) => {
    if (socket?.connected) {
      socket.emit(SOCKET_EVENTS.PLAYLIST_VOTE, trackId);
    }
  }, []);

  return {
    socket: socket,
    isConnected,
    userId, // Return the userId
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
  const [aiMessageBuffers, setAiMessageBuffers] = useState<Record<string, string>>({});
  const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false);
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;

    // Handle new user messages (already includes full AI messages for history)
    const onChatMessage = (message: ChatMessage) => {
      setMessages((prev) => [...prev.filter(m => m.id !== message.id), message]);
      if (message.type === 'user') {
        setIsLoadingAI(true);
      }
    };

    // Handle AI message chunks (streaming effect)
    const onAIMessageChunk = ({ chunk, messageId }: { chunk: string; messageId: string }) => {
      setAiMessageBuffers((prev) => {
        const newContent = (prev[messageId] || '') + chunk;
        // Update the messages list with the streaming AI message
        setMessages((prevMessages) => {
          const existingAiMessageIndex = prevMessages.findIndex(
            (m) => m.id === messageId && m.type === 'ai'
          );
          if (existingAiMessageIndex > -1) {
            const newMessages = [...prevMessages];
            newMessages[existingAiMessageIndex] = {
              ...newMessages[existingAiMessageIndex],
              content: newContent,
            };
            return newMessages;
          } else {
            // Add a new AI message if it doesn't exist yet
            return [
              ...prevMessages,
              {
                id: messageId,
                userId: 'ai',
                username: 'Lofine',
                content: newContent,
                timestamp: Date.now(),
                type: 'ai',
              },
            ];
          }
        });
        return { ...prev, [messageId]: newContent };
      });
    };

    // Handle AI message completion
    const onAIMessageComplete = ({ messageId }: { messageId: string }) => {
      setIsLoadingAI(false);
      setAiMessageBuffers((prev) => {
        const { [messageId]: completedMessage, ...rest } = prev;
        // The full message is already in the `messages` state from the last chunk update
        // We just need to clear the buffer and ensure the message is finalized.
        // The server sends the full message in the final chatMessage event.
        return rest;
      });
    };

    // Handle DJ announcements
    const onDJAnnouncement = ({ message, track }: { message: string; track?: Track }) => {
      const announcementMessage: ChatMessage = {
        id: nanoid(), // Unique ID for the announcement
        userId: 'dj',
        username: 'Lofine',
        content: message,
        timestamp: Date.now(),
        type: 'system', // Or 'ai'
        // Optionally add track info
        meta: track ? { title: track.title, artist: track.artist, artworkUrl: track.artworkUrl } : undefined,
      };
      setMessages((prev) => [...prev, announcementMessage]);
    };

    // Handle chat history
    const onChatHistory = (data: { messages: ChatMessage[] }) => {
      // Filter out any temporary AI messages if a full history sync occurs
      const filteredHistory = data.messages.filter(msg =>
        !aiMessageBuffers[msg.id] // Don't include messages still being buffered
      );
      setMessages(filteredHistory);
    };

    // Register event listeners
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, onChatMessage);
    socket.on(SOCKET_EVENTS.AI_MESSAGE_CHUNK, onAIMessageChunk);
    socket.on(SOCKET_EVENTS.AI_MESSAGE_COMPLETE, onAIMessageComplete);
    socket.on(SOCKET_EVENTS.DJ_ANNOUNCEMENT, onDJAnnouncement);
    socket.on(SOCKET_EVENTS.CHAT_HISTORY, onChatHistory);

    // Cleanup
    return () => {
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE, onChatMessage);
      socket.off(SOCKET_EVENTS.AI_MESSAGE_CHUNK, onAIMessageChunk);
      socket.off(SOCKET_EVENTS.AI_MESSAGE_COMPLETE, onAIMessageComplete);
      socket.off(SOCKET_EVENTS.DJ_ANNOUNCEMENT, onDJAnnouncement);
      socket.off(SOCKET_EVENTS.CHAT_HISTORY, onChatHistory);
    };
  }, [socket, aiMessageBuffers]); // Include aiMessageBuffers in dependency array

  return {
    messages,
    isLoadingAI,
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