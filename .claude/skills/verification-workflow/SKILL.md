# Verification-First Development

Write Test -> Write Code -> Verify -> Refactor

## Workflow

### 1. Write Test First
Create a failing test that defines expected behavior.

- Tests go next to the source file or in `__tests__/` directory
- Use Jest + React Testing Library for component tests
- Use Jest for unit tests on utilities and services
- Follow naming: `<filename>.test.ts` or `<filename>.test.tsx`

```bash
# Run single test file during development
npx jest --watch <test-file>
```

### 2. Implement
Write minimal code to make the test pass.

- Follow existing patterns in the codebase
- Use TypeScript types strictly (no `any`)
- Use `import type` for type-only imports
- Components: named exports + `'use client'` when needed

### 3. Verify
```bash
/test     # Tests pass
/lint     # No lint or type errors
/verify   # Full validation including build
```

### 4. Refactor (if needed)
Improve code while keeping tests green.

## Checklist Before Commit
- [ ] All tests pass (`npm test`)
- [ ] Linter passes (`npm run lint`)
- [ ] Types pass (`npm run typecheck`)
- [ ] Build succeeds (`npm run build`)
- [ ] Prisma client is up to date if schema changed
- [ ] Feature works (manual test if applicable)
