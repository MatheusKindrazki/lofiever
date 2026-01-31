Run project test suite.

## Steps
1. Generate Prisma client if needed
2. Execute Jest test suite
3. Report results with coverage summary
4. Highlight failures with context and suggestions

## Implementation
```bash
npx prisma generate --no-hints 2>/dev/null
npm test
```

## On Failure
- Read failing test file and related source code
- Identify root cause
- Suggest fix with code snippet
