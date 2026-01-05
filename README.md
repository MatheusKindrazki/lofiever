<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind-4-38B2AC?style=for-the-badge&logo=tailwindcss" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Socket.IO-4-010101?style=for-the-badge&logo=socket.io" alt="Socket.IO" />
  <img src="https://img.shields.io/badge/OpenAI-API-412991?style=for-the-badge&logo=openai" alt="OpenAI" />
</p>

<h1 align="center">Lofiever</h1>

<p align="center">
  <strong>24/7 Lo-fi Radio Stream with AI-Powered Virtual DJ</strong>
</p>

<p align="center">
  A beautiful, immersive lo-fi music streaming platform where all listeners are synchronized,<br/>
  featuring real-time chat, AI curation, and a stunning Zen Mode experience.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#community">Community</a>
</p>

<p align="center">
  <a href="https://github.com/MatheusKindrazki/lofiever/stargazers">
    <img src="https://img.shields.io/github/stars/MatheusKindrazki/lofiever?style=social" alt="Stars" />
  </a>
  <a href="https://github.com/MatheusKindrazki/lofiever/network/members">
    <img src="https://img.shields.io/github/forks/MatheusKindrazki/lofiever?style=social" alt="Forks" />
  </a>
  <a href="https://github.com/MatheusKindrazki/lofiever/issues">
    <img src="https://img.shields.io/github/issues/MatheusKindrazki/lofiever" alt="Issues" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/MatheusKindrazki/lofiever" alt="License" />
  </a>
</p>

---

## Features

| Feature | Description |
|---------|-------------|
| **24/7 Live Radio** | Continuous lo-fi streaming via Icecast + Liquidsoap |
| **Real-time Sync** | All listeners hear the same music at the same time |
| **AI DJ (Lofine)** | OpenAI-powered virtual DJ that takes song requests and chats |
| **Live Chat** | Real-time chat with AI moderation and private messaging |
| **Zen Mode** | Fullscreen immersive experience with animated backgrounds |
| **Multi-language** | English and Portuguese support |
| **Dynamic Playlists** | AI-curated playlists that evolve based on mood and requests |

## Tech Stack

<table>
  <tr>
    <td align="center"><strong>Frontend</strong></td>
    <td>Next.js 15, React 19, TypeScript, Tailwind CSS 4, Zustand, React Query</td>
  </tr>
  <tr>
    <td align="center"><strong>Real-time</strong></td>
    <td>Socket.IO for live chat and metadata sync</td>
  </tr>
  <tr>
    <td align="center"><strong>Backend</strong></td>
    <td>Node.js, PostgreSQL + Prisma, Redis</td>
  </tr>
  <tr>
    <td align="center"><strong>Streaming</strong></td>
    <td>Icecast + Liquidsoap for professional audio streaming</td>
  </tr>
  <tr>
    <td align="center"><strong>AI</strong></td>
    <td>OpenAI API for DJ personality and chat moderation</td>
  </tr>
  <tr>
    <td align="center"><strong>Storage</strong></td>
    <td>Cloudflare R2 for music files and artwork</td>
  </tr>
</table>

## Quick Start

### Prerequisites

- Node.js 20.x or higher
- Docker and Docker Compose
- npm

### 1. Clone and install

\`\`\`bash
git clone https://github.com/MatheusKindrazki/lofiever.git
cd lofiever
npm install
\`\`\`

### 2. Configure environment

\`\`\`bash
cp .env.example .env
# Edit .env with your values
\`\`\`

### 3. Start all services

\`\`\`bash
npm run setup
\`\`\`

This starts Docker containers (Icecast, Liquidsoap, PostgreSQL, Redis) and verifies everything is running.

### 4. Start development

\`\`\`bash
npm run dev
\`\`\`

### 5. Open in browser

- **Web app**: http://localhost:3000
- **Audio stream**: http://localhost:8000/stream
- **Icecast admin**: http://localhost:8000/admin/

## Project Structure

\`\`\`
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
├── messages/             # i18n translations (en, pt)
└── docs/                 # Documentation
\`\`\`

## Available Scripts

| Command | Description |
|---------|-------------|
| \`npm run dev\` | Start development server (Socket.IO + Next.js) |
| \`npm run build\` | Build for production |
| \`npm run start\` | Start production server |
| \`npm run lint\` | Run ESLint |
| \`npm test\` | Run tests |
| \`npm run docker:up\` | Start Docker containers |
| \`npm run docker:down\` | Stop Docker containers |
| \`npm run db:migrate\` | Run database migrations |
| \`npm run db:seed\` | Seed database with sample data |

## Contributing

We love contributions! Lofiever is open source and we welcome contributors of all skill levels.

### Ways to Contribute

- **Report bugs** - Found something broken? [Open an issue](https://github.com/MatheusKindrazki/lofiever/issues/new?template=bug_report.md)
- **Suggest features** - Have an idea? [Request a feature](https://github.com/MatheusKindrazki/lofiever/issues/new?template=feature_request.md)
- **Submit PRs** - Code contributions are always welcome
- **Improve docs** - Help make our documentation better
- **Star the repo** - Show your support!

### Good First Issues

New to the project? Look for issues labeled [\`good first issue\`](https://github.com/MatheusKindrazki/lofiever/labels/good%20first%20issue) - these are beginner-friendly and a great way to start contributing.

### Getting Started

1. Fork the repository
2. Create a feature branch (\`git checkout -b feat/amazing-feature\`)
3. Make your changes following our [Contributing Guide](CONTRIBUTING.md)
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (\`feat: add amazing feature\`)
5. Push and open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## Community

- **Issues**: [Report bugs or request features](https://github.com/MatheusKindrazki/lofiever/issues)
- **Discussions**: [Ask questions and share ideas](https://github.com/MatheusKindrazki/lofiever/discussions)
- **Pull Requests**: [Contribute code](https://github.com/MatheusKindrazki/lofiever/pulls)

## Documentation

| Document | Description |
|----------|-------------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute to the project |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community guidelines |
| [SECURITY.md](SECURITY.md) | Security policy and reporting |
| [ENV_VARIABLES.md](ENV_VARIABLES.md) | Environment variables reference |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture overview |
| [docs/STREAMING.md](docs/STREAMING.md) | Audio streaming configuration |

## Roadmap

- [ ] Mobile app (React Native)
- [ ] More languages (Spanish, French, Japanese)
- [ ] User accounts and personalized playlists
- [ ] Discord bot integration
- [ ] Spotify/Apple Music integration for song metadata
- [ ] Community-submitted music

See our [project board](https://github.com/MatheusKindrazki/lofiever/projects) for current development priorities.

## Support the Project

If you enjoy Lofiever, please consider:

- Giving the repo a star
- Sharing with friends who love lo-fi music
- Contributing code or documentation
- Reporting bugs or suggesting features

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with love by <a href="https://github.com/MatheusKindrazki">@MatheusKindrazki</a>
</p>

<p align="center">
  <a href="https://github.com/MatheusKindrazki/lofiever">
    <img src="https://img.shields.io/badge/GitHub-lofiever-181717?style=for-the-badge&logo=github" alt="GitHub" />
  </a>
</p>
