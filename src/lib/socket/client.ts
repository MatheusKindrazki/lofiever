import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { useEffect, useState, useRef, useCallback } from 'react';
import type { ClientToServerEvents, ServerToClientEvents } from './types';
import { SOCKET_EVENTS } from './types';
import { config } from '../config';
import type { Track, ChatMessage } from '../redis';
import { customAlphabet } from 'nanoid';
import { useUserSession } from '@/hooks/useUserSession';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

// Singleton socket instance
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

/**
 * Initialize socket connection (should be called only once)
 */
/**
 * Initialize socket connection (should be called only once)
 */
export function initializeSocket(auth: { token: string; userId?: string; username?: string; locale?: 'pt' | 'en' }): Socket<ServerToClientEvents, ClientToServerEvents> {
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
  const [socketInstance, setSocketInstance] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(socket);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const initializingRef = useRef(false);

  // Use the new session hook
  const { session, loginAsGuest, isLoading: isSessionLoading } = useUserSession();
  const currentTokenRef = useRef<string | null>(null);

  useEffect(() => {
    // Initialize socket on client side
    if (typeof window === 'undefined') return;

    // Check if we need to re-initialize due to token change
    const newToken = session?.token;
    const tokenChanged = newToken && currentTokenRef.current && newToken !== currentTokenRef.current;

    if (tokenChanged && socket) {
      console.log('[Client] Token changed, reconnecting socket...');
      socket.disconnect();
      socket = null;
      setSocketInstance(null);
      setIsConnected(false);
      initializingRef.current = false;
    }

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
        const init = async () => {
          if (initializingRef.current || isSessionLoading) return;
          initializingRef.current = true;

          let token = session?.token;

          // If no session, try to restore or create one
          if (!token) {
            // If we have a stored session in localStorage (handled by useUserSession), use it.
            // If not, we might need to wait for the user to log in via the UI.
            // However, for the socket to connect initially, we might want a guest session.
            // But wait, if we force a guest session here, we might overwrite a manual login?
            // The requirement is: "refresh page -> stay logged in".
            // useUserSession handles the "refresh page" part by loading from localStorage.
            // So if session is null here, it means really no session.

            // If we want to auto-login as guest if no session exists (e.g. first visit):
            // We can check if we should auto-create a guest session.
            // For now, let's assume the UI handles the "Welcome" screen if no session.
            // BUT, the socket needs a token to connect.
            // If we don't have a token, we can't connect authenticated.
            // Maybe we connect unauthenticated first? Or wait?
            // The original code auto-created a guest token.

            // Let's keep the auto-creation for now if no session exists, 
            // but use the loginAsGuest from the hook to persist it.
            if (!session) {
              try {
                // Check if we have a username stored separately or just generate one
                const storedUsername = localStorage.getItem('username'); // Legacy check?
                const newSession = await loginAsGuest(storedUsername || undefined);
                token = newSession.token;
              } catch (e) {
                console.error('Failed to auto-login guest', e);
              }
            }
          }

          if (token) {
            const pathLocale = typeof window !== 'undefined'
              ? window.location.pathname.split('/')[1]
              : null;
            const preferredLocale: 'pt' | 'en' = pathLocale === 'en' ? 'en' : 'pt';

            console.log('[Client] Initializing socket with token', { userId: session?.userId, username: session?.username, preferredLocale });
            currentTokenRef.current = token;
            socket = initializeSocket({
              token,
              userId: session?.userId,
              username: session?.username,
              locale: preferredLocale
            });
            setSocketInstance(socket);

            socket.on(SOCKET_EVENTS.CONNECT, onConnect);
            socket.on(SOCKET_EVENTS.DISCONNECT, onDisconnect);

            if (socket.connected) {
              onConnect();
            } else {
              socket.connect();
            }
          }
          initializingRef.current = false;
        };

        init();
      } catch (error) {
        console.error('Failed to initialize socket:', error);
      }

      return () => {
        // We don't disconnect on unmount, as socket is singleton
        // But we should remove listeners if we were the ones adding them?
        // Actually, for a singleton, we should be careful about adding listeners multiple times.
        // But here we only add them if !socket (creation time).

        // Clear heartbeat interval on cleanup
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
      };
    } else {
      // Socket already exists
      if (socketInstance !== socket) {
        setSocketInstance(socket);
      }

      if (socket.connected !== isConnected) {
        setIsConnected(socket.connected);
      }

      // Ensure heartbeat is running if socket exists and is connected
      if (socket.connected && !heartbeatIntervalRef.current) {
        heartbeatIntervalRef.current = setInterval(() => {
          socket?.emit(SOCKET_EVENTS.HEARTBEAT);
        }, 10000);
      }
    }
  }, [session, isSessionLoading, loginAsGuest, socketInstance, isConnected]); // Re-run if session changes

  // ... rest of the hook


  // Request sync from server
  const requestSync = useCallback(() => {
    if (socket?.connected) {
      socket.emit(SOCKET_EVENTS.SYNC_REQUEST);
    }
  }, []);

  // Send chat message
  const sendChatMessage = useCallback((content: string, options: { isPrivate?: boolean; locale?: 'pt' | 'en' } = {}) => {
    if (socket?.connected) {
      socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, {
        content,
        type: 'user',
        isPrivate: options.isPrivate,
        locale: options.locale
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
    socket: socketInstance,
    isConnected,
    userId: session?.userId || '', // Return the userId from session
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

    // Re-sync when tab becomes visible (browser may have missed events)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isConnected) {
        requestSync();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Register event listeners
    socket.on(SOCKET_EVENTS.SYNC_RESPONSE, onSyncResponse);
    socket.on(SOCKET_EVENTS.PLAYBACK_START, onPlaybackStart);
    socket.on(SOCKET_EVENTS.PLAYBACK_PAUSE, onPlaybackPause);
    socket.on(SOCKET_EVENTS.TRACK_CHANGE, onTrackChange);

    // Cleanup
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

// Extended ChatMessage with pending state
export interface PendingChatMessage extends ChatMessage {
  isPending?: boolean;
  isFailed?: boolean;
  tempId?: string;
  // Store original data for retry
  retryData?: {
    content: string;
    isPrivate?: boolean;
    locale?: 'pt' | 'en';
  };
}

/**
 * Hook to listen for chat messages
 */
export function useChat() {
  const [messages, setMessages] = useState<PendingChatMessage[]>([]);
  const [aiMessageBuffers, setAiMessageBuffers] = useState<Record<string, string>>({});
  const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const { socket, userId, isConnected, sendChatMessage } = useSocket();
  const pendingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Add a pending message (optimistic update)
  const addPendingMessage = useCallback((content: string, options: { isPrivate?: boolean; username?: string; locale?: 'pt' | 'en' }) => {
    const tempId = `pending-${nanoid()}`;
    const pendingMessage: PendingChatMessage = {
      id: tempId,
      tempId,
      userId: userId || 'anonymous',
      username: options.username || 'You',
      content,
      timestamp: Date.now(),
      type: 'user',
      isPrivate: options.isPrivate,
      isPending: true,
      // Store retry data
      retryData: {
        content,
        isPrivate: options.isPrivate,
        locale: options.locale,
      },
    };

    setMessages((prev) => [...prev, pendingMessage]);
    setPendingMessageId(tempId);

    // Clear any existing timeout
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
    }

    // Set timeout to mark as failed if no confirmation (5 seconds for better UX)
    pendingTimeoutRef.current = setTimeout(() => {
      setMessages((prev) =>
        prev.map(m =>
          m.tempId === tempId && m.isPending
            ? { ...m, isPending: false, isFailed: true }
            : m
        )
      );
      setPendingMessageId((current) => current === tempId ? null : current);
    }, 5000); // 5 second timeout - faster feedback

    return tempId;
  }, [userId]);

  // Clear pending state when message is confirmed
  const confirmPendingMessage = useCallback((tempId: string, confirmedMessage: ChatMessage) => {
    // Clear timeout when confirmed
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }

    setMessages((prev) =>
      prev.map(m =>
        m.tempId === tempId
          ? { ...confirmedMessage, isPending: false, isFailed: false }
          : m
      )
    );
    setPendingMessageId((current) => current === tempId ? null : current);
  }, []);

  // Retry a failed message
  const retryMessage = useCallback((tempId: string) => {
    if (!isConnected) return false;

    setMessages((prev) => {
      const messageToRetry = prev.find(m => m.tempId === tempId);
      if (!messageToRetry?.retryData) return prev;

      // Send the message again
      sendChatMessage(messageToRetry.retryData.content, {
        isPrivate: messageToRetry.retryData.isPrivate,
        locale: messageToRetry.retryData.locale,
      });

      // Update the message to pending state
      return prev.map(m =>
        m.tempId === tempId
          ? { ...m, isPending: true, isFailed: false, timestamp: Date.now() }
          : m
      );
    });

    // Set new timeout for the retry
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
    }

    setPendingMessageId(tempId);
    pendingTimeoutRef.current = setTimeout(() => {
      setMessages((prev) =>
        prev.map(m =>
          m.tempId === tempId && m.isPending
            ? { ...m, isPending: false, isFailed: true }
            : m
        )
      );
      setPendingMessageId((current) => current === tempId ? null : current);
    }, 5000);

    return true;
  }, [isConnected, sendChatMessage]);

  // Remove a failed message
  const removeFailedMessage = useCallback((tempId: string) => {
    setMessages((prev) => prev.filter(m => m.tempId !== tempId));
  }, []);

  useEffect(() => {
    if (!socket) return;

    // Handle new user messages (already includes full AI messages for history)
    const onChatMessage = (message: ChatMessage) => {
      // Check if this confirms a pending message
      const isPendingConfirmation = message.userId === userId && message.type === 'user';

      if (isPendingConfirmation && pendingMessageId) {
        // Find the pending message with similar content
        setMessages((prev) => {
          const pendingIdx = prev.findIndex(m => m.isPending && m.userId === userId);
          if (pendingIdx !== -1) {
            // Replace pending with confirmed
            const newMessages = [...prev];
            newMessages[pendingIdx] = { ...message, isPending: false, isFailed: false };
            return newMessages;
          }
          // No pending found, just add
          return [...prev.filter(m => m.id !== message.id), message];
        });
        setPendingMessageId(null);
      } else {
        setMessages((prev) => [...prev.filter(m => m.id !== message.id), message]);
      }

      if (message.type === 'user' && message.userId === userId) {
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
        const { [messageId]: _completedMessage, ...rest } = prev;
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
  }, [socket, aiMessageBuffers, userId, pendingMessageId]); // Include aiMessageBuffers in dependency array

  return {
    messages,
    isLoadingAI,
    hasPendingMessage: !!pendingMessageId,
    addPendingMessage,
    confirmPendingMessage,
    retryMessage,
    removeFailedMessage,
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
