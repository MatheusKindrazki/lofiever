import { getToken } from 'next-auth/jwt';
import { encode, decode } from 'next-auth/jwt';
import { config } from '@/lib/config';
import { NextRequest } from 'next/server';

/**
 * Get the auth secret, throwing an error if not configured.
 * Uses lazy evaluation to allow build-time compilation.
 */
function getSecret(): string {
    const secret = config.auth.secret;
    if (!secret) {
        throw new Error('AUTH_SECRET environment variable is required. Generate with: openssl rand -base64 32');
    }
    return secret;
}

export interface TokenPayload {
    sub?: string;
    name?: string;
    email?: string;
    isGuest?: boolean;
    iat?: number;
    exp?: number;
}

export async function generateGuestToken(userId: string, username: string): Promise<string> {
    // Create a JWT for a guest user
    // We use next-auth's encode function to keep it compatible with how next-auth handles tokens
    return encode({
        token: {
            sub: userId,
            name: username,
            isGuest: true,
        },
        secret: getSecret(),
        maxAge: 24 * 60 * 60, // 24 hours
    });
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
    try {
        const decoded = await decode({
            token,
            secret: getSecret(),
        });
        return decoded as TokenPayload;
    } catch (error) {
        console.error('Token verification failed:', error);
        return null;
    }
}

export async function getSessionOrGuestToken(req: NextRequest): Promise<TokenPayload | null> {
    // Try to get the standard NextAuth session token
    const token = await getToken({ req, secret: getSecret() });
    if (token) {
        return token as TokenPayload;
    }

    // If no session, check for a custom Guest-Token header or query param
    const guestToken = req.headers.get('X-Guest-Token') || req.nextUrl.searchParams.get('guest_token');
    if (guestToken) {
        return verifyToken(guestToken);
    }

    return null;
}
