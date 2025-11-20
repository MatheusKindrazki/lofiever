import type { Server as HTTPServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { customAlphabet } from 'nanoid';
import type { ClientToServerEvents, ServerToClientEvents } from './types';
import { SOCKET_EVENTS } from './types';
import type { Socket } from 'socket.io';
import { redis, redisHelpers, KEYS } from '../redis';
import { config } from '../config';
import { Redis } from 'ioredis';
import type { ChatMessage as RedisChatMessage, Track as RedisTrack } from '../redis';

// Generate short, unique IDs for clients
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

// Track active Socket.IO instances to prevent duplicates
let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents> | null = null;
let redisSubscriber: Redis | null = null;

export function createSocketServer(httpServer: HTTPServer): SocketIOServer<ClientToServerEvents, ServerToClientEvents> {
  // Return existing instance if already created
  if (io) return io;

  // Create new Socket.IO server instance
  io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    path: config.socket.path,
    transports: ['websocket'],
    cors: {
      origin: config.app.url,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    },
    // adapter: createRedisAdapter(redis), // Future scaling
  });

  // Add connection middleware
  setupMiddleware(io);

  // Register event handlers
  setupEventHandlers(io);

  // Setup Redis Subscriber for proactive announcements
  setupRedisSubscriber(io);
  
  console.log('Socket.IO server initialized');
  
  return io;
}

// Middleware setup
function setupMiddleware(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>): void {
  io.use(async (socket, next) => {
    try {
      socket.data.userId = socket.handshake.auth.userId || nanoid();
      socket.data.username = socket.handshake.auth.username || `user_${socket.data.userId.substring(0, 5)}`;
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
      const listenersCount = await redisHelpers.incrementListeners();
      console.log(`Active listeners: ${listenersCount}`);
      
      await redisHelpers.markUserActive(userId);
      
      await syncClientState(socket);
      
      io.emit(SOCKET_EVENTS.LISTENERS_UPDATE, { count: listenersCount });
    } catch (error) {
      console.error('Error during client connection setup:', error);
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to initialize connection' });
    }
    
    // --- Event Handlers --- //
    
    socket.on(SOCKET_EVENTS.SYNC_REQUEST, async () => {
      try {
        await syncClientState(socket);
      } catch (error) {
        console.error('Sync error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to sync playback' });
      }
    });

    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, async (message) => {
      const userMessageId = nanoid();
      const aiMessageId = nanoid(); // Unique ID for AI's response

      try {
        // 1. Store and broadcast user's message
        const chatMessage: RedisChatMessage = {
          id: userMessageId,
          userId,
          username,
          content: message.content,
          timestamp: Date.now(),
          type: 'user',
        };
        
        await redisHelpers.addChatMessage(chatMessage);
        io.emit(SOCKET_EVENTS.CHAT_MESSAGE, chatMessage); // Broadcast user's message

        // 2. Forward message to AI agent
        const aiResponse = await fetch(`${config.app.url}/api/curation/process-message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: message.content }], // Pass user message to AI
            data: { userId },
          }),
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          throw new Error(`AI response error: ${aiResponse.status} - ${errorText}`);
        }

        if (!aiResponse.body) {
          throw new Error('AI response body is empty');
        }

        // 3. Process and stream AI's response
        let aiFullContent = '';
        const reader = aiResponse.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          aiFullContent += chunk;

          // Broadcast each chunk to clients
          io.emit(SOCKET_EVENTS.AI_MESSAGE_CHUNK, { chunk, messageId: aiMessageId });
        }
        
        // 4. Store full AI message and broadcast completion
        const aiChatMessage: RedisChatMessage = {
          id: aiMessageId,
          userId: 'ai', // AI's ID
          username: 'Lofine', // AI's username
          content: aiFullContent,
          timestamp: Date.now(),
          type: 'ai',
        };
        await redisHelpers.addChatMessage(aiChatMessage);
        io.emit(SOCKET_EVENTS.AI_MESSAGE_COMPLETE, { messageId: aiMessageId });

      } catch (error) {
        console.error('Chat AI integration error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to process message with AI' });
      }
    });

    socket.on(SOCKET_EVENTS.PLAYLIST_VOTE, async (trackId) => {
      try {
        const key = `${KEYS.PLAYLIST_VOTE}:${trackId}`;
        await redis.sadd(key, userId);
        const votesCount = await redis.scard(key);
        
        console.log(`Vote for track ${trackId} by ${userId}. Total votes: ${votesCount}`);
        
        io.emit(SOCKET_EVENTS.PLAYLIST_VOTE_UPDATE, { trackId, votes: votesCount });
      } catch (error) {
        console.error('Vote error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to register vote' });
      }
    });

    socket.on('disconnect', async (reason) => {
      try {
        console.log(`Client disconnected: ${socket.id} (${username}). Reason: ${reason}`);
        const listenersCount = await redisHelpers.decrementListeners();
        io.emit(SOCKET_EVENTS.LISTENERS_UPDATE, { count: listenersCount });
      } catch (error) {
        console.error('Error during client disconnection:', error);
      }
    });
  });
}

// Setup Redis Subscriber
function setupRedisSubscriber(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>): void {
  if (redisSubscriber) return; // Only setup once

  redisSubscriber = new Redis(config.redis.url);

  redisSubscriber.on('error', (err) => {
    console.error('Redis Subscriber Error:', err);
  });

  redisSubscriber.subscribe('lofi-ever:new-track', (err) => {
    if (err) {
      console.error('Failed to subscribe to Redis channel:', err);
      return;
    }
    console.log('Subscribed to lofi-ever:new-track channel');
  });

  redisSubscriber.on('message', (channel, message) => {
    if (channel === 'lofi-ever:new-track') {
      try {
        const track: RedisTrack = JSON.parse(message);
        const djAnnouncementMessageId = nanoid();
        const announcementContent = `Agora tocando: "${track.title}" por ${track.artist}. Aproveitem a vibe!`;
        
        // Broadcast DJ announcement
        io.emit(SOCKET_EVENTS.DJ_ANNOUNCEMENT, { message: announcementContent, track });

        // Store as a chat message
        const djChatMessage: RedisChatMessage = {
          id: djAnnouncementMessageId,
          userId: 'dj', // Use a special ID for DJ
          username: 'Lofine',
          content: announcementContent,
          timestamp: Date.now(),
          type: 'system', // Or 'ai' if preferred for announcements
        };
        redisHelpers.addChatMessage(djChatMessage);

        console.log(`DJ Announcement: ${announcementContent}`);
      } catch (error) {
        console.error('Error processing new track message from Redis:', error);
      }
    }
  });
}

// Helper function to sync client state
async function syncClientState(socket: Socket<ClientToServerEvents, ServerToClientEvents>): Promise<void> {
  const [currentTrack, playbackState, chatMessages] = await Promise.all([
    redisHelpers.getCurrentTrack(),
    redisHelpers.getPlaybackState(),
    redisHelpers.getChatMessages(50),
  ]);
  
  const position = playbackState.isPlaying 
    ? (Date.now() - (playbackState.startedAt || 0)) % (currentTrack?.duration || 0)
    : playbackState.position;
  
  if (currentTrack) {
    socket.emit(SOCKET_EVENTS.SYNC_RESPONSE, {
      track: currentTrack,
      position,
      isPlaying: playbackState.isPlaying,
    });
  }
  
  if (chatMessages.length > 0) {
    // Filter out only relevant messages for initial sync
    const relevantChatMessages = chatMessages.filter(msg => 
      msg.type === 'user' || msg.type === 'ai' || msg.type === 'system'
    );
    socket.emit(SOCKET_EVENTS.CHAT_HISTORY, { messages: relevantChatMessages });
  }
  
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
          if (redisSubscriber) {
            redisSubscriber.unsubscribe();
            redisSubscriber.quit();
            redisSubscriber = null;
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
} 