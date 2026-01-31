# Lofiever - 24/7 AI Lofi Radio

## Stack
- **Frontend**: Next.js 15.3 (App Router, Turbopack) + React 19 + TypeScript 5.x
- **Styling**: Tailwind CSS 4 + CVA (class-variance-authority) + clsx/tailwind-merge
- **State**: Zustand (client) + TanStack React Query (server)
- **Backend**: Custom Node.js server (`server/index.ts`) + Next.js API routes
- **Realtime**: Socket.IO (server + client) + Redis adapter
- **Database**: PostgreSQL + Prisma ORM 6.x
- **AI**: Vercel AI SDK + OpenAI
- **Auth**: NextAuth 4.x
- **i18n**: next-intl
- **Storage**: AWS S3 / Cloudflare R2
- **Testing**: Jest 29 + React Testing Library + ts-jest

## Commands

```bash
# Dev (full server with Socket.IO + Next.js)
npm run dev

# Dev (Next.js only, with Turbopack)
npm run dev:next

# Test
npm test
npm run test:watch
npm run test:coverage

# Lint & Typecheck
npm run lint
npm run typecheck

# Build
npm run build              # Next.js
npm run build:server       # esbuild server bundle

# Database
npm run db:generate        # Prisma generate (run after schema changes)
npm run db:migrate         # Prisma migrate dev
npm run db:seed            # Seed database

# Docker (Postgres + Redis + Icecast)
npm run docker:up
npm run docker:down
```

## Code Style
- **Type imports**: Always use `import type { X }` (ESLint enforced)
- **No import side effects**: `@typescript-eslint/no-import-type-side-effects`
- **Unused vars**: Prefix with `_` to ignore (e.g., `_unused`)
- **Explicit any**: Avoid `any`, use `unknown` when needed (warn level)
- **Components**: Named exports, `'use client'` directive when using hooks/browser APIs
- **Path aliases**: `@/*` maps to `./src/*` (also `@/components/*`, `@/lib/*`, `@/utils/*`, `@/services/*`, `@/types/*`)
- **State pattern**: Zustand stores with `actions` namespace, React Query for server data
- **Strict mode**: `noUnusedLocals`, `noUnusedParameters`, `strict: true`

## Workflow
- Plan Mode for: refactors > 3 files, new features, architecture changes
- Always run `/verify` before commit
- Run `npx prisma generate` after schema changes (before typecheck/test/build)
- Custom server at `server/index.ts` handles Socket.IO -- Next.js handles HTTP routes

## Conventions
- Commits: Conventional Commits -- `<type>(<scope>): <subject>`
- Types: feat, fix, docs, style, refactor, perf, test, chore, ci
- Breaking changes: `!` suffix or `BREAKING CHANGE:` footer
- PRs: same title format, structured body (Summary, Changes, Test Plan)
- Components: feature directories with co-located tests
- Hooks: `src/hooks/` with `use` prefix

## Architecture
- **Synchronized playback**: All users hear the same track at the same time
- **Socket.IO server**: `src/lib/socket/server.ts` -- handles realtime events
- **Prisma schema**: `prisma/schema.prisma` -- Track, Playlist, Chat, Feedback, Moderation
- **AI curation**: LLM-powered playlist generation and chat interaction
- **Track sources**: Spotify, YouTube, local, S3/R2

## Docs
- @.cursor/rules/project-overview.mdc - Project overview
- @.cursor/rules/frontend-standards.mdc - Frontend standards
- @.cursor/rules/componentes.mdc - Component patterns
- @.cursor/rules/api-patterns.mdc - API patterns
- @.cursor/rules/styling-guidelines.mdc - Styling guidelines

<!-- Last updated: 2026-01-31 -->
