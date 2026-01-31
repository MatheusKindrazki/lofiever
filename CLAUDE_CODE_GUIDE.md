# Claude Code Guide - Lofiever

## Quick Start

1. Install Claude Code: `npm i -g @anthropic-ai/claude-code`
2. Navigate to project: `cd <project-root>`
3. Start: `claude`
4. Try commands: `/test`, `/lint`, `/verify`

## Commands

| Command | Purpose |
|---------|---------|
| `/test` | Run Jest test suite with Prisma generation |
| `/lint` | Run ESLint + TypeScript type checking |
| `/verify` | Full validation: lint + typecheck + test + build |
| `/pr` | Create a pull request with generated description |
| `/setup` | Setup dev environment from scratch |

## Workflows

### New Feature
1. Enter Plan Mode (Shift+Tab 2x)
2. Describe feature requirements and acceptance criteria
3. Review and approve the plan
4. Claude implements with verification-first approach
5. Run `/verify` before committing

### Bug Fix
1. Describe the bug: "Investigate bug: [description]"
2. Claude follows the debug-workflow skill (reproduce, isolate, fix, validate)
3. Regression test is added automatically
4. Run `/verify` before committing

### Quick Fix (< 10 lines)
1. Describe the change directly
2. Claude implements and runs tests
3. Run `/verify` before committing

### Database Schema Change
1. Modify `prisma/schema.prisma`
2. Run `npm run db:migrate` to create migration
3. Run `npm run db:generate` to update Prisma client
4. Update any affected TypeScript types and queries

### Parallel Work
```bash
claude --worktree feature-player
claude --worktree feature-chat
claude --worktree fix-socket-sync
```

Use for independent features. Avoid for changes that touch the same files.

## Subagents

### Security Reviewer
Ask Claude: "Use the security-reviewer agent to audit [file/feature]"
- Checks auth, input validation, secrets, WebSocket security, dependencies

### Test Writer
Ask Claude: "Use the test-writer agent to write tests for [file/feature]"
- Generates Jest + RTL tests following project conventions

## Tips
- Use Plan Mode for changes touching more than 3 files
- Reference existing code: "similar to the pattern in src/lib/socket/server.ts"
- Always run `/verify` before committing
- After Prisma schema changes, always run `npx prisma generate`
- The custom server (`server/index.ts`) handles Socket.IO; Next.js handles HTTP
- Use `SKIP_ENV_VALIDATION=true` when building without full env vars

## Project Architecture

```
server/index.ts          -- Custom Node.js server (Socket.IO + Next.js)
src/app/                 -- Next.js App Router (pages + API routes)
src/components/          -- React components (feature directories)
src/lib/socket/          -- Socket.IO server and event handlers
src/lib/ai/              -- AI/LLM integration
src/stores/              -- Zustand state stores
prisma/schema.prisma     -- Database schema
```
