/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '@/lib/prisma';
import { redis, redisHelpers } from '@/lib/redis';

jest.mock('next/server', () => {
  class MockNextResponse {
    private readonly body: unknown;
    readonly status: number;

    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }

    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }

    async json() {
      return this.body;
    }
  }

  return { NextResponse: MockNextResponse };
});

jest.mock('@/lib/redis', () => ({
  redis: {
    lrange: jest.fn(),
    ltrim: jest.fn(),
    del: jest.fn(),
    lpop: jest.fn(),
    get: jest.fn(),
    publish: jest.fn(),
  },
  redisHelpers: {
    setCurrentTrack: jest.fn(),
    setPlaybackState: jest.fn(),
  },
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    musicGeneration: { findUnique: jest.fn() },
    playbackHistory: { create: jest.fn() },
    track: { findUnique: jest.fn(), update: jest.fn() },
    trackRequest: { update: jest.fn() },
  },
}));

import { POST } from '../route';

const catalogTrack = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Night Bus',
  artist: 'Cloud Break',
  sourceType: 's3',
  sourceId: 'music/11111111-1111-4111-8111-111111111111-night-bus.mp3',
  origin: 'catalog',
  duration: 180,
  bpm: 78,
  mood: 'calm',
  artworkUrl: '/cover.jpg',
  addedBy: 'ai-curator',
};

const generatedTrack = {
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Piano Dance',
  artist: 'Lofine DJ',
  sourceType: 's3',
  sourceId: 'music/generated/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/streaming.mp3',
  origin: 'generated_user',
  duration: 180,
  bpm: 82,
  mood: 'cozy',
  artworkUrl: '/generated-cover.jpg',
  addedBy: 'Matheus',
  addedByUserId: 'user-1',
};

const buildRequest = (body: Record<string, string>) =>
  ({ json: jest.fn().mockResolvedValue(body) }) as any;

describe('POST /api/track-started', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (redis.get as jest.Mock).mockResolvedValue('7');
    (redis.ltrim as jest.Mock).mockResolvedValue('OK');
    (redis.del as jest.Mock).mockResolvedValue(1);
    (redis.publish as jest.Mock).mockResolvedValue(1);
    (prisma.playbackHistory.create as jest.Mock).mockResolvedValue({ id: 'history-1' });
    (prisma.track.update as jest.Mock).mockResolvedValue(catalogTrack);
    (prisma.trackRequest.update as jest.Mock).mockResolvedValue({});
  });

  it('records history only when the matching buffered track actually starts', async () => {
    (redis.lrange as jest.Mock).mockResolvedValue([
      JSON.stringify(catalogTrack),
      JSON.stringify({ ...catalogTrack, id: '33333333-3333-4333-8333-333333333333' }),
    ]);

    const response = await POST(buildRequest({ trackId: catalogTrack.id }));

    expect(response.status).toBe(200);
    expect(redisHelpers.setCurrentTrack).toHaveBeenCalledWith(catalogTrack);
    expect(redisHelpers.setPlaybackState).toHaveBeenCalledWith(
      expect.objectContaining({ isPlaying: true, position: 0 }),
    );
    expect(prisma.playbackHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ trackId: catalogTrack.id, version: 7 }),
    });
    expect(prisma.track.update).toHaveBeenCalledWith({
      where: { id: catalogTrack.id },
      data: { lastPlayed: expect.any(Date) },
    });
  });

  it('resolves a generated object path through its generation id', async () => {
    (redis.lrange as jest.Mock).mockResolvedValue([JSON.stringify(generatedTrack)]);
    (prisma.musicGeneration.findUnique as jest.Mock).mockResolvedValue({
      trackId: generatedTrack.id,
    });

    const response = await POST(
      buildRequest({ generationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    );

    expect(response.status).toBe(200);
    expect(prisma.musicGeneration.findUnique).toHaveBeenCalledWith({
      where: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      select: { trackId: true },
    });
    expect(redisHelpers.setCurrentTrack).toHaveBeenCalledWith(generatedTrack);
    expect(prisma.playbackHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ trackId: generatedTrack.id }),
    });
  });

  it('keeps compatibility with the malformed generated id sent by the old Liquidsoap script', async () => {
    (redis.lrange as jest.Mock).mockResolvedValue([JSON.stringify(generatedTrack)]);
    (redis.lpop as jest.Mock).mockResolvedValue(JSON.stringify(generatedTrack));

    const response = await POST(
      buildRequest({ trackId: 'generated/aaaaaaaa-aaaa-4aaa-8aaa-aa' }),
    );

    expect(response.status).toBe(200);
    expect(redis.lpop).toHaveBeenCalledWith('lofiever:liquidsoap:buffer');
    expect(redisHelpers.setCurrentTrack).toHaveBeenCalledWith(generatedTrack);
    expect((await response.json()) as object).toEqual({ success: true });
  });

  it('publishes request metadata so the DJ can announce an original request', async () => {
    (redis.lrange as jest.Mock).mockResolvedValue([JSON.stringify(generatedTrack)]);

    await POST(buildRequest({ trackId: generatedTrack.id }));

    const publishedPayload = JSON.parse((redis.publish as jest.Mock).mock.calls[0][1]);
    expect(publishedPayload).toMatchObject({
      id: generatedTrack.id,
      origin: 'generated_user',
      addedBy: 'Matheus',
      addedByUserId: 'user-1',
    });
  });
});
