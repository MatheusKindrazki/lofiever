import { PrismaClient } from '@prisma/client';

// Define our own Track type that matches the Prisma schema
export interface Track {
  id: string;
  title: string;
  artist: string;
  sourceType: string;
  sourceId: string;
  duration: number;
  bpm?: number | null;
  mood?: string | null;
  createdAt: Date;
  lastPlayed?: Date | null;
}

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  // Connection pooling configuration
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Utility functions for common database operations
export const prismaHelpers = {
  // Track related helpers
  async getTrackById(id: string): Promise<Track | null> {
    return prisma.track.findUnique({
      where: { id },
    }) as Promise<Track | null>;
  },

  async getRecentTracks(limit = 10): Promise<Track[]> {
    return prisma.track.findMany({
      orderBy: { lastPlayed: 'desc' },
      take: limit,
    }) as Promise<Track[]>;
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