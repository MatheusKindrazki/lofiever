Check code quality and type safety.

## Steps
1. Run ESLint to check for code quality issues
2. Run TypeScript compiler for type checking
3. Report all issues grouped by severity

## Implementation
```bash
npm run lint
npm run typecheck
```

## On Failure
- For ESLint errors: suggest auto-fixable vs manual fixes
- For TypeScript errors: show the exact type mismatch and suggest fix
- Prioritize: errors first, then warnings
