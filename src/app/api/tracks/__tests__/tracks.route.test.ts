import { prisma } from '@/lib/prisma';

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

jest.mock('@/lib/prisma', () => ({
  prisma: {
    track: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock('@/services/playlist/source-policy', () => ({
  getSourceTypeFilter: jest.fn(() => ({
    sourceType: { in: ['r2', 's3', 'local'] },
  })),
}));

jest.mock('@/lib/api-utils', () => ({
  handleApiError: (error: unknown) => {
    throw error;
  },
}));

import { GET } from '../route';

const mockedFindMany = prisma.track.findMany as unknown as jest.Mock;
const mockedCount = prisma.track.count as unknown as jest.Mock;

describe('GET /api/tracks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindMany.mockResolvedValue([]);
    mockedCount.mockResolvedValue(0);
  });

  it('searches playable tracks by title, artist, or mood', async () => {
    const response = await GET(
      {
        url: 'http://localhost/api/tracks?search=Lo-Fi&limit=20&offset=0',
      } as Request,
    );

    expect(response.status).toBe(200);
    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { sourceType: { in: ['r2', 's3', 'local'] } },
            {
              OR: [
                { title: { contains: 'Lo-Fi', mode: 'insensitive' } },
                { artist: { contains: 'Lo-Fi', mode: 'insensitive' } },
                { mood: { contains: 'Lo-Fi', mode: 'insensitive' } },
              ],
            },
          ],
        },
      }),
    );
  });
});
