import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/api-security';
import { redis } from '@/lib/redis';

jest.mock('next/server', () => ({
  NextResponse: { json: jest.fn() },
}));

jest.mock('@/lib/redis', () => ({
  redis: {
    zremrangebyscore: jest.fn(),
    zcard: jest.fn(),
    zrange: jest.fn(),
    zadd: jest.fn(),
    expire: jest.fn(),
  },
}));

const redisMock = redis as unknown as {
  zremrangebyscore: jest.Mock;
  zcard: jest.Mock;
  zrange: jest.Mock;
  zadd: jest.Mock;
  expire: jest.Mock;
};

const requestFor = (method: 'GET' | 'POST'): NextRequest => ({
  method,
  headers: new Headers({ 'x-forwarded-for': '203.0.113.10' }),
  nextUrl: { pathname: '/api/playlist/queue' },
}) as NextRequest;

describe('checkRateLimit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisMock.zcard.mockResolvedValue(0);
  });

  it('keeps read polling and queue mutations in separate buckets', async () => {
    await checkRateLimit(requestFor('GET'));
    await checkRateLimit(requestFor('POST'));

    expect(redisMock.zremrangebyscore).toHaveBeenNthCalledWith(
      1,
      'rate_limit:203.0.113.10:GET:/api/playlist/queue',
      0,
      expect.any(Number),
    );
    expect(redisMock.zremrangebyscore).toHaveBeenNthCalledWith(
      2,
      'rate_limit:203.0.113.10:POST:/api/playlist/queue',
      0,
      expect.any(Number),
    );
  });
});
