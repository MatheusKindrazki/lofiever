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
import { ProactiveEngagementService } from '@/services/moderation/proactive-engagement.service';
import { ContentModerationService } from '@/services/moderation/content-moderation.service';
import type { Track } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createAdapter } from '@socket.io/redis-adapter';
import {
  ChatMessagePayloadSchema,
  TrackIdSchema,
  SocketAuthSchema,
  safeValidate,
} from './schemas';

const AI_HISTORY_LIMIT = 12;
const PROACTIVE_MESSAGE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const LISTENER_CLEANUP_INTERVAL = 15 * 1000; // 15 seconds
const LISTENER_TIMEOUT = 30 * 1000; // 30 seconds
const ANNOUNCEMENT_FREQUENCY = 10; // Announce every 10 tracks (reduced from 5)
const MESSAGE_RATE_LIMIT = 10; // Max messages per minute per user
const MESSAGE_RATE_WINDOW = 60; // Rate limit window in seconds
const IDEMPOTENCY_TTL = 300; // 5 minutes TTL for idempotency keys

type AIMessagesPayload = Array<{ role: 'user' | 'assistant'; content: string }>;
const normalizeLocale = (locale?: string | null): 'pt' | 'en' => (locale === 'en' ? 'en' : 'pt');

// Simple in-memory rate limiter (use Redis in production for multi-instance)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

/**
 * Check if user is rate limited
 * @returns true if rate limited, false if allowed
 */
function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);

  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + MESSAGE_RATE_WINDOW * 1000 });
    return false;
  }

  if (userLimit.count >= MESSAGE_RATE_LIMIT) {
    return true;
  }

  userLimit.count++;
  return false;
}

/**
 * Check if message was already processed (idempotency)
 * @returns true if duplicate, false if new message
 */
async function isDuplicateMessage(clientMessageId: string | undefined): Promise<boolean> {
  if (!clientMessageId) return false;

  const key = `idempotency:${clientMessageId}`;
  const exists = await redis.exists(key);

  if (exists) {
    console.log(`[Idempotency] Duplicate message detected: ${clientMessageId}`);
    return true;
  }

  // Mark as processed with TTL
  await redis.set(key, '1', 'EX', IDEMPOTENCY_TTL);
  return false;
}

// Generate short, unique IDs for clients
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

// Track active Socket.IO instances to prevent duplicates
let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents> | null = null;
let redisSubscriber: Redis | null = null;
let redisPubClient: Redis | null = null;
let redisSubClient: Redis | null = null;
let proactiveMessageInterval: NodeJS.Timeout | null = null;
let listenerCleanupInterval: NodeJS.Timeout | null = null;

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
  });

  // Setup Redis adapter for multi-instance scaling
  setupRedisAdapter(io);

  // Add connection middleware
  setupMiddleware(io);

  // Register event handlers
  setupEventHandlers(io);

  // Setup Redis Subscriber for proactive announcements
  setupRedisSubscriber(io);

  // Setup proactive engagement messages
  setupProactiveMessaging(io);

  // Setup periodic listener cleanup
  setupListenerCleanup(io);

  console.log('Socket.IO server initialized');

  return io;
}

// Setup Redis adapter for multi-instance scaling
function setupRedisAdapter(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>): void {
  try {
    // Create dedicated Redis clients for the adapter (separate from main redis client)
    redisPubClient = new Redis(config.redis.url, {
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });
    redisSubClient = redisPubClient.duplicate();

    // Connect both clients
    Promise.all([redisPubClient.connect(), redisSubClient.connect()])
      .then(() => {
        io.adapter(createAdapter(redisPubClient!, redisSubClient!));
        console.log('[Socket.IO] Redis adapter enabled for multi-instance scaling');
      })
      .catch((error) => {
        console.error('[Socket.IO] Failed to setup Redis adapter:', error);
        console.log('[Socket.IO] Falling back to in-memory adapter (single instance only)');
      });
  } catch (error) {
    console.error('[Socket.IO] Error creating Redis adapter clients:', error);
    console.log('[Socket.IO] Using in-memory adapter (single instance only)');
  }
}

// Middleware setup
function setupMiddleware(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>): void {
  io.use(async (socket, next) => {
    try {
      // Validate socket auth data with Zod
      const authValidation = safeValidate(SocketAuthSchema, socket.handshake.auth);
      const auth = authValidation.success ? authValidation.data : {};

      const userId = auth.userId || nanoid();

      // Try to get persisted username with database fallback
      const persistedName = await redisHelpers.getUserNameWithFallback(userId, prisma);
      const handshakeUsername = auth.username;

      // Priority: Redis/DB cached name > handshake name > generated name
      const username = persistedName || handshakeUsername || `user_${userId.substring(0, 5)}`;

      const handshakeLocale = auth.locale;
      const parsedHandshakeLocale = handshakeLocale === 'en' ? 'en' : handshakeLocale === 'pt' ? 'pt' : null;
      const persistedLocale = await redisHelpers.getUserLocale(userId);
      const activeLocale = persistedLocale || parsedHandshakeLocale || 'pt';

      console.log(`[Connection] UserId: ${userId}, PersistedName: ${persistedName}, HandshakeName: ${handshakeUsername}, FinalUsername: ${username}`);

      // Store user info in socket data
      socket.data.userId = userId;
      socket.data.username = username;
      socket.data.locale = activeLocale;

      // Persist username in Redis to ensure it's available for dynamic resolution
      // This handles cases where Redis data might have been lost/expired but client still has the session
      if (username) {
        await redisHelpers.setUserName(userId, username);
      }
      if (parsedHandshakeLocale && parsedHandshakeLocale !== persistedLocale) {
        await redisHelpers.setUserLocale(userId, parsedHandshakeLocale);
      }

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
      await redisHelpers.addListener(socket.id);
      await redisHelpers.markUserActive(userId);

      await syncClientState(socket);

      // Get fresh count after all operations to avoid race conditions
      const listenersCount = await redisHelpers.getListenersCount();
      console.log(`Active listeners: ${listenersCount}`);

      io.emit(SOCKET_EVENTS.LISTENERS_UPDATE, { count: listenersCount });

      // Handle user connection (tracking and greeting)
      handleUserConnection(socket);
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
      // 0. Validate message payload with Zod schema
      const validation = safeValidate(ChatMessagePayloadSchema, message);
      if (!validation.success) {
        console.log(`[Validation] Invalid message from ${userId}: ${validation.error}`);
        socket.emit(SOCKET_EVENTS.ERROR, { message: validation.error });
        return;
      }

      const validatedMessage = validation.data;
      const userMessageId = nanoid();
      const aiMessageId = nanoid(); // Unique ID for AI's response
      const isPrivate = validatedMessage.isPrivate || false;
      const incomingLocale = validatedMessage.locale;
      const locale = normalizeLocale(incomingLocale || (socket.data.locale as string | null));
      socket.data.locale = locale;

      // Get current username from socket data (may have been updated)
      const currentUsername = socket.data.username as string;

      try {
        // 0a. Check rate limit
        if (isRateLimited(userId)) {
          console.log(`[RateLimit] User ${userId} exceeded rate limit`);
          const errorMsg = locale === 'en'
            ? 'Too many messages. Please wait a moment.'
            : 'Muitas mensagens. Por favor, aguarde um momento.';
          socket.emit(SOCKET_EVENTS.ERROR, { message: errorMsg });
          return;
        }

        // 0b. Check idempotency (prevent duplicate processing on retry)
        if (await isDuplicateMessage(validatedMessage.clientMessageId)) {
          console.log(`[Idempotency] Skipping duplicate message from ${userId}`);
          // Don't send error - client may be retrying, just acknowledge silently
          return;
        }

        // 0c. Moderate content
        const moderation = await ContentModerationService.validateMessage(validatedMessage.content);
        if (!moderation.safe) {
          console.log(`Blocked offensive message from ${currentUsername}: ${validatedMessage.content}`);
          socket.emit(SOCKET_EVENTS.ERROR, { message: `Mensagem bloqueada: ${moderation.reason}` });
          return;
        }

        // Persist locale preference for future interactions
        await redisHelpers.setUserLocale(userId, locale);

        // 1. Store and broadcast user's message
        const chatMessage: RedisChatMessage = {
          id: userMessageId,
          userId,
          username: currentUsername,
          content: validatedMessage.content,
          timestamp: Date.now(),
          type: 'user',
          isPrivate,
          locale,
        };

        await redisHelpers.addChatMessage(chatMessage);

        if (isPrivate) {
          // If private, only send back to the sender
          socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, chatMessage);
        } else {
          // If public, broadcast to everyone
          io.emit(SOCKET_EVENTS.CHAT_MESSAGE, chatMessage);
        }

        // Check if there are other listeners before processing AI response
        // Skip AI processing for public messages if user is alone (waste of API calls)
        const listenersCount = await redisHelpers.getListenersCount();
        if (!isPrivate && listenersCount <= 1) {
          console.log(`[Chat] Skipping AI response - only ${listenersCount} listener(s) connected`);
          // Emit completion event so client knows not to wait for AI
          socket.emit(SOCKET_EVENTS.AI_MESSAGE_COMPLETE, { messageId: aiMessageId, skipped: true });
          return;
        }

        // 2. Forward message to AI agent
        const conversationMessages = await buildAIConversationHistory();
        if (
          conversationMessages.length === 0 ||
          conversationMessages[conversationMessages.length - 1]?.role !== 'user'
        ) {
          conversationMessages.push({ role: 'user', content: validatedMessage.content });
        }

        if (conversationMessages.length > AI_HISTORY_LIMIT) {
          conversationMessages.splice(0, conversationMessages.length - AI_HISTORY_LIMIT);
        }

        const aiResponse = await fetch(`${config.app.url}/api/curation/process-message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: conversationMessages,
            data: { userId, username, isPrivate, locale },
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
          if (isPrivate) {
            socket.emit(SOCKET_EVENTS.AI_MESSAGE_CHUNK, { chunk, messageId: aiMessageId });
          } else {
            io.emit(SOCKET_EVENTS.AI_MESSAGE_CHUNK, { chunk, messageId: aiMessageId });
          }
        }

        // 4. Store full AI message and broadcast completion
        const aiChatMessage: RedisChatMessage = {
          id: aiMessageId,
          userId: 'ai', // AI's ID
          username: 'Lofine', // AI's username
          content: aiFullContent,
          timestamp: Date.now(),
          type: 'ai',
          isPrivate,
          targetUserId: isPrivate ? userId : undefined,
          locale,
        };
        await redisHelpers.addChatMessage(aiChatMessage);

        if (isPrivate) {
          socket.emit(SOCKET_EVENTS.AI_MESSAGE_COMPLETE, { messageId: aiMessageId });
        } else {
          io.emit(SOCKET_EVENTS.AI_MESSAGE_COMPLETE, { messageId: aiMessageId });
        }

      } catch (error) {
        console.error('Chat AI integration error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to process message with AI' });
      }
    });

    socket.on(SOCKET_EVENTS.PLAYLIST_VOTE, async (trackId) => {
      // Validate track ID
      const validation = safeValidate(TrackIdSchema, trackId);
      if (!validation.success) {
        console.log(`[Validation] Invalid track ID from ${userId}: ${validation.error}`);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Invalid track ID' });
        return;
      }

      const validatedTrackId = validation.data;

      try {
        const key = `${KEYS.PLAYLIST_VOTE}:${validatedTrackId}`;
        await redis.sadd(key, userId);
        const votesCount = await redis.scard(key);

        console.log(`Vote for track ${validatedTrackId} by ${userId}. Total votes: ${votesCount}`);

        io.emit(SOCKET_EVENTS.PLAYLIST_VOTE_UPDATE, { trackId: validatedTrackId, votes: votesCount });
      } catch (error) {
        console.error('Vote error:', error);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to register vote' });
      }
    });

    socket.on(SOCKET_EVENTS.HEARTBEAT, async () => {
      try {
        // Refresh listener timestamp to keep connection alive
        await redisHelpers.refreshListener(socket.id);
      } catch (error) {
        console.error('Heartbeat error:', error);
      }
    });

    socket.on('disconnect', async (reason) => {
      try {
        const currentUsername = socket.data.username as string;
        console.log(`Client disconnected: ${socket.id} (${currentUsername}). Reason: ${reason}`);
        await redisHelpers.removeListener(socket.id);
        // Get fresh count after removal to avoid race conditions
        const listenersCount = await redisHelpers.getListenersCount();
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

  redisSubscriber.subscribe('lofi-ever:queue-update', (err) => {
    if (err) {
      console.error('Failed to subscribe to Redis channel:', err);
      return;
    }
    console.log('Subscribed to lofi-ever:queue-update channel');
  });

  redisSubscriber.subscribe('lofi-ever:user-update', (err) => {
    if (err) {
      console.error('Failed to subscribe to Redis channel:', err);
      return;
    }
    console.log('Subscribed to lofi-ever:user-update channel');
  });

  redisSubscriber.on('message', async (channel, message) => {
    if (channel === 'lofi-ever:new-track') {
      try {
        const track: RedisTrack & { addedByUserId?: string } = JSON.parse(message);

        // Determine if we should announce this track
        let shouldAnnounce = false;
        let announcementContent = '';

        // 1. Always announce user requests
        if (track.addedBy && track.addedBy !== 'ai-curator' && track.addedBy !== 'system') {
          shouldAnnounce = true;

          // Resolve current username if userId is available
          let announcerName = track.addedBy;
          if (track.addedByUserId) {
            const currentName = await redisHelpers.getUserName(track.addedByUserId);
            if (currentName) {
              announcerName = currentName;
            }
          }

          announcementContent = `Tocando agora: "${track.title}" de ${track.artist}. Pedido especial de @${announcerName}! 🎧`;
        } else {
          // 2. For regular tracks, announce only every 10th track
          // AND only if there are listeners connected
          const listenersCount = await redisHelpers.getListenersCount();

          if (listenersCount > 0) {
            const counter = await redis.incr('lofiever:announcement_counter');
            if (counter % ANNOUNCEMENT_FREQUENCY === 0) {
              shouldAnnounce = true;
              // Use the standard proactive announcement generation
              const announcement = ProactiveEngagementService.generateTrackAnnouncement(track as unknown as Track);
              announcementContent = announcement.content;
            }
          }
        }

        // Broadcast track change event regardless of announcement
        io.emit(SOCKET_EVENTS.TRACK_CHANGE, track);

        if (shouldAnnounce) {
          const djAnnouncementMessageId = nanoid();

          // Broadcast DJ announcement
          io.emit(SOCKET_EVENTS.DJ_ANNOUNCEMENT, { message: announcementContent, track });

          // Store as a chat message
          const djChatMessage: RedisChatMessage = {
            id: djAnnouncementMessageId,
            userId: 'dj',
            username: 'Lofine',
            content: announcementContent,
            timestamp: Date.now(),
            type: 'system',
          };
          await redisHelpers.addChatMessage(djChatMessage);

          // Save to proactive messages history if it was generated by the service
          // We construct a message object to save
          await ProactiveEngagementService.saveProactiveMessage({
            type: 'track_announcement',
            content: announcementContent,
            metadata: {
              trackId: track.id,
              trackTitle: track.title,
              trackArtist: track.artist,
              mood: track.mood,
              addedBy: track.addedBy
            }
          });
        }
      } catch (error) {
        console.error('Error processing new track message from Redis:', error);
      }
    } else if (channel === 'lofi-ever:queue-update') {
      // When queue updates, notify all clients to refresh their playlist view
      // We don't send the full playlist here to save bandwidth, just the signal to fetch/refresh
      io.emit(SOCKET_EVENTS.PLAYLIST_UPDATE, []);
    } else if (channel === 'lofi-ever:user-update') {
      try {
        const { userId, username } = JSON.parse(message);
        console.log(`Received user update for ${userId}: ${username}`);

        // Find the socket for this user
        const sockets = await io.fetchSockets();
        const userSocket = sockets.find(s => s.data.userId === userId);

        if (userSocket) {
          // Update socket data
          userSocket.data.username = username;

          // Notify the specific client to update their local storage/state
          userSocket.emit(SOCKET_EVENTS.USER_UPDATE, { username });
        }
      } catch (error) {
        console.error('Error processing user update:', error);
      }
    }
  });
}

// Setup proactive engagement messaging
function setupProactiveMessaging(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>): void {
  if (proactiveMessageInterval) return; // Only setup once

  proactiveMessageInterval = setInterval(async () => {
    try {
      // Check if there are active listeners
      const listenersCount = await redisHelpers.getListenersCount();
      if (listenersCount === 0) {
        return; // Don't send messages if no one is listening
      }

      // Check if enough time has passed since last proactive message
      const shouldSend = await ProactiveEngagementService.shouldSendProactiveMessage(5);
      if (!shouldSend) {
        return;
      }

      // Get and send next proactive message
      const message = await ProactiveEngagementService.getNextProactiveMessage();
      const messageId = nanoid();

      // Broadcast engagement message
      const chatMessage: RedisChatMessage = {
        id: messageId,
        userId: 'dj',
        username: 'Lofine',
        content: message.content,
        timestamp: Date.now(),
        type: 'system',
      };

      await redisHelpers.addChatMessage(chatMessage);
      io.emit(SOCKET_EVENTS.CHAT_MESSAGE, chatMessage);

      // Save to history
      await ProactiveEngagementService.saveProactiveMessage(message);

    } catch (error) {
      console.error('Proactive messaging error:', error);
    }
  }, PROACTIVE_MESSAGE_INTERVAL);
}



// Setup periodic listener cleanup
function setupListenerCleanup(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>): void {
  if (listenerCleanupInterval) return; // Only setup once

  listenerCleanupInterval = setInterval(async () => {
    try {
      // Clean up inactive listeners (no heartbeat in last 30 seconds)
      const removedCount = await redisHelpers.cleanupInactiveListeners(LISTENER_TIMEOUT);

      if (removedCount > 0) {
        console.log(`Cleaned up ${removedCount} inactive listener(s)`);

        // Broadcast updated listener count
        const listenersCount = await redisHelpers.getListenersCount();
        io.emit(SOCKET_EVENTS.LISTENERS_UPDATE, { count: listenersCount });
      }
    } catch (error) {
      console.error('Error cleaning up inactive listeners:', error);
    }
  }, LISTENER_CLEANUP_INTERVAL);

  console.log('Listener cleanup system initialized');
}

async function buildAIConversationHistory(): Promise<AIMessagesPayload> {
  const rawHistory = await redisHelpers.getChatMessages(AI_HISTORY_LIMIT * 2);

  const chronological = rawHistory
    .filter((msg) => msg.type === 'user' || msg.type === 'ai')
    .reverse();

  const trimmed = chronological.length > AI_HISTORY_LIMIT
    ? chronological.slice(-AI_HISTORY_LIMIT)
    : chronological;

  return trimmed.map((msg) => ({
    role: msg.type === 'ai' ? 'assistant' : 'user',
    content: msg.content,
  }));
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
    // AND ensure private messages are only sent to the involved parties
    const relevantChatMessages = chatMessages.filter(msg => {
      // 1. Must be a valid type
      if (msg.type !== 'user' && msg.type !== 'ai' && msg.type !== 'system') return false;

      // 2. If private, only show to sender or recipient
      if (msg.isPrivate) {
        const socketUserId = socket.data.userId;
        return msg.userId === socketUserId || msg.targetUserId === socketUserId;
      }

      // 3. Public messages are shown to everyone
      return true;
    });

    socket.emit(SOCKET_EVENTS.CHAT_HISTORY, { messages: relevantChatMessages });
  }

  const listenersCount = await redisHelpers.getListenersCount();
  socket.emit(SOCKET_EVENTS.LISTENERS_UPDATE, { count: listenersCount });
}



// Update handleNewUserWelcome to handle returning users too
async function handleUserConnection(socket: Socket<ClientToServerEvents, ServerToClientEvents>): Promise<void> {
  const userId = socket.data.userId;
  const username = socket.data.username;
  const locale = normalizeLocale(socket.data.locale as string | null);
  socket.data.locale = locale;

  // Ignore temporary/guest users if needed, but for now track everyone
  if (!userId) return;

  try {
    // 1. Update User Stats in DB
    const user = await prisma.user.upsert({
      where: { id: userId },
      update: {
        lastSeenAt: new Date(),
        visitCount: { increment: 1 },
        username: username, // Update username if changed
      },
      create: {
        id: userId,
        username: username,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        visitCount: 1,
      },
    });

    console.log(`[User Memory] User ${username} (${userId}) connected. Visit count: ${user.visitCount}`);

    // 2. Decide on Greeting
    // Only greet if they haven't been seen in the last 1 hour to avoid spamming on reconnects
    // const ONE_HOUR = 60 * 60 * 1000;
    // const timeSinceLastSeen = new Date().getTime() - user.lastSeenAt.getTime();

    // If it's a brand new user (visitCount === 1) OR they've been away for a while
    // Note: upsert updates lastSeenAt, so we might need to check if it WAS long ago.
    // Actually, since we just updated it, we can't check the *previous* lastSeenAt easily without a separate read first.
    // For simplicity/performance, let's just check visitCount.

    if (user.visitCount === 1) {
      // New User Greeting
      await triggerAIGreeting(socket, userId, username, 'new_user', undefined, locale);
    } else {
      // Returning User Greeting
      // We can check if we should greet based on random chance or session gap if we tracked sessions better.
      // For now, let's greet returning users if they are "user_..." (meaning they might need a name) 
      // OR just give a warm "welcome back" to everyone but maybe throttled?
      // Let's just greet everyone for now as requested, but maybe add a small check to not be annoying?
      // The user asked: "lembre deles ... assim ele pode dar algumas saudações quando ouvintes conectarem"

      // Let's fetch their last request to add context
      const lastRequest = await prisma.trackRequest.findFirst({
        where: { userId: userId },
        orderBy: { createdAt: 'desc' },
        include: { track: true }
      });

      const context = {
        visitCount: user.visitCount,
        lastRequest: lastRequest?.track ? `${lastRequest.track.title} by ${lastRequest.track.artist}` : null
      };

      await triggerAIGreeting(socket, userId, username, 'returning_user', context, locale);
    }

  } catch (error) {
    console.error('Error handling user connection:', error);
  }
}

async function triggerAIGreeting(
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
  userId: string,
  username: string,
  type: 'new_user' | 'returning_user',
  context?: any,
  locale: 'pt' | 'en' = 'pt'
): Promise<void> {
  const aiMessageId = nanoid();

  let systemPrompt = '';
  if (type === 'new_user') {
    systemPrompt = 'O usuário acabou de entrar na rádio pela primeira vez. Dê as boas-vindas de forma calorosa e breve. Seja "chill" e faça ele se sentir em casa.';
  } else {
    systemPrompt = `O usuário ${username} retornou à rádio. Esta é a visita número ${context.visitCount} dele.`;
    if (context.lastRequest) {
      systemPrompt += ` A última música que ele pediu foi "${context.lastRequest}".`;
      systemPrompt += ` Mencione isso sutilmente ("Que bom te ver de novo! Ainda curtindo ${context.lastRequest}?").`;
    } else {
      systemPrompt += ` Dê um "oi" caloroso de boas-vindas de volta.`;
    }
    systemPrompt += ` Seja breve, amigável e "cool".`;
  }

  try {
    const conversationMessages = [{ role: 'system' as const, content: systemPrompt }];

    const aiResponse = await fetch(`${config.app.url}/api/curation/process-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: conversationMessages,
        data: { userId, username, isPrivate: true, locale }, // Force private greeting
      }),
    });

    if (!aiResponse.ok) throw new Error(`AI greeting response error: ${aiResponse.status}`);
    if (!aiResponse.body) return;

    let aiFullContent = '';
    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      aiFullContent += chunk;
      socket.emit(SOCKET_EVENTS.AI_MESSAGE_CHUNK, { chunk, messageId: aiMessageId });
    }

    const aiChatMessage: RedisChatMessage = {
      id: aiMessageId,
      userId: 'ai',
      username: 'Lofine',
      content: aiFullContent,
      timestamp: Date.now(),
      type: 'ai',
      isPrivate: true,
      targetUserId: userId,
      locale,
    };

    await redisHelpers.addChatMessage(aiChatMessage);
    socket.emit(SOCKET_EVENTS.AI_MESSAGE_COMPLETE, { messageId: aiMessageId });

  } catch (error) {
    console.error('Error sending AI greeting:', error);
  }
}


// Export server for testing
export function getIO(): SocketIOServer<ClientToServerEvents, ServerToClientEvents> | null {
  return io;
}

// Manually close socket server (for testing/shutdown)
export async function closeSocketServer(): Promise<void> {
  if (proactiveMessageInterval) {
    clearInterval(proactiveMessageInterval);
    proactiveMessageInterval = null;
  }

  if (listenerCleanupInterval) {
    clearInterval(listenerCleanupInterval);
    listenerCleanupInterval = null;
  }

  if (io) {
    await new Promise<void>((resolve) => {
      const server = io;
      if (server) {
        server.close(() => {
          io = null;

          // Close Redis subscriber
          if (redisSubscriber) {
            redisSubscriber.unsubscribe();
            redisSubscriber.quit();
            redisSubscriber = null;
          }

          // Close Redis adapter clients
          if (redisPubClient) {
            redisPubClient.quit();
            redisPubClient = null;
          }
          if (redisSubClient) {
            redisSubClient.quit();
            redisSubClient = null;
          }

          resolve();
        });
      } else {
        resolve();
      }
    });
  }
} 
