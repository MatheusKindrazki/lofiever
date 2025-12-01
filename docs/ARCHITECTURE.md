# Lofiever - Architecture Overview

## System Overview

**Lofiever** is a 24/7 lo-fi music streaming application with AI curation. The project implements a modern full-stack architecture using Next.js, with real-time features for playback synchronization, live chat, and playlist voting.

## Architecture Diagram

```
                                  +-------------------+
                                  |                   |
                                  |  Next.js App      |
                                  |  (App Router)     |
                                  |                   |
                                  +---------+---------+
                                            |
                +---------------------------+---------------------------+
                |                           |                           |
    +-----------v-----------+   +-----------v-----------+   +-----------v-----------+
    |                       |   |                       |   |                       |
    |    RadioPlayer        |   |    ChatRoom           |   |    ZenMode            |
    |                       |   |                       |   |                       |
    +-----------+-----------+   +-----------+-----------+   +-----------+-----------+
                |                           |                           |
                +---------------------------+---------------------------+
                                            |
                                  +---------v---------+
                                  |                   |
                                  |    Socket.IO      |
                                  |    (Real-time)    |
                                  |                   |
                                  +---------+---------+
                                            |
                        +-----------------+-----------------+
                        |                 |                 |
              +---------v--------+ +------v---------+ +----v-------------+
              |                  | |                | |                  |
              | PostgreSQL       | | Redis          | | Icecast          |
              | (Prisma ORM)     | | (Cache)        | | (Audio Stream)   |
              |                  | |                | |                  |
              +------------------+ +----------------+ +------------------+
                                                              |
                                                     +--------v--------+
                                                     |                 |
                                                     | Liquidsoap      |
                                                     | (Audio Engine)  |
                                                     |                 |
                                                     +-----------------+
```

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 15.3.0 | React framework with App Router |
| React | 19.0.0 | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.1.3 | Styling |
| Zustand | 5.0.3 | Client state management |
| React Query | 5.74.4 | Server state management |
| Socket.IO Client | 4.8.1 | Real-time communication |
| next-intl | 4.5.5 | Internationalization |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20.x | Runtime |
| Socket.IO | 4.8.1 | WebSocket server |
| Prisma | 6.6.0 | ORM |
| ioredis | 5.6.1 | Redis client |
| OpenAI SDK | 2.x | AI integration |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| PostgreSQL 16 | Primary database |
| Redis 7 | Cache and real-time data |
| Icecast 2 | Audio streaming server |
| Liquidsoap 2.3 | Audio processing engine |
| Docker | Containerization |

## Data Models (Prisma)

### Core Entities

1. **Track** - Music metadata
   - id, title, artist, album, duration
   - sourceType, sourceId (local/S3)
   - artworkKey, artworkUrl

2. **Playlist** - Versioned playlists
   - id, name, version, isActive

3. **PlaylistTrack** - N:N relationship with positions
   - playlistId, trackId, position

4. **PlaybackHistory** - Play history
   - trackId, playedAt, listeners

5. **ChatMessage** - Chat messages
   - id, content, username, createdAt

## Real-time Data Flow

### Redis Cache Keys

| Key | Purpose |
|-----|---------|
| `playback:state` | Current playback state |
| `playback:current_track` | Currently playing track |
| `listeners:count` | Active listener count |
| `chat:messages` | Recent chat messages |
| `playlist:active` | Active playlist cache |

### Socket.IO Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `track:changed` | Server -> Client | New track started |
| `listeners:update` | Server -> Client | Listener count changed |
| `chat:message` | Bidirectional | Chat message |
| `playback:sync` | Server -> Client | Sync playback state |

## API Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check for all services |
| `/api/stream` | GET | Current stream data |
| `/api/playlist` | GET | Active playlist |
| `/api/tracks` | GET | Available tracks |
| `/api/stats` | GET | Stream statistics |
| `/api/curation/process-message` | POST | AI chat processing |
| `/api/next-track` | GET | Next track for Liquidsoap |

## Audio Streaming Flow

```
1. Liquidsoap reads playlist from Node.js API
2. Liquidsoap processes audio (crossfade, normalization)
3. Liquidsoap streams to Icecast mount point
4. Icecast distributes stream to all listeners
5. Client HTML5 audio element plays stream
6. Metadata updates via Socket.IO
```

## Security Considerations

- NextAuth.js for session management
- AI moderation for chat messages
- Rate limiting on API endpoints
- Secure environment variable handling
- CORS configuration for production
