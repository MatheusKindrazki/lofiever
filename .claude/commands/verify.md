Full project validation before commit or PR.

## Steps
1. Generate Prisma client
2. Run ESLint
3. Run TypeScript type checking
4. Run test suite
5. Run Next.js build
6. Report final status (pass/fail per step)

## Implementation
```bash
npx prisma generate --no-hints
npm run lint
npm run typecheck
npm test
SKIP_ENV_VALIDATION=true npm run build
```

## Notes
- All steps must pass before committing
- If a step fails, stop and report -- do NOT skip to the next step
- Build uses SKIP_ENV_VALIDATION=true to avoid requiring all env vars
