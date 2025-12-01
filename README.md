# Lofiever - 24/7 Lo-fi Radio Stream

A 24/7 lo-fi music streaming platform with real-time synchronization, AI-powered curation, live chat, and an immersive Zen Mode experience.

## Features

- **24/7 Live Radio Stream** - Continuous lo-fi music streaming via Icecast + Liquidsoap
- **Real-time Synchronization** - All listeners hear the same music at the same time
- **AI DJ Curation** - OpenAI-powered music recommendations and chat moderation
- **Live Chat** - Real-time chat with AI moderation
- **Zen Mode** - Fullscreen immersive experience with animated backgrounds and audio visualizer
- **Multi-language Support** - English and Portuguese (next-intl)
- **Dynamic Playlists** - AI-curated playlists that evolve continuously

## Quick Start

### 1. Start all services

```bash
npm run setup
```

This will:
- Start all Docker containers (Icecast, Liquidsoap, PostgreSQL, Redis)
- Verify all services are running
- Display stream status and available URLs

### 2. Start the application

```bash
# Development (both frontend and backend)
npm run dev

# Or separately:
npm run dev:next    # Frontend only
npm run dev:server  # Backend only
```

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| State Management | Zustand, React Query |
| Real-time | Socket.IO |
| Database | PostgreSQL + Prisma ORM |
| Cache | Redis |
| Streaming | Icecast + Liquidsoap |
| AI | OpenAI API |
| Storage | AWS S3 / Cloudflare R2 |

### Services (Docker)

- **Icecast** - Audio streaming server (port 8000)
- **Liquidsoap** - Audio processing and playlist engine
- **PostgreSQL** - Primary database (port 5432)
- **Redis** - Cache and real-time data (port 6379)

## Project Structure

```
lofiever/
├── src/
│   ├── app/              # Next.js App Router
│   │   └── api/          # API routes
│   ├── components/       # React components
│   ├── lib/              # Core libraries
│   │   └── socket/       # Socket.IO client/server
│   ├── services/         # Business logic
│   └── types/            # TypeScript definitions
├── server/               # Custom Node.js server (Socket.IO)
├── streaming/            # Icecast + Liquidsoap configs
├── prisma/               # Database schema and migrations
├── messages/             # i18n translations
├── i18n/                 # Internationalization config
└── public/music/         # Music library
```

## Available Scripts

### Development

```bash
npm run dev          # Full dev server (Socket.IO + Next.js)
npm run dev:next     # Next.js only (with Turbopack)
npm run dev:server   # Socket.IO server only
npm run build        # Production build
npm run start        # Production server
npm run lint         # ESLint check
```

### Docker

```bash
npm run docker:up       # Start containers
npm run docker:down     # Stop containers
npm run docker:logs     # View logs
npm run docker:restart  # Restart containers
```

### Database

```bash
npm run db:seed         # Seed database
npm run db:migrate      # Run migrations
npm run db:generate     # Generate Prisma client
```

### Stream Monitoring

```bash
npm run stream:test     # Check stream status (JSON)
npm run stream:monitor  # Monitor stream
npm run stream:watch    # Continuous monitoring (5s interval)
```

### Utilities

```bash
npm run test:redis       # Test Redis connection
npm run chat:clear       # Clear chat messages
npm run session:clear    # Clear sessions
npm run listeners:reset  # Reset listener count
npm run playlist:reset   # Reset playlist
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lofiever"

# Redis
REDIS_URL="redis://localhost:6379"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret"

# OpenAI (AI DJ)
OPENAI_API_KEY="sk-your-key"

# AWS S3 (music storage)
AWS_ACCESS_KEY_ID="your-key"
AWS_SECRET_ACCESS_KEY="your-secret"
AWS_REGION="us-east-1"
AWS_S3_BUCKET="your-bucket"

# Icecast
ICECAST_SOURCE_PASSWORD="your-password"
ICECAST_ADMIN_PASSWORD="your-password"
```

See [ENV_VARIABLES.md](./ENV_VARIABLES.md) for complete documentation.

## Available Endpoints

| URL | Description |
|-----|-------------|
| http://localhost:3000 | Web application |
| http://localhost:8000/stream | Audio stream |
| http://localhost:8000/admin/ | Icecast admin panel |

## Docker Deployment (Coolify)

The project includes production-ready Docker configuration:

- `Dockerfile` - Multi-stage build for Next.js with custom server
- `docker-compose.yml` - Production configuration for Coolify
- `docker-compose.dev.yml` - Local development configuration

### Deploy to Coolify

1. Create a new service in Coolify
2. Connect your Git repository
3. Configure environment variables
4. Deploy using docker-compose

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/stream` | GET | Current stream data |
| `/api/playlist` | GET | Active playlist |
| `/api/tracks` | GET | Available tracks |
| `/api/stats` | GET | Stream statistics |
| `/api/curation/process-message` | POST | AI chat processing |
| `/api/next-track` | GET | Get next track (Liquidsoap) |

## Testing the Stream

### Browser
Open http://localhost:8000/stream in any audio player

### VLC
```bash
vlc http://localhost:8000/stream
```

### cURL
```bash
curl -I http://localhost:8000/stream
```

## Troubleshooting

### Stream not working

```bash
# Check containers
docker-compose ps

# View logs
npm run docker:logs

# Restart everything
npm run docker:restart
npm run setup
```

### Port conflicts

Ensure these ports are available:
- 8000 (Icecast)
- 5432 (PostgreSQL)
- 6379 (Redis)
- 3000 (Next.js)

### Detailed logs

```bash
# Liquidsoap logs
docker-compose logs liquidsoap

# Icecast logs
docker-compose logs icecast
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

This project is under the MIT License. See the LICENSE file for details.

---

**Author**: Matheus Kindrazki
**Version**: 0.1.0
