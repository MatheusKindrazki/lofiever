import { prisma } from '@/lib/prisma';
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import type { Track } from '@prisma/client';
import { redis } from '@/lib/redis';

export interface ModerationResult {
  approved: boolean;
  reason: string;
  trackId?: string;
  trackTitle?: string;
  trackArtist?: string;
}

export interface RateLimitConfig {
  maxRequestsPerHour: number;
  maxRequestsPerDay: number;
}

export interface DuplicateCheckConfig {
  lookbackMinutes: number;
}

export interface CooldownConfig {
  cooldownMinutes: number;
}

// Default moderation rules
const DEFAULT_RULES = {
  rate_limit: {
    maxRequestsPerHour: 5,
    maxRequestsPerDay: 20,
  },
  duplicate_check: {
    lookbackMinutes: 60, // Don't allow same track within 60 minutes
  },
  cooldown: {
    cooldownMinutes: 2, // User must wait 2 minutes between requests
  },
};

export const ModerationService = {
  /**
   * Process a track request from a user
   */
  async processTrackRequest(
    userId: string,
    username: string,
    query: string,
    options: { ignoreCooldown?: boolean } = {}
  ): Promise<ModerationResult> {
    // 1. Find the track
    const track = await this.findTrackByQuery(query);

    // 2. Create the request record
    const request = await prisma.trackRequest.create({
      data: {
        userId,
        username,
        query,
        trackId: track?.id || null,
        status: 'pending',
      },
    });

    // 3. If track not found, mark as not_found
    if (!track) {
      await prisma.trackRequest.update({
        where: { id: request.id },
        data: {
          status: 'not_found',
          processedAt: new Date(),
          processedBy: 'auto',
          reason: 'Track not found in catalog',
        },
      });

      return {
        approved: false,
        reason: `Não encontrei "${query}" no catálogo. Tente outro título ou artista!`,
      };
    }

    // 4. Apply moderation rules
    const moderationResult = await this.applyModerationRules(userId, track, request.id, options);

    // 5. If approved, add to playlist
    if (moderationResult.approved) {
      await PlaylistManagerService.addTrackToPlaylist(track.id, `user:${userId}`, userId);

      await prisma.trackRequest.update({
        where: { id: request.id },
        data: {
          status: 'auto_approved',
          processedAt: new Date(),
          processedBy: 'auto',
          reason: moderationResult.reason,
        },
      });

      // Update user stats
      await this.incrementUserStats(userId, true);

      return {
        approved: true,
        reason: moderationResult.reason,
        trackId: track.id,
        trackTitle: track.title,
        trackArtist: track.artist,
      };
    }

    // 6. Request was rejected
    await prisma.trackRequest.update({
      where: { id: request.id },
      data: {
        status: 'rejected',
        processedAt: new Date(),
        processedBy: 'auto',
        reason: moderationResult.reason,
      },
    });

    // Update user stats
    await this.incrementUserStats(userId, false);

    return moderationResult;
  },

  /**
   * Find a track by query (title and/or artist)
   */
  async findTrackByQuery(query: string): Promise<Track | null> {
    // Try exact match first
    let track = await prisma.track.findFirst({
      where: {
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { artist: { contains: query, mode: 'insensitive' } },
        ],
      },
    });

    if (track) return track;

    // Try splitting query into words for better matching
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    for (const word of words) {
      track = await prisma.track.findFirst({
        where: {
          OR: [
            { title: { contains: word, mode: 'insensitive' } },
            { artist: { contains: word, mode: 'insensitive' } },
          ],
        },
      });
      if (track) return track;
    }

    return null;
  },

  /**
   * Apply all moderation rules to a request
   */
  async applyModerationRules(
    userId: string,
    track: Track,
    _requestId: string,
    options: { ignoreCooldown?: boolean } = {}
  ): Promise<ModerationResult> {
    // Get enabled rules from database, or use defaults
    // Note: rules variable is fetched but currently used only for future extensibility
    await prisma.moderationRule.findMany({
      where: { enabled: true },
      orderBy: { priority: 'desc' },
    });

    // Check rate limit
    const rateLimitResult = await this.checkRateLimit(userId);
    if (!rateLimitResult.approved) {
      return rateLimitResult;
    }

    // Check cooldown
    if (!options.ignoreCooldown) {
      const cooldownResult = await this.checkCooldown(userId);
      if (!cooldownResult.approved) {
        return cooldownResult;
      }
    }

    // Check for duplicates
    const duplicateResult = await this.checkDuplicate(track.id);
    if (!duplicateResult.approved) {
      return duplicateResult;
    }

    return {
      approved: true,
      reason: 'Passed all moderation rules',
      trackId: track.id,
      trackTitle: track.title,
      trackArtist: track.artist,
    };
  },

  /**
   * Check rate limit for user
   */
  async checkRateLimit(userId: string): Promise<ModerationResult> {
    const stats = await this.getOrCreateUserStats(userId);
    const config = DEFAULT_RULES.rate_limit;

    // Reset hourly count if needed
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (stats.lastResetHourly < hourAgo) {
      await prisma.userModerationStats.update({
        where: { id: stats.id },
        data: {
          requestsThisHour: 0,
          lastResetHourly: new Date(),
        },
      });
      stats.requestsThisHour = 0;
    }

    // Reset daily count if needed
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (stats.lastResetDaily < dayAgo) {
      await prisma.userModerationStats.update({
        where: { id: stats.id },
        data: {
          requestsToday: 0,
          lastResetDaily: new Date(),
        },
      });
      stats.requestsToday = 0;
    }

    if (stats.requestsThisHour >= config.maxRequestsPerHour) {
      return {
        approved: false,
        reason: `Você já fez ${config.maxRequestsPerHour} pedidos nessa hora. Aguarde um pouco!`,
      };
    }

    if (stats.requestsToday >= config.maxRequestsPerDay) {
      return {
        approved: false,
        reason: `Você atingiu o limite de ${config.maxRequestsPerDay} pedidos por dia. Volte amanhã!`,
      };
    }

    return { approved: true, reason: 'Rate limit OK' };
  },

  /**
   * Check cooldown between requests
   */
  async checkCooldown(userId: string): Promise<ModerationResult> {
    const stats = await this.getOrCreateUserStats(userId);
    const config = DEFAULT_RULES.cooldown;

    if (stats.lastRequestAt) {
      const cooldownEnd = new Date(
        stats.lastRequestAt.getTime() + config.cooldownMinutes * 60 * 1000
      );

      if (new Date() < cooldownEnd) {
        const remainingSeconds = Math.ceil(
          (cooldownEnd.getTime() - Date.now()) / 1000
        );
        return {
          approved: false,
          reason: `Aguarde ${remainingSeconds} segundos antes de fazer outro pedido.`,
        };
      }
    }

    return { approved: true, reason: 'Cooldown OK' };
  },

  /**
   * Check for duplicate tracks in recent playlist
   */
  async checkDuplicate(trackId: string): Promise<ModerationResult> {
    const config = DEFAULT_RULES.duplicate_check;
    const lookbackTime = new Date(
      Date.now() - config.lookbackMinutes * 60 * 1000
    );

    // Check if track was recently added to playlist
    const recentAddition = await prisma.playlistTrack.findFirst({
      where: {
        trackId,
        addedAt: { gte: lookbackTime },
      },
      include: { track: true },
    });

    if (recentAddition) {
      return {
        approved: false,
        reason: `"${recentAddition.track.title}" já foi adicionada recentemente. Que tal outra música?`,
      };
    }

    // Check if track is currently in the active playlist queue (Redis)
    const QUEUE_KEY = 'lofiever:playlist:upcoming';
    const queueItems = await redis.lrange(QUEUE_KEY, 0, -1);

    const isInQueue = queueItems.some(item => {
      try {
        const parsed = JSON.parse(item);
        return parsed.id === trackId;
      } catch {
        return false;
      }
    });

    if (isInQueue) {
      const track = await prisma.track.findUnique({ where: { id: trackId } });
      return {
        approved: false,
        reason: `"${track?.title}" já está na fila. Escolha outra!`,
      };
    }

    return { approved: true, reason: 'No duplicate found' };
  },

  /**
   * Get or create user moderation stats
   */
  async getOrCreateUserStats(userId: string) {
    let stats = await prisma.userModerationStats.findUnique({
      where: { userId },
    });

    if (!stats) {
      stats = await prisma.userModerationStats.create({
        data: { userId },
      });
    }

    return stats;
  },

  /**
   * Increment user stats after a request
   */
  async incrementUserStats(userId: string, approved: boolean): Promise<void> {
    const stats = await this.getOrCreateUserStats(userId);

    await prisma.userModerationStats.update({
      where: { id: stats.id },
      data: {
        requestsThisHour: { increment: 1 },
        requestsToday: { increment: 1 },
        totalRequests: { increment: 1 },
        lastRequestAt: new Date(),
        ...(approved
          ? { approvedRequests: { increment: 1 } }
          : { rejectedRequests: { increment: 1 } }),
      },
    });
  },

  /**
   * Get moderation stats for admin dashboard
   */
  async getModerationStats() {
    const [
      totalRequests,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      recentRequests,
    ] = await Promise.all([
      prisma.trackRequest.count(),
      prisma.trackRequest.count({ where: { status: 'pending' } }),
      prisma.trackRequest.count({
        where: { status: { in: ['approved', 'auto_approved'] } },
      }),
      prisma.trackRequest.count({ where: { status: 'rejected' } }),
      prisma.trackRequest.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: { track: true },
      }),
    ]);

    return {
      totalRequests,
      pendingRequests,
      approvedRequests,
      rejectedRequests,
      recentRequests,
    };
  },

  /**
   * Get user-specific moderation stats
   */
  async getUserStats(userId: string) {
    const stats = await this.getOrCreateUserStats(userId);
    return {
      requestsThisHour: stats.requestsThisHour,
      requestsToday: stats.requestsToday,
      totalRequests: stats.totalRequests,
      approvedRequests: stats.approvedRequests,
      rejectedRequests: stats.rejectedRequests,
      remainingHourly: DEFAULT_RULES.rate_limit.maxRequestsPerHour - stats.requestsThisHour,
      remainingDaily: DEFAULT_RULES.rate_limit.maxRequestsPerDay - stats.requestsToday,
    };
  },
};
