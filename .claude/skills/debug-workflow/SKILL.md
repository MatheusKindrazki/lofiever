# Debug Workflow

Systematic approach to debugging issues in the Lofiever codebase.

## When to Use
- Bug reports from users
- Failing tests without obvious cause
- Socket.IO connection or sync issues
- Prisma/database query problems
- AI/LLM response issues
- Audio streaming failures

## Workflow

### 1. Reproduce
- [ ] Identify the affected area (frontend, server, socket, database, AI)
- [ ] Create minimal reproduction steps
- [ ] Document expected vs actual behavior
- [ ] Check if issue is environment-specific (Docker services running?)

### 2. Isolate
- [ ] Check recent commits in related files: `git log --oneline -10 -- <path>`
- [ ] For Socket.IO issues: check `src/lib/socket/server.ts` and event handlers
- [ ] For Prisma issues: check schema and generated client (`npx prisma generate`)
- [ ] For API issues: check route handlers in `src/app/api/`
- [ ] For state issues: check Zustand stores in `src/stores/`
- [ ] Add targeted logging to narrow down the issue

### 3. Fix
- [ ] Implement minimal fix in the identified area
- [ ] Add regression test covering the bug
- [ ] Verify fix locally with `npm test`

### 4. Validate
- [ ] Run `/verify` (full validation)
- [ ] Test Socket.IO sync if realtime features are affected
- [ ] Check for side effects in related components
- [ ] Update docs if behavior changed
