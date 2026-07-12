/* eslint-disable @typescript-eslint/no-explicit-any */
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import { getSessionOrGuestToken } from '@/lib/auth/tokens';

// Mock NextResponse to a lightweight container we can introspect.
jest.mock('next/server', () => {
  class MockNextResponse {
    private _body: unknown;
    private _init: { status?: number };
    constructor(body: unknown, init?: { status?: number }) {
      this._body = body;
      this._init = init || {};
    }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
    get status() {
      return this._init.status ?? 200;
    }
    async json() {
      return this._body;
    }
  }
  return { NextResponse: MockNextResponse };
});

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth/options', () => ({ authOptions: {} }));

jest.mock('@/lib/auth/tokens', () => ({
  getSessionOrGuestToken: jest.fn(),
}));

// Security passes by default; individual concerns (auth/validation) are tested
// at the route level.
jest.mock('@/lib/api-security', () => ({
  validateRequest: jest.fn().mockResolvedValue(null),
  RATE_LIMITS: { api: { window: 60, max: 100 } },
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    track: { findUnique: jest.fn() },
    playbackHistory: { findMany: jest.fn() },
  },
}));

jest.mock('@/lib/redis', () => ({
  redis: { get: jest.fn(), lrange: jest.fn(), llen: jest.fn(), publish: jest.fn() },
  redisHelpers: { getCurrentTrack: jest.fn() },
}));

jest.mock('@/services/playlist/playlist-manager.service', () => ({
  PlaylistManagerService: {
    queueTrack: jest.fn(),
    refillQueue: jest.fn(),
  },
}));

// Keep config youtube disabled so the playable whitelist is r2/s3/local only.
jest.mock('@/lib/config', () => ({
  config: { youtube: { enabled: false } },
}));

import { POST } from '../route';

const mockedSession = getServerSession as unknown as jest.Mock;
const mockedGuestToken = getSessionOrGuestToken as unknown as jest.Mock;
const mockedFindUnique = prisma.track.findUnique as unknown as jest.Mock;
const mockedQueueTrack = PlaylistManagerService.queueTrack as unknown as jest.Mock;

const buildRequest = (body: unknown, headers: Array<[string, string]> = []): any => ({
  json: jest.fn().mockResolvedValue(body),
  headers: new Map(headers),
});

const authedSession = { user: { name: 'Matheus', email: 'matheus@example.com' } };

const r2Track = {
  id: 'r2-track-1',
  title: 'Rainy Night',
  artist: 'Lofi Artist',
  sourceType: 's3',
  sourceId: 'tracks/rainy.mp3',
  duration: 200,
  bpm: 80,
  mood: 'calm',
};

const youtubeTrack = {
  id: 'yt-track-1',
  title: 'YT Beat',
  artist: 'YT Artist',
  sourceType: 'youtube',
  sourceId: 'dQw4w9WgXcQ',
  duration: 180,
  bpm: null,
  mood: 'relaxed',
};

describe('POST /api/playlist/queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGuestToken.mockResolvedValue(null);
  });

  it('queues a playable track for an authenticated user (201)', async () => {
    mockedSession.mockResolvedValue(authedSession);
    mockedFindUnique.mockResolvedValue(r2Track);
    mockedQueueTrack.mockResolvedValue(undefined);

    const response = await POST(buildRequest({ trackId: 'r2-track-1' }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.queued).toMatchObject({ id: 'r2-track-1', sourceType: 's3', addedBy: 'Matheus' });
    expect(mockedQueueTrack).toHaveBeenCalledWith(
      'r2-track-1',
      'Matheus',
      false,
      'matheus@example.com'
    );
  });

  it('queues a playable track for a verified guest token (201)', async () => {
    mockedSession.mockResolvedValue(null);
    mockedGuestToken.mockResolvedValue({
      sub: 'guest-nightowl',
      name: 'Guest nightowl',
      isGuest: true,
    });
    mockedFindUnique.mockResolvedValue(r2Track);
    mockedQueueTrack.mockResolvedValue(undefined);

    const response = await POST(
      buildRequest(
        { trackId: 'r2-track-1' },
        [['X-Guest-Token', 'signed-guest-token']],
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.queued).toMatchObject({
      id: 'r2-track-1',
      addedBy: 'Guest nightowl',
    });
    expect(mockedGuestToken).toHaveBeenCalled();
    expect(mockedQueueTrack).toHaveBeenCalledWith(
      'r2-track-1',
      'Guest nightowl',
      false,
      'guest-nightowl',
    );
  });

  it('returns 401 when there is no authenticated session', async () => {
    mockedSession.mockResolvedValue(null);

    const response = await POST(buildRequest({ trackId: 'r2-track-1' }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.code).toBe('UNAUTHORIZED');
    expect(mockedQueueTrack).not.toHaveBeenCalled();
  });

  it('returns 400 when trackId is missing or invalid', async () => {
    mockedSession.mockResolvedValue(authedSession);

    const response = await POST(buildRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INVALID_TRACK_ID');
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedQueueTrack).not.toHaveBeenCalled();
  });

  it('returns 404 when the track does not exist', async () => {
    mockedSession.mockResolvedValue(authedSession);
    mockedFindUnique.mockResolvedValue(null);

    const response = await POST(buildRequest({ trackId: 'missing' }));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.code).toBe('TRACK_NOT_FOUND');
    expect(mockedQueueTrack).not.toHaveBeenCalled();
  });

  it('rejects a non-playable (youtube) source with 422', async () => {
    mockedSession.mockResolvedValue(authedSession);
    mockedFindUnique.mockResolvedValue(youtubeTrack);

    const response = await POST(buildRequest({ trackId: 'yt-track-1' }));
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.code).toBe('UNPLAYABLE_SOURCE');
    expect(data.sourceType).toBe('youtube');
    expect(mockedQueueTrack).not.toHaveBeenCalled();
  });

  // Invariante de design: o enfileiramento manual de YouTube é SEMPRE bloqueado
  // (isPlayableSourceType é config-independente), distinto da seleção automática
  // que pode incluir YouTube quando habilitado. Trava a assimetria documentada.
  it('blocks a youtube track even though manual enqueue uses the config-independent whitelist', async () => {
    mockedSession.mockResolvedValue(authedSession);
    mockedFindUnique.mockResolvedValue(youtubeTrack);

    const response = await POST(buildRequest({ trackId: 'yt-track-1' }));
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.code).toBe('UNPLAYABLE_SOURCE');
    expect(mockedQueueTrack).not.toHaveBeenCalled();
  });

  it('returns 400 when the JSON body is invalid', async () => {
    mockedSession.mockResolvedValue(authedSession);
    const badRequest: any = {
      json: jest.fn().mockRejectedValue(new SyntaxError('bad json')),
      headers: new Map(),
    };

    const response = await POST(badRequest);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('INVALID_BODY');
    expect(mockedFindUnique).not.toHaveBeenCalled();
    expect(mockedQueueTrack).not.toHaveBeenCalled();
  });

  it('returns 500 when queueTrack throws', async () => {
    mockedSession.mockResolvedValue(authedSession);
    mockedFindUnique.mockResolvedValue(r2Track);
    mockedQueueTrack.mockRejectedValue(new Error('redis down'));

    const response = await POST(buildRequest({ trackId: 'r2-track-1' }));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.code).toBe('QUEUE_ADD_FAILED');
  });

  it('derives a public label (não o email) when the session has no name', async () => {
    mockedSession.mockResolvedValue({ user: { email: 'noname@example.com' } });
    mockedFindUnique.mockResolvedValue(r2Track);
    mockedQueueTrack.mockResolvedValue(undefined);

    const response = await POST(buildRequest({ trackId: 'r2-track-1' }));
    const data = await response.json();

    expect(response.status).toBe(201);
    // O email cru nunca é exposto publicamente; usa-se um rótulo derivado.
    expect(data.queued.addedBy).toBe('Usuário Noname');
    expect(data.queued.addedBy).not.toContain('@');
    // O userId interno continua sendo o email (identidade estável).
    expect(mockedQueueTrack).toHaveBeenCalledWith(
      'r2-track-1',
      'Usuário Noname',
      false,
      'noname@example.com'
    );
  });
});
