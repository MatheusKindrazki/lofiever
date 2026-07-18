import { createHash, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { MusicGeneration, MusicGenerationStatus } from '@prisma/client';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { MusicGenerationError } from './errors';
import { normalizeMusicPrompt } from './prompt-policy';
import type {
  MusicGenerationRequest,
  MusicGenerationRequestResult,
  RejectedMusicGeneration,
} from './types';

const ACTIVE_OR_CONSUMED_STATUSES: MusicGenerationStatus[] = [
  'QUEUED',
  'GENERATING',
  'VALIDATING',
  'PUBLISHED',
];
const ACTIVE_STATUSES: MusicGenerationStatus[] = ['QUEUED', 'GENERATING', 'VALIDATING'];
const AGE_CONFIRMATION_VERSION = 'google-genai-18plus-2026-07';

class RequestGateError extends Error {
  constructor(public readonly result: RejectedMusicGeneration) {
    super(result.message);
  }
}

function utcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function utcMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function stableIdempotencyKey(userId: string | undefined, value: string | undefined): string | undefined {
  if (!value) return undefined;
  return createHash('sha256').update(`${userId || 'editorial'}:${value}`).digest('hex');
}

function hashIp(ipAddress: string | undefined): string | undefined {
  if (!ipAddress || !config.musicGeneration.ipHashSecret) return undefined;
  return createHmac('sha256', config.musicGeneration.ipHashSecret).update(ipAddress).digest('hex');
}

function rejection(
  code: RejectedMusicGeneration['code'],
  message: string,
): RequestGateError {
  return new RequestGateError({ accepted: false, code, message });
}

function acceptedResult(generation: MusicGeneration): MusicGenerationRequestResult {
  const published = generation.status === 'PUBLISHED';
  return {
    accepted: true,
    generationId: generation.id,
    title: generation.title,
    status: published ? 'published' : 'queued',
    message: published
      ? `“${generation.title}” já está pronta no catálogo do Lofiever.`
      : `Peguei a ideia. Vou produzir “${generation.title}” e aviso quando ela entrar entre as próximas faixas.`,
  };
}

async function serializable<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
      if (code !== 'P2034') {
        throw error;
      }
    }
  }
  throw lastError;
}

export const MusicGenerationService = {
  async requestGeneration(request: MusicGenerationRequest): Promise<MusicGenerationRequestResult> {
    if (!config.musicGeneration.enabled) {
      return {
        accepted: false,
        code: 'FEATURE_DISABLED',
        message: 'O estúdio de faixas originais ainda não está aberto nesta instalação.',
      };
    }

    if (request.source === 'USER' && !request.userId) {
      return {
        accepted: false,
        code: 'AUTH_REQUIRED',
        message: 'Para criar uma faixa original, entre com sua conta e volte a fazer o pedido.',
      };
    }

    let normalized: ReturnType<typeof normalizeMusicPrompt>;
    try {
      normalized = normalizeMusicPrompt({
        prompt: request.prompt,
        title: request.title,
        mood: request.mood,
        bpm: request.bpm,
        durationSeconds: config.musicGeneration.targetDurationSeconds,
      });
    } catch (error) {
      if (error instanceof MusicGenerationError) {
        return { accepted: false, code: 'INVALID_PROMPT', message: error.message };
      }
      throw error;
    }

    const idempotencyKey = stableIdempotencyKey(request.userId, request.idempotencyKey);
    const ipHash = hashIp(request.ipAddress);

    let generation: MusicGeneration;
    try {
      generation = await serializable(() => prisma.$transaction(async (tx) => {
        if (idempotencyKey) {
          const existing = await tx.musicGeneration.findUnique({ where: { idempotencyKey } });
          if (existing) return existing;
        }

        if (request.source === 'USER') {
          const user = await tx.user.findUnique({ where: { id: request.userId! } });
          if (!user?.ageConfirmedAt || user.ageConfirmationVersion !== AGE_CONFIRMATION_VERSION) {
            throw rejection(
              'AGE_CONFIRMATION_REQUIRED',
              'Antes do primeiro pedido, confirme no estúdio que você tem 18 anos ou mais.',
            );
          }

          const dailyCount = await tx.musicGeneration.count({
            where: {
              source: 'USER',
              userId: request.userId,
              status: { in: ACTIVE_OR_CONSUMED_STATUSES },
              createdAt: { gte: utcDayStart() },
            },
          });
          if (dailyCount >= config.musicGeneration.userDailyLimit) {
            throw rejection(
              'USER_DAILY_LIMIT',
              'Seu pedido original de hoje já foi usado. O estúdio reabre sua cota à meia-noite UTC.',
            );
          }

          const globalCount = await tx.musicGeneration.count({
            where: {
              source: 'USER',
              status: { in: ACTIVE_OR_CONSUMED_STATUSES },
              createdAt: { gte: utcDayStart() },
            },
          });
          if (globalCount >= config.musicGeneration.globalDailyLimit) {
            throw rejection(
              'GLOBAL_DAILY_LIMIT',
              'O estúdio encerrou os pedidos de hoje. A agenda reabre à meia-noite UTC.',
            );
          }

          const activeRequest = await tx.musicGeneration.findFirst({
            where: {
              source: 'USER',
              status: { in: ACTIVE_STATUSES },
              OR: [
                { userId: request.userId },
                ...(ipHash ? [{ ipHash }] : []),
              ],
            },
            select: { id: true },
          });
          if (activeRequest) {
            throw rejection(
              'ACTIVE_REQUEST_EXISTS',
              'Seu estúdio já está produzindo uma faixa. Aguarde essa geração terminar.',
            );
          }
        }

        const monthlySpend = await tx.musicGeneration.aggregate({
          where: { createdAt: { gte: utcMonthStart() } },
          _sum: { actualCostUsd: true },
        });
        if ((monthlySpend._sum.actualCostUsd || 0) >= config.musicGeneration.monthlyBudgetUsd) {
          throw rejection(
            'MONTHLY_BUDGET_REACHED',
            'O orçamento mensal do estúdio foi atingido. Novas gerações estão pausadas.',
          );
        }

        return tx.musicGeneration.create({
          data: {
            source: request.source,
            userId: request.userId,
            username: request.username,
            ipHash,
            title: normalized.title,
            originalPrompt: normalized.originalPrompt,
            normalizedPrompt: normalized.normalizedPrompt,
            promptHash: normalized.promptHash,
            locale: request.locale || 'pt',
            mood: normalized.mood,
            bpm: normalized.bpm,
            durationSeconds: normalized.durationSeconds,
            provider: config.musicGeneration.provider,
            model: config.musicGeneration.google.model,
            estimatedCostUsd: 0.08,
            moderationResult: normalized.moderationResult,
            idempotencyKey,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    } catch (error) {
      if (error instanceof RequestGateError) return error.result;
      const prismaErrorCode = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
      if (
        prismaErrorCode === 'P2002'
        && idempotencyKey
      ) {
        const existing = await prisma.musicGeneration.findUnique({ where: { idempotencyKey } });
        if (existing) return acceptedResult(existing);
      }
      throw error;
    }

    if (generation.status !== 'PUBLISHED') {
      try {
        const { enqueueMusicGeneration } = await import('./queue');
        await enqueueMusicGeneration(generation.id);
      } catch (error) {
        console.error('[MusicGeneration] Failed to enqueue generation:', error);
        await prisma.musicGeneration.update({
          where: { id: generation.id },
          data: {
            status: 'FAILED',
            failureCode: 'QUEUE_UNAVAILABLE',
            failureReason: error instanceof Error ? error.message : 'Queue unavailable',
            completedAt: new Date(),
          },
        });
        return {
          accepted: false,
          code: 'QUEUE_UNAVAILABLE',
          message: 'O estúdio não conseguiu iniciar a produção. Sua cota foi devolvida.',
        };
      }
    }

    return acceptedResult(generation);
  },

  async confirmAdult(userId: string, username: string): Promise<void> {
    const now = new Date();
    await prisma.user.upsert({
      where: { id: userId },
      update: {
        username,
        ageConfirmedAt: now,
        ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
      },
      create: {
        id: userId,
        username,
        ageConfirmedAt: now,
        ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
      },
    });
  },

  async getAccess(userId?: string): Promise<{
    enabled: boolean;
    authenticated: boolean;
    ageConfirmed: boolean;
    remainingToday: number;
    globalRemainingToday: number;
  }> {
    if (!userId) {
      return {
        enabled: config.musicGeneration.enabled,
        authenticated: false,
        ageConfirmed: false,
        remainingToday: 0,
        globalRemainingToday: 0,
      };
    }

    const [user, userCount, globalCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.musicGeneration.count({
        where: {
          source: 'USER',
          userId,
          status: { in: ACTIVE_OR_CONSUMED_STATUSES },
          createdAt: { gte: utcDayStart() },
        },
      }),
      prisma.musicGeneration.count({
        where: {
          source: 'USER',
          status: { in: ACTIVE_OR_CONSUMED_STATUSES },
          createdAt: { gte: utcDayStart() },
        },
      }),
    ]);

    return {
      enabled: config.musicGeneration.enabled,
      authenticated: true,
      ageConfirmed: Boolean(
        user?.ageConfirmedAt && user.ageConfirmationVersion === AGE_CONFIRMATION_VERSION,
      ),
      remainingToday: Math.max(0, config.musicGeneration.userDailyLimit - userCount),
      globalRemainingToday: Math.max(0, config.musicGeneration.globalDailyLimit - globalCount),
    };
  },

  async reserveProviderAttempt(generationId: string, costUsd: number): Promise<void> {
    await serializable(() => prisma.$transaction(async (tx) => {
      const monthlySpend = await tx.musicGeneration.aggregate({
        where: { createdAt: { gte: utcMonthStart() } },
        _sum: { actualCostUsd: true },
      });
      if ((monthlySpend._sum.actualCostUsd || 0) + costUsd > config.musicGeneration.monthlyBudgetUsd) {
        throw new MusicGenerationError(
          'MONTHLY_BUDGET_REACHED',
          'O orçamento mensal foi atingido antes desta tentativa.',
        );
      }

      await tx.musicGeneration.update({
        where: { id: generationId },
        data: {
          status: 'GENERATING',
          startedAt: new Date(),
          attempts: { increment: 1 },
          actualCostUsd: { increment: costUsd },
          failureCode: null,
          failureReason: null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  },
};

export { AGE_CONFIRMATION_VERSION };
