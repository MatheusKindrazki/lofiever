import type { Server as HTTPServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { customAlphabet } from 'nanoid';
import type { ClientToServerEvents, ServerToClientEvents } from './types';
import { SOCKET_EVENTS } from './types';
import type { Socket } from 'socket.io';
import { redis, redisHelpers, KEYS } from '../redis';
import { config } from '../config';

// Generate short, unique IDs for clients
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

// Track active Socket.IO instances to prevent duplicates
let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents> | null = null;

export function createSocketServer(httpServer: HTTPServer): SocketIOServer<ClientToServerEvents, ServerToClientEvents> {
  // Return existing instance if already created
  if (io) return io;

  // Create new Socket.IO server instance
  io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    path: config.socket.path,
    transports: ['websocket'], // Force array type instead of readonly tuple
    cors: {
      origin: config.app.url,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    connectionStateRecovery: {
      // Enable connection state recovery
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    },
    // Add adapter for scaling if needed in the future
    // adapter: createRedisAdapter(redis),
  });

  // Add connection middleware
  setupMiddleware(io);

  // Register event handlers
  setupEventHandlers(io);
  
  console.log('Socket.IO server initialized');
  
  return io;
}

// Middleware setup
function setupMiddleware(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>): void {
  io.use(async (socket, next) => {
    try {
      // Add unique user ID to socket data
      socket.data.userId = socket.handshake.auth.userId || nanoid();
      socket.data.username = socket.handshake.auth.username || `user_${socket.data.userId.substring(0, 5)}`;
      
      // Authenticate user (can be enhanced when auth is implemented)
      // For now, allow all connections
      
      next();
    } catch (error) {
      console.error('Socket middleware error:', error);
      next(new Error('Authentication error'));
    }
  });
}

// Event handlers setup
function setupEventHandlers(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>): void {
  io.on('connection', async (socket) => {
    const userId = socket.data.userId as string;
    const username = socket.data.username as string;
    
    console.log(`Client connected: ${socket.id} (${username})`);
    
    try {
      // Update listeners count
      const listenersCount = await redisHelpers.incrementListeners();
      console.log(`Active listeners: ${listenersCount}`);
      
      // Mark user as active in chat
      await redisHelpers.markUserActive(userId);
      
      // Send current state to the client
      await syncClientState(socket);
      
      // Broadcast updated listener count
      io.emit(SOCKET_EVENTS.LISTENERS_UPDATE, { count: listenersCount });
    } catch (error) {
      console.error('Error during client connection setup:', error);
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to initialize connection' });
    }
    
    // --- Event Handlers --- //
    
    // Handle sync request
    socket.on(SOCKET_EVENTS.SYNC_REQUEST, async () => {
      try {
        await syncClientState(socket);
      } catch (error) {
        console.error('Sync error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to sync playback' });
      }
    });

    // Handle chat messages
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, async (message) => {
      try {
        // Create chat message object
        const chatMessage = {
          id: nanoid(),
          userId,
          username,
          content: message.content,
          timestamp: Date.now(),
          type: message.type,
        };
        
        // Store in Redis and broadcast
        await redisHelpers.addChatMessage(chatMessage);
        
        // Broadcast message to all clients
        io.emit(SOCKET_EVENTS.CHAT_MESSAGE, chatMessage);
      } catch (error) {
        console.error('Chat error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to send message' });
      }
    });

    // Handle playlist votes
    socket.on(SOCKET_EVENTS.PLAYLIST_VOTE, async (trackId) => {
      try {
        // Store vote in Redis
        // We'll implement a more sophisticated voting system later
        const key = `${KEYS.PLAYLIST_VOTE}:${trackId}`;
        await redis.sadd(key, userId);
        
        // Get current votes count
        const votesCount = await redis.scard(key);
        
        console.log(`Vote for track ${trackId} by ${userId}. Total votes: ${votesCount}`);
        
        // Broadcast vote update
        io.emit(SOCKET_EVENTS.PLAYLIST_VOTE_UPDATE, { trackId, votes: votesCount });
      } catch (error) {
        console.error('Vote error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to register vote' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', async (reason) => {
      try {
        console.log(`Client disconnected: ${socket.id} (${username}). Reason: ${reason}`);
        
        // Update listeners count
        const listenersCount = await redisHelpers.decrementListeners();
        
        // Broadcast updated count
        io.emit(SOCKET_EVENTS.LISTENERS_UPDATE, { count: listenersCount });
      } catch (error) {
        console.error('Error during client disconnection:', error);
      }
    });
  });
}

// Helper function to sync client state
async function syncClientState(socket: Socket<ClientToServerEvents, ServerToClientEvents>): Promise<void> {
  const [currentTrack, playbackState, chatMessages] = await Promise.all([
    redisHelpers.getCurrentTrack(),
    redisHelpers.getPlaybackState(),
    redisHelpers.getChatMessages(50),
  ]);
  
  // Calculate current position
  const position = playbackState.isPlaying 
    ? (Date.now() - playbackState.startedAt) % (currentTrack?.duration || 0)
    : playbackState.position;
  
  // Send sync response if we have a track
  if (currentTrack) {
    socket.emit(SOCKET_EVENTS.SYNC_RESPONSE, {
      track: currentTrack,
      position,
      isPlaying: playbackState.isPlaying,
    });
  }
  
  // Send chat history
  if (chatMessages.length > 0) {
    socket.emit(SOCKET_EVENTS.CHAT_HISTORY, { messages: chatMessages });
  }
  
  // Send listener count
  const listenersCount = await redisHelpers.getListenersCount();
  socket.emit(SOCKET_EVENTS.LISTENERS_UPDATE, { count: listenersCount });
}

// Export server for testing
export function getIO(): SocketIOServer<ClientToServerEvents, ServerToClientEvents> | null {
  return io;
}

// Manually close socket server (for testing/shutdown)
export async function closeSocketServer(): Promise<void> {
  if (io) {
    await new Promise<void>((resolve) => {
      const server = io;
      if (server) {
        server.close(() => {
          io = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
} 