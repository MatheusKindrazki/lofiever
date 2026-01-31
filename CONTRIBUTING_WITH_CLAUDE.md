# Contributing with Claude Code

## Initial Setup

1. Clone the repository
2. Start Claude: `claude`
3. Run `/setup` to install deps, start Docker, migrate DB, and seed data
4. Verify with `/verify`

## Development Workflow

### 1. Create a Branch
```bash
git checkout -b type/description
```
Use branch naming: `feat/player-controls`, `fix/socket-sync`, `chore/update-deps`

### 2. Plan (for non-trivial changes)
- Enter Plan Mode (Shift+Tab 2x)
- Describe what you want to achieve
- Review the plan before implementation

### 3. Implement
- Claude follows verification-first approach: test -> code -> verify
- All code must have TypeScript types (no `any`)
- Use `import type` for type-only imports
- Components use named exports and `'use client'` when needed

### 4. Validate
```bash
/verify
```
This runs: lint -> typecheck -> test -> build. All must pass.

### 5. Commit
Follow Conventional Commits:
```
feat(chat): add emoji reactions to messages
fix(player): resolve sync drift on reconnect
chore(deps): update prisma to 6.7
```

### 6. Create PR
```bash
/pr
```
Claude generates title and description from your commits.

## Code Standards

### TypeScript
- Strict mode enabled (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)
- Use `import type { X }` for type imports
- Prefix unused variables with `_`
- Path aliases: `@/components/`, `@/lib/`, `@/utils/`, `@/types/`

### Components
- Feature directories: `src/components/player/Player/Player.tsx`
- Co-located tests: `Player.test.tsx` next to `Player.tsx`
- State: Zustand for client state, React Query for server state

### API Routes
- Use Zod for request validation
- Handle errors consistently
- Prisma for all database access (no raw SQL)

### Socket.IO
- Events defined in `src/lib/socket/`
- Validate all incoming event payloads
- Clean up listeners on disconnect

## Testing

- **Unit tests**: Jest + ts-jest for utilities and services
- **Component tests**: React Testing Library for UI components
- **Coverage target**: 50% minimum (branches, functions, lines, statements)
- **Run tests**: `npm test` or `/test`
- **Watch mode**: `npm run test:watch`

## Common Tasks

| Task | Command |
|------|---------|
| Run dev server | `npm run dev` |
| Run tests | `/test` or `npm test` |
| Check quality | `/lint` |
| Full validation | `/verify` |
| DB migration | `npm run db:migrate` |
| Regenerate Prisma | `npm run db:generate` |
| Seed database | `npm run db:seed` |
| Start Docker | `npm run docker:up` |
| Create PR | `/pr` |

## Troubleshooting

### "Prisma client is out of date"
```bash
npx prisma generate
```

### "Tests failing after schema change"
```bash
npx prisma generate
npm test
```

### "Build fails with env validation"
```bash
SKIP_ENV_VALIDATION=true npm run build
```

### "Docker services not running"
```bash
npm run docker:up
npm run docker:logs  # check for errors
```

### "Socket.IO not connecting"
- Ensure `npm run dev` (not `npm run dev:next`) -- the custom server handles Socket.IO
- Check Redis is running: `npm run docker:logs`
