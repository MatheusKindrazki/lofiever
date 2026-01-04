/**
 * Simple API Security (No Edge Runtime dependencies)
 * 
 * Provides basic security functions for API routes without causing
 * compatibility issues with Next.js custom server setup.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { redis } from './redis';

// ============================================================================
// CONFIGURATION
// ============================================================================

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';

/**
 * Get the API secret, throwing an error if not configured.
 * Uses lazy evaluation to allow build-time compilation.
 */
function getApiSecret(): string {
    const secret = process.env.API_SECRET_KEY;
    if (!secret) {
        throw new Error('API_SECRET_KEY environment variable is required. Generate with: openssl rand -base64 32');
    }
    return secret;
}

// Rate limit configurations (requests per minute)
export const RATE_LIMITS = {
    stream: { window: 60, max: 60 },      // 60 requests/minute for stream
    api: { window: 60, max: 100 },        // 100 requests/minute for general API
    upload: { window: 60, max: 10 },      // 10 requests/minute for uploads
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get client identifier for rate limiting (IP address)
 */
function getClientIP(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const realIP = request.headers.get('x-real-ip');

    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }

    if (realIP) {
        return realIP;
    }

    // Fallback to a default for local development
    return '127.0.0.1';
}

/**
 * Check if origin is allowed
 */
export function isOriginAllowed(request: NextRequest): boolean {
    // In development, allow all origins
    if (process.env.NODE_ENV === 'development') {
        return true;
    }

    const origin = request.headers.get('origin');
    const referer = request.headers.get('referer');

    // If no origin/referer (e.g., server-to-server), allow
    if (!origin && !referer) {
        return true;
    }

    // Check against allowed origins
    for (const allowed of ALLOWED_ORIGINS) {
        if (origin?.startsWith(allowed) || referer?.startsWith(allowed)) {
            return true;
        }
    }

    return false;
}

/**
 * Verify API key from header or query
 */
export function verifyAPIKey(request: NextRequest): boolean {
    const headerKey = request.headers.get('x-api-key');
    // Security: Only accept API key via header, never via query params
    // Query params are logged and can leak in browser history/referrer
    if (!headerKey) {
        console.warn('[Security] API key must be provided via x-api-key header');
        return false;
    }
    return headerKey === getApiSecret();
}

// ============================================================================
// RATE LIMITING
// ============================================================================

interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
}

/**
 * Simple rate limiting using Redis
 */
export async function checkRateLimit(
    request: NextRequest,
    config: { window: number; max: number } = RATE_LIMITS.api
): Promise<RateLimitResult> {
    if (!RATE_LIMIT_ENABLED) {
        return { allowed: true, remaining: config.max, resetAt: Date.now() + config.window * 1000 };
    }

    try {
        const clientIP = getClientIP(request);
        const pathname: string = request.nextUrl.pathname;
        const key = `rate_limit:${clientIP}:${pathname}`;

        const now = Date.now();
        const windowStart = now - (config.window * 1000);

        // Remove old entries
        await redis.zremrangebyscore(key, 0, windowStart);

        // Count current requests
        const count = await redis.zcard(key);

        if (count >= config.max) {
            // Get oldest entry to calculate reset time
            const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
            const resetAt = oldest[1] ? parseInt(oldest[1] as string) + (config.window * 1000) : now + (config.window * 1000);

            return {
                allowed: false,
                remaining: 0,
                resetAt,
            };
        }

        // Add current request
        await redis.zadd(key, now, `${now}:${Math.random()} `);
        await redis.expire(key, config.window);

        return {
            allowed: true,
            remaining: config.max - count - 1,
            resetAt: now + (config.window * 1000),
        };
    } catch (error) {
        console.error('[Security] Rate limit check failed - denying request:', error);
        // Fail closed - deny request if Redis is down (more secure)
        return { allowed: false, remaining: 0, resetAt: Date.now() + config.window * 1000 };
    }
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

export function unauthorizedResponse(message = 'Unauthorized'): NextResponse {
    return NextResponse.json(
        { error: message, code: 'UNAUTHORIZED' },
        { status: 401 }
    );
}

export function forbiddenResponse(message = 'Forbidden'): NextResponse {
    return NextResponse.json(
        { error: message, code: 'FORBIDDEN' },
        { status: 403 }
    );
}

export function rateLimitResponse(resetAt: number): NextResponse {
    const resetDate = new Date(resetAt);
    return NextResponse.json(
        {
            error: 'Too many requests',
            code: 'RATE_LIMIT_EXCEEDED',
            resetAt: resetDate.toISOString(),
        },
        {
            status: 429,
            headers: {
                'Retry-After': Math.ceil((resetAt - Date.now()) / 1000).toString(),
                'X-RateLimit-Reset': resetDate.toISOString(),
            }
        }
    );
}

// ============================================================================
// ROUTE PROTECTION WRAPPERS
// ============================================================================

/**
 * Validate request security (Origin + Rate Limit + API Key)
 * Returns null if valid, or a NextResponse with error if invalid.
 */
export async function validateRequest(
    request: NextRequest,
    options: {
        rateLimit?: { window: number; max: number };
        requireAPIKey?: boolean;
    } = {}
): Promise<NextResponse | null> {
    // 1. Check origin
    if (!isOriginAllowed(request)) {
        console.warn(`[Security] Blocked request from invalid origin: ${request.headers.get('origin')} `);
        return forbiddenResponse('Origin not allowed');
    }

    // 2. Check rate limit
    if (options.rateLimit) {
        const rateLimit = await checkRateLimit(request, options.rateLimit);
        if (!rateLimit.allowed) {
            console.warn(`[Security] Rate limit exceeded for ${getClientIP(request)}`);
            return rateLimitResponse(rateLimit.resetAt);
        }
    }

    // 3. Check API key if required
    if (options.requireAPIKey && !verifyAPIKey(request)) {
        console.warn(`[Security] Invalid API key from ${getClientIP(request)} `);
        return unauthorizedResponse('Invalid API key');
    }

    return null;
}

