import { PrismaClient, type Track } from '@prisma/client';

// Check if we're in build time (no DATABASE_URL available)
const isBuildTime = process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL;

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
const globalForPrisma = global as unknown as { prisma: PrismaClient | null };

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

// Lazy initialization - only create client when actually needed
let _prisma: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
  if (isBuildTime) {
    throw new Error('Database is not available during build time');
  }

  if (!_prisma) {
    _prisma = globalForPrisma.prisma || createPrismaClient();
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = _prisma;
    }
  }
  return _prisma;
}

// Export a proxy that lazily initializes the Prisma client
export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop) {
    if (isBuildTime) {
      // During build, return no-op to prevent crashes
      if (typeof prop === 'string') {
        // Return a proxy for model access (e.g., prisma.track)
        return new Proxy({}, {
          get() {
            return () => Promise.resolve(null);
          }
        });
      }
      return undefined;
    }
    const client = getPrismaClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});

// Utility functions for common database operations
export const prismaHelpers = {
  // Track related helpers
  async getTrackById(id: string): Promise<Track | null> {
    return prisma.track.findUnique({
      where: { id },
    });
  },

  async getRecentTracks(limit = 10): Promise<Track[]> {
    return prisma.track.findMany({
      orderBy: { lastPlayed: 'desc' },
      take: limit,
    });
  },
  
  // Playlist related helpers
  async getActivePlaylist() {
    return prisma.playlist.findFirst({
      where: { active: true },
      include: {
        tracks: {
          include: {
            track: true,
          },
          orderBy: {
            position: 'asc',
          },
        },
      },
    });
  },
  
  async createPlaylist(version: number, trackIds: string[]) {
    // Deactivate current active playlist
    await prisma.playlist.updateMany({
      where: { active: true },
      data: { active: false },
    });
    
    // Create new playlist
    return prisma.playlist.create({
      data: {
        version,
        active: true,
        tracks: {
          create: trackIds.map((trackId, index) => ({
            trackId,
            position: index,
          })),
        },
      },
      include: {
        tracks: {
          include: {
            track: true,
          },
          orderBy: {
            position: 'asc',
          },
        },
      },
    });
  },
  
  // Playback history helpers
  async recordPlayback(trackId: string, version: number) {
    return prisma.playbackHistory.create({
      data: {
        trackId,
        startedAt: new Date(),
        version,
      },
    });
  },
  
  async completePlayback(historyId: string, listenersPeak: number) {
    return prisma.playbackHistory.update({
      where: { id: historyId },
      data: {
        endedAt: new Date(),
        listenersPeak,
      },
    });
  },
  
  // Chat and feedback helpers
  async saveChatMessage(userId: string, content: string, type: string) {
    return prisma.chatMessage.create({
      data: {
        userId,
        content,
        type,
      },
    });
  },
  
  async saveTrackFeedback(trackId: string, userId: string, sentiment: string, comment?: string) {
    return prisma.feedback.create({
      data: {
        trackId,
        userId,
        sentiment,
        comment,
      },
    });
  },
} as const; 
