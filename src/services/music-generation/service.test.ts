import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { enqueueMusicGeneration } from './queue';
import { AGE_CONFIRMATION_VERSION, MusicGenerationService } from './service';

jest.mock('@/lib/config', () => ({
  config: {
    musicGeneration: {
      enabled: true,
      provider: 'google-lyria',
      userDailyLimit: 1,
      globalDailyLimit: 20,
      monthlyBudgetUsd: 100,
      targetDurationSeconds: 180,
      ipHashSecret: 'test-secret',
      google: { model: 'lyria-3-pro-preview' },
    },
  },
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    musicGeneration: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('./queue', () => ({
  enqueueMusicGeneration: jest.fn(),
}));

const mockedPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  user: { findUnique: jest.Mock; upsert: jest.Mock };
  musicGeneration: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};
const mockedConfig = config as unknown as { musicGeneration: { enabled: boolean } };
const mockedEnqueue = enqueueMusicGeneration as jest.MockedFunction<typeof enqueueMusicGeneration>;

describe('MusicGenerationService.requestGeneration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.musicGeneration.enabled = true;
    mockedPrisma.$transaction.mockImplementation((callback: (tx: typeof mockedPrisma) => unknown) => callback(mockedPrisma));
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'listener@example.com',
      ageConfirmedAt: new Date(),
      ageConfirmationVersion: AGE_CONFIRMATION_VERSION,
    });
    mockedPrisma.musicGeneration.count.mockResolvedValue(0);
    mockedPrisma.musicGeneration.findFirst.mockResolvedValue(null);
    mockedPrisma.musicGeneration.aggregate.mockResolvedValue({ _sum: { actualCostUsd: 8.4 } });
    mockedPrisma.musicGeneration.create.mockResolvedValue({
      id: 'generation-1',
      title: 'Chuva na Biblioteca',
      status: 'QUEUED',
    });
    mockedEnqueue.mockResolvedValue();
  });

  it('requires a verified listener identity for a listener request', async () => {
    const result = await MusicGenerationService.requestGeneration({
      source: 'USER',
      prompt: 'Rhodes quente com chuva leve e bateria macia para estudar',
    });

    expect(result).toMatchObject({ accepted: false, code: 'AUTH_REQUIRED' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires the current adult confirmation before reserving quota', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'listener@example.com',
      ageConfirmedAt: null,
      ageConfirmationVersion: null,
    });

    const result = await MusicGenerationService.requestGeneration({
      source: 'USER',
      userId: 'listener@example.com',
      username: 'Listener',
      prompt: 'Rhodes quente com chuva leve e bateria macia para estudar',
    });

    expect(result).toMatchObject({ accepted: false, code: 'AGE_CONFIRMATION_REQUIRED' });
    expect(mockedPrisma.musicGeneration.create).not.toHaveBeenCalled();
  });

  it('enforces one consumed or active generation per user per day', async () => {
    mockedPrisma.musicGeneration.count.mockResolvedValueOnce(1);

    const result = await MusicGenerationService.requestGeneration({
      source: 'USER',
      userId: 'listener@example.com',
      username: 'Listener',
      prompt: 'Rhodes quente com chuva leve e bateria macia para estudar',
    });

    expect(result).toMatchObject({ accepted: false, code: 'USER_DAILY_LIMIT' });
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });

  it('persists and enqueues an approved generation', async () => {
    const result = await MusicGenerationService.requestGeneration({
      source: 'USER',
      userId: 'listener@example.com',
      username: 'Listener',
      ipAddress: '203.0.113.10',
      idempotencyKey: 'chat-message-1',
      title: 'Chuva na Biblioteca',
      mood: 'focused',
      bpm: 70,
      prompt: 'Rhodes quente com chuva leve e bateria macia para estudar',
    });

    expect(result).toMatchObject({
      accepted: true,
      generationId: 'generation-1',
      status: 'queued',
    });
    expect(mockedPrisma.musicGeneration.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source: 'USER',
        userId: 'listener@example.com',
        title: 'Chuva na Biblioteca',
      }),
    }));
    expect(mockedPrisma.musicGeneration.count).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        OR: [
          { userId: 'listener@example.com' },
          { ipHash: expect.any(String) },
        ],
      }),
    });
    expect(mockedEnqueue).toHaveBeenCalledWith('generation-1');
  });
});
