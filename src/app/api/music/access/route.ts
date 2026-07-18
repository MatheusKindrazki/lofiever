import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { RATE_LIMITS, validateRequest } from '@/lib/api-security';
import { getSessionOrGuestToken } from '@/lib/auth/tokens';
import type { TokenPayload } from '@/lib/auth/tokens';
import { MusicGenerationService } from '@/services/music-generation/service';

export const runtime = 'nodejs';

function tokenIdentity(token: TokenPayload | null): {
  userId?: string;
  username?: string;
} {
  const email = token?.email?.trim().toLowerCase();
  const userId = email || token?.sub?.trim();
  if (!userId) return {};
  return {
    userId,
    username: token?.name?.trim() || (email ? email.split('@')[0] : `user_${userId.slice(-6)}`),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = await getSessionOrGuestToken(request);
  const { userId } = tokenIdentity(token);
  const access = await MusicGenerationService.getAccess(userId);
  return NextResponse.json(access);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const securityError = await validateRequest(request, {
    rateLimit: RATE_LIMITS.api,
  });
  if (securityError) return securityError;

  const token = await getSessionOrGuestToken(request);
  const { userId, username } = tokenIdentity(token);
  if (!userId || !username) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 },
    );
  }

  let body: { confirmed?: unknown };
  try {
    body = await request.json() as { confirmed?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
  }

  if (body.confirmed !== true) {
    return NextResponse.json(
      { error: 'Adult confirmation is required', code: 'CONFIRMATION_REQUIRED' },
      { status: 400 },
    );
  }

  await MusicGenerationService.confirmAdult(userId, username);
  const access = await MusicGenerationService.getAccess(userId);
  return NextResponse.json(access, { status: 201 });
}
