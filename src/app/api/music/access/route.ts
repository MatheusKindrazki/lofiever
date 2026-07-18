import { getServerSession } from 'next-auth';
import type { Session } from 'next-auth';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth/options';
import { RATE_LIMITS, validateRequest } from '@/lib/api-security';
import { MusicGenerationService } from '@/services/music-generation/service';

export const runtime = 'nodejs';

function sessionIdentity(session: Session | null): {
  userId?: string;
  username?: string;
} {
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return {};
  return {
    userId: email,
    username: session?.user?.name?.trim() || email.split('@')[0],
  };
}

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const { userId } = sessionIdentity(session);
  const access = await MusicGenerationService.getAccess(userId);
  return NextResponse.json(access);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const securityError = await validateRequest(request, {
    rateLimit: RATE_LIMITS.api,
  });
  if (securityError) return securityError;

  const session = await getServerSession(authOptions);
  const { userId, username } = sessionIdentity(session);
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
