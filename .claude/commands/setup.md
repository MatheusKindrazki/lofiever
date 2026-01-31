Setup development environment from scratch.

## Steps
1. Install npm dependencies
2. Start Docker services (Postgres, Redis, Icecast)
3. Generate Prisma client
4. Run database migrations
5. Seed database with initial data
6. Verify setup with a quick test run

## Implementation
```bash
npm install
npm run docker:up
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm test -- --passWithNoTests
```

## Prerequisites
- Node.js 20+
- Docker and Docker Compose
- `.env` file configured (copy from `.env.example` if available)

## Verification
After setup, run `/verify` to confirm everything works.
