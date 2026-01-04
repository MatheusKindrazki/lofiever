# Security Audit Report - Lofiever

**Project**: Lofiever - 24/7 Lo-fi Radio Streaming Platform
**Audit Date**: 2026-01-04
**Auditor**: Principal Engineer Security Review
**Branch**: MatheusKindrazki/winnipeg
**Risk Level**: MEDIUM

---

## Executive Summary

This security audit examines the Lofiever codebase, a 24/7 lo-fi music streaming platform built with Next.js 15, React 19, Socket.IO, PostgreSQL, Redis, and OpenAI integration. The application serves real-time audio streaming with AI-powered curation and live chat functionality.

### Key Findings (10 Total)

| Severity | Count | Description |
|----------|-------|-------------|
| **CRITICAL** | 1 | Hardcoded fallback secrets in production code |
| **HIGH** | 3 | XSS vulnerability, unprotected admin route, weak API key defaults |
| **MEDIUM** | 3 | Missing CSRF protection, rate limit bypass, insecure defaults in Docker |
| **LOW** | 3 | Missing security headers, verbose error logging, no input length limits |

### Top 5 Risks (Immediate Attention Required)

1. [CRITICAL] Hardcoded fallback secrets that could be used in production
2. [HIGH] XSS vulnerability via `dangerouslySetInnerHTML` in ChatRoom component
3. [HIGH] Admin panel has no authentication/authorization
4. [HIGH] API_SECRET_KEY has weak default value
5. [MEDIUM] Missing CSRF protection on state-changing POST endpoints

---

## 60-Second Overview

- **Architecture**: Next.js 15 App Router + custom Socket.IO server, PostgreSQL, Redis, Icecast/Liquidsoap streaming
- **Authentication**: NextAuth.js with GitHub OAuth + custom guest JWT tokens
- **Real-time**: Socket.IO for chat and playback sync
- **AI Integration**: OpenAI GPT-4o-mini for DJ chatbot and content moderation
- **Storage**: Cloudflare R2 for audio files with presigned URLs
- **Critical Issues**: 1 hardcoded secret, 1 XSS vulnerability, unprotected admin route
- **Good Practices**: Rate limiting implemented, content moderation, Prisma ORM (no SQL injection)

---

## Detailed Findings

### 1. [CRITICAL] Hardcoded Fallback Secrets in Production Code

**Evidence**:
- `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/src/lib/auth/tokens.ts:6`
- `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/src/lib/api-security.ts:16`

**[FACT]** The codebase contains hardcoded fallback secrets:

```typescript
// src/lib/auth/tokens.ts:6
const SECRET = config.auth.secret || 'fallback-secret-do-not-use-in-prod';

// src/lib/api-security.ts:16
const API_SECRET = process.env.API_SECRET_KEY || 'change-me-in-production';
```

**Risk Assessment**:
- **Probability**: HIGH - If AUTH_SECRET or API_SECRET_KEY environment variables are not set, the app silently falls back to known values
- **Impact**: CRITICAL - Attackers could forge JWT tokens and bypass API authentication

**Mitigation**:
- Remove fallback values entirely
- Fail fast on startup if required secrets are missing
- Add environment variable validation at application start

---

### 2. [HIGH] XSS Vulnerability via dangerouslySetInnerHTML

**Evidence**: `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/src/components/ChatRoom.tsx:270`

**[FACT]** The ChatRoom component uses `dangerouslySetInnerHTML` with translation data:

```tsx
<span dangerouslySetInnerHTML={{ __html: t.raw('privateMode.warning') }} />
```

**Risk Assessment**:
- **Probability**: MEDIUM - Depends on whether translation files can be modified by attackers or if user input reaches translations
- **Impact**: HIGH - Could enable stored XSS attacks affecting all users

**Mitigation**:
- Replace `dangerouslySetInnerHTML` with safe text rendering
- If HTML is required, use a sanitization library like DOMPurify
- Review all translation files for potential injection points

---

### 3. [HIGH] Unprotected Admin Route

**Evidence**: `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/src/app/admin/page.tsx`

**[FACT]** The admin page at `/admin` has no authentication or authorization checks:
- No middleware protection
- No session validation
- Fetches sensitive moderation data from `/api/admin/moderation`
- Displays user track requests, usernames, and moderation statistics

**[INFERENCE]** Any user can access the admin dashboard and view all moderation data.

**Risk Assessment**:
- **Probability**: HIGH - Route is directly accessible
- **Impact**: HIGH - Information disclosure, potential for further attacks

**Mitigation**:
- Add authentication middleware for `/admin` routes
- Implement role-based access control (RBAC)
- Require admin role for `/api/admin/*` endpoints

---

### 4. [HIGH] Weak API Key Default and Query Parameter Exposure

**Evidence**: `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/src/lib/api-security.ts:80-86`

**[FACT]** API key verification accepts keys via query parameter:

```typescript
export function verifyAPIKey(request: NextRequest): boolean {
    const headerKey = request.headers.get('x-api-key');
    const { searchParams } = new URL(request.url);
    const queryKey = searchParams.get('api_key'); // Exposed in URL/logs

    return headerKey === API_SECRET || queryKey === API_SECRET;
}
```

**Risk Assessment**:
- **Probability**: MEDIUM - API keys in URLs are logged by proxies, browsers, and analytics
- **Impact**: HIGH - Credential exposure in logs and browser history

**Mitigation**:
- Remove query parameter option for API key
- Only accept API keys via headers
- Implement key rotation mechanism

---

### 5. [MEDIUM] Missing CSRF Protection

**Evidence**: Multiple POST endpoints without CSRF tokens:
- `/api/playlist` (POST creates new playlist)
- `/api/tracks` (POST creates new track)
- `/api/curation` (POST processes AI curation)
- `/api/auth/guest` (POST generates guest token)

**[FACT]** None of the state-changing endpoints implement CSRF protection. NextAuth provides some protection for its own routes, but custom API routes are unprotected.

**Risk Assessment**:
- **Probability**: MEDIUM - Requires user to visit malicious site while authenticated
- **Impact**: MEDIUM - Could add tracks, create playlists, or perform other actions as user

**Mitigation**:
- Implement CSRF tokens for all state-changing operations
- Use `SameSite=Strict` cookies
- Add CSRF middleware for API routes

---

### 6. [MEDIUM] Insecure Docker Compose Defaults

**Evidence**:
- `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/docker-compose.dev.yml:27-29`
- `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/docker-compose.yml:79-81`

**[FACT]** Docker Compose files use weak default passwords:

```yaml
# docker-compose.dev.yml
- ICECAST_SOURCE_PASSWORD=${ICECAST_SOURCE_PASSWORD:-hackme}
- ICECAST_ADMIN_PASSWORD=${ICECAST_ADMIN_PASSWORD:-hackme}

# docker-compose.yml (production!)
- ICECAST_SOURCE_PASSWORD=${ICECAST_SOURCE_PASSWORD:-hackme}
```

**Risk Assessment**:
- **Probability**: MEDIUM - If environment variables not set, defaults are used
- **Impact**: MEDIUM - Unauthorized access to Icecast streaming server

**Mitigation**:
- Remove default passwords from production docker-compose.yml
- Make passwords required with no defaults
- Add startup validation for required secrets

---

### 7. [MEDIUM] Rate Limit Fail-Open Behavior

**Evidence**: `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/src/lib/api-security.ts:144-148`

**[FACT]** When Redis is unavailable, rate limiting fails open (allows requests):

```typescript
} catch (error) {
    console.error('[Security] Rate limit check failed:', error);
    // Fail open - allow request if Redis is down
    return { allowed: true, remaining: config.max, resetAt: Date.now() + config.window * 1000 };
}
```

**Risk Assessment**:
- **Probability**: LOW - Redis is typically reliable
- **Impact**: MEDIUM - DDoS or abuse possible when Redis is down

**Mitigation**:
- Consider fail-closed behavior for security-critical endpoints
- Implement fallback rate limiting (in-memory)
- Add monitoring and alerts for Redis connection issues

---

### 8. [LOW] Missing Security Headers

**Evidence**: No `next.config.ts` security headers configuration found.

**[FACT]** The application does not configure security headers such as:
- Content-Security-Policy (CSP)
- X-Content-Type-Options
- X-Frame-Options
- Strict-Transport-Security (HSTS)
- X-XSS-Protection

**Mitigation**:
- Add security headers in `next.config.ts` or middleware
- Implement strict CSP to prevent XSS
- Enable HSTS for production

---

### 9. [LOW] Verbose Error Logging

**Evidence**: Multiple locations expose internal errors:
- `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/src/lib/auth/tokens.ts:39`
- Various API routes

**[FACT]** Error details are logged to console which may leak to production logs:

```typescript
} catch (error) {
    console.error('Token verification failed:', error);
    return null;
}
```

**Mitigation**:
- Implement structured logging with log levels
- Sanitize error messages before logging
- Avoid logging sensitive data (tokens, secrets)

---

### 10. [LOW] Missing Input Validation/Length Limits

**Evidence**:
- `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/src/app/api/auth/guest/route.ts:11`
- Chat messages via Socket.IO

**[FACT]** Some user inputs lack length or format validation:

```typescript
// Guest username - no max length
const requestedUsername = body.username;
const username = requestedUsername || `Guest ${userId.substring(6)}`;
```

**Mitigation**:
- Add maximum length limits for all string inputs
- Implement input validation schemas (Zod is already used in some places)
- Sanitize usernames for display

---

## Positive Security Practices Observed

### [FACT] No SQL Injection Risk

Prisma ORM is used throughout with parameterized queries:
```typescript
// Example from src/services/moderation/moderation.service.ts
const track = await prisma.track.findFirst({
    where: {
        OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { artist: { contains: query, mode: 'insensitive' } },
        ],
    },
});
```

### [FACT] Content Moderation Implemented

AI-powered content moderation for chat messages:
- `/Users/matheuskindrazki/conductor/workspaces/lofiever/winnipeg/src/services/moderation/content-moderation.service.ts`
- Checks for hate speech, harassment, explicit content, spam

### [FACT] Rate Limiting Implemented

Rate limiting is implemented for users:
- 5 requests per hour
- 20 requests per day
- 2-minute cooldown between requests

### [FACT] Presigned URLs for R2 Storage

Audio files use presigned URLs with expiration:
```typescript
const signedUrl = await getSignedUrl(R2, command, { expiresIn }); // 1 hour default
```

### [FACT] Environment Variables Documented

`ENV_VARIABLES.md` provides clear documentation and security guidance.

### [FACT] .env Files Properly Gitignored

`.gitignore` excludes all environment files:
```
# env files (can opt-in for committing if needed)
.env*
```

---

## Risk Matrix Summary

| # | Risk | Probability | Impact | Priority |
|---|------|-------------|--------|----------|
| 1 | Hardcoded fallback secrets | HIGH | CRITICAL | P0 |
| 2 | XSS via dangerouslySetInnerHTML | MEDIUM | HIGH | P1 |
| 3 | Unprotected admin route | HIGH | HIGH | P1 |
| 4 | API key in query params | MEDIUM | HIGH | P1 |
| 5 | Missing CSRF protection | MEDIUM | MEDIUM | P2 |
| 6 | Insecure Docker defaults | MEDIUM | MEDIUM | P2 |
| 7 | Rate limit fail-open | LOW | MEDIUM | P3 |
| 8 | Missing security headers | LOW | MEDIUM | P3 |
| 9 | Verbose error logging | LOW | LOW | P4 |
| 10 | Missing input validation | LOW | LOW | P4 |

---

## Recommended Remediation Timeline

### Immediate (0-7 days) - P0/P1

1. **Remove hardcoded fallback secrets**
   - Update `src/lib/auth/tokens.ts` - fail if AUTH_SECRET not set
   - Update `src/lib/api-security.ts` - fail if API_SECRET_KEY not set

2. **Fix XSS vulnerability**
   - Remove `dangerouslySetInnerHTML` from ChatRoom.tsx
   - Use safe text rendering or DOMPurify

3. **Protect admin route**
   - Add authentication middleware for `/admin`
   - Add authorization check to `/api/admin/moderation`

4. **Remove API key from query params**
   - Update `verifyAPIKey` to only accept header-based keys

### Short-term (7-30 days) - P2

5. **Implement CSRF protection**
   - Add CSRF tokens to all state-changing endpoints
   - Configure SameSite cookie attribute

6. **Secure Docker defaults**
   - Remove default passwords from production docker-compose.yml
   - Add validation for required environment variables

### Medium-term (30-60 days) - P3/P4

7. **Add security headers**
   - Implement CSP, HSTS, X-Frame-Options
   - Configure in next.config.ts

8. **Improve error handling**
   - Implement structured logging
   - Add log level filtering

9. **Add input validation**
   - Add length limits to all user inputs
   - Expand Zod schema usage

10. **Consider rate limit fail-closed**
    - Implement fallback in-memory rate limiting

---

## Security Checklist

- [ ] **Secrets Management**: Remove all hardcoded secrets
- [ ] **XSS Prevention**: Sanitize all user-generated content
- [ ] **Authentication**: Protect all admin routes
- [ ] **Authorization**: Implement RBAC for sensitive operations
- [ ] **CSRF Protection**: Add tokens to state-changing endpoints
- [ ] **Security Headers**: Configure CSP, HSTS, etc.
- [ ] **Input Validation**: Validate and sanitize all inputs
- [ ] **Error Handling**: Avoid leaking sensitive information
- [ ] **Dependencies**: Keep dependencies updated
- [ ] **Secrets Rotation**: Implement key rotation mechanism

---

## Dependencies Analysis

### Key Dependencies (Security Relevant)

| Package | Version | Notes |
|---------|---------|-------|
| next | 15.3.0 | Latest, good |
| next-auth | 4.24.11 | Check for updates |
| @prisma/client | 6.6.0 | Latest, parameterized queries |
| ioredis | 5.6.1 | Latest |
| socket.io | 4.8.1 | Latest |
| ai (Vercel AI SDK) | 5.0.98 | Latest |

**[RECOMMENDATION]** Run `npm audit` or `pnpm audit` regularly to check for known vulnerabilities.

---

## Conclusion

The Lofiever codebase demonstrates several good security practices including parameterized database queries, content moderation, and rate limiting. However, there are critical issues that require immediate attention, particularly the hardcoded fallback secrets and the XSS vulnerability.

The overall security posture is **MEDIUM** risk, with most issues being addressable within a 30-day remediation window. The critical issues (P0/P1) should be addressed before any production deployment.

---

*Report generated by Principal Engineer Security Review*
*Date: 2026-01-04*
