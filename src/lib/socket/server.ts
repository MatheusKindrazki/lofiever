import type { Server as HTTPServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from './types';
import { SOCKET_EVENTS } from './types';
import { redis, redisHelpers } from '../redis';

export function createSocketServer(httpServer: HTTPServer) {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    path: '/api/ws',
    transports: ['websocket'],
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL,
      methods: ['GET', 'POST'],
    },
  });

  // Middleware for connection handling
  io.use(async (socket, next) => {
    try {
      // Add authentication middleware here if needed
      next();
    } catch {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`Client connected: ${socket.id}`);
    
    // Update listeners count
    await redisHelpers.incrementListeners();
    
    // Handle sync request
    socket.on(SOCKET_EVENTS.SYNC_REQUEST, async () => {
      try {
        const [track, playbackState] = await Promise.all([
          redisHelpers.getCurrentTrack(),
          redisHelpers.getPlaybackState(),
        ]);
        
        if (track) {
          socket.emit(SOCKET_EVENTS.SYNC_RESPONSE, {
            track,
            position: Date.now() - playbackState.timestamp,
            isPlaying: playbackState.isPlaying,
          });
        }
      } catch (error) {
        console.error('Sync error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to sync playback' });
      }
    });

    // Handle chat messages
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, async (message) => {
      try {
        // Store chat message in Redis for temporary persistence
        const chatMessage = {
          id: crypto.randomUUID(),
          userId: socket.id, // Replace with actual user ID when auth is implemented
          content: message.content,
          type: message.type,
          createdAt: new Date().toISOString(),
        };
        
        await redis.lpush(
          SOCKET_EVENTS.CHAT_MESSAGE,
          JSON.stringify(chatMessage)
        );
        
        // Trim chat history to last 100 messages
        await redis.ltrim(SOCKET_EVENTS.CHAT_MESSAGE, 0, 99);
        
        // Broadcast message to all clients
        io.emit(SOCKET_EVENTS.CHAT_MESSAGE, chatMessage);
      } catch (error) {
        console.error('Chat error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to send message' });
      }
    });

    // Handle playlist votes
    socket.on(SOCKET_EVENTS.PLAYLIST_VOTE, async (vote) => {
      try {
        // Implement playlist voting logic here
        // This will be integrated with the AI curation service
        console.log('Received vote:', vote);
      } catch (error) {
        console.error('Vote error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to register vote' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      console.log(`Client disconnected: ${socket.id}`);
      await redisHelpers.decrementListeners();
    });
  });

  return io;
} 