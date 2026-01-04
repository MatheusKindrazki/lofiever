# Contributing to Lofiever

First off, thank you for considering contributing to Lofiever! It's people like you that make Lofiever such a great project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Style Guidelines](#style-guidelines)
- [Project Structure](#project-structure)
- [Community](#community)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

### Prerequisites

- Node.js 20.x or higher
- Docker and Docker Compose
- npm or pnpm

### Development Setup

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/lofiever.git
   cd lofiever
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your values (see ENV_VARIABLES.md for details)
   ```

4. **Start Docker services**

   ```bash
   npm run docker:up
   ```

5. **Run database migrations**

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

6. **Start development server**

   ```bash
   npm run dev
   ```

7. **Verify setup**
   - Web app: http://localhost:3000
   - Audio stream: http://localhost:8000/stream
   - Icecast admin: http://localhost:8000/admin/

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check existing issues. When creating a bug report, include:

- **Clear title** describing the issue
- **Steps to reproduce** the behavior
- **Expected behavior** vs **actual behavior**
- **Screenshots** if applicable
- **Environment details** (OS, browser, Node version)

### Suggesting Features

Feature requests are welcome! Please:

- Check if it's already been suggested
- Provide clear use case and benefits
- Be open to discussion and alternatives

### Code Contributions

1. **Find an issue** to work on (look for `good first issue` labels)
2. **Comment on the issue** to claim it
3. **Create a branch** from `main`
4. **Make your changes** following our style guidelines
5. **Write tests** for new functionality
6. **Submit a pull request**

## Pull Request Process

### Branch Naming

Use descriptive branch names:

- `feature/playlist-shuffle`
- `fix/audio-sync-safari`
- `docs/api-endpoints`
- `refactor/socket-handler`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add playlist shuffle feature
fix: resolve audio sync issue on Safari
docs: update README with new API endpoints
style: format code with prettier
refactor: simplify socket connection logic
test: add unit tests for playlist service
chore: update dependencies
```

### Before Submitting

- [ ] Run `npm run lint` (must pass)
- [ ] Run `npm run build` (must pass)
- [ ] Run `npm test` (must pass)
- [ ] Update documentation if needed
- [ ] Add tests for new functionality

### PR Description

Use the provided template and include:

- Description of changes
- Related issue number
- Type of change
- Testing instructions
- Screenshots (if UI changes)

## Style Guidelines

### TypeScript/JavaScript

- Use TypeScript for all new code
- Follow ESLint configuration (enforced in CI)
- Use type imports: `import type { X } from 'y'`
- Explicit return types on functions
- No `any` types (use `unknown` if necessary)

### React Components

- Functional components with hooks
- Props interfaces defined explicitly
- Use Tailwind CSS for styling
- Follow component structure in `src/components/`

### File Naming

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `AudioPlayer.tsx` |
| Hooks | camelCase with `use` prefix | `useAudioPlayer.ts` |
| Utilities | kebab-case | `format-time.ts` |
| Services | kebab-case with `.service` | `playlist.service.ts` |
| Tests | Same as source with `.test` | `playlist.service.test.ts` |
| Types | kebab-case | `audio-types.ts` |

### CSS/Styling

- Use Tailwind CSS utilities
- Follow the design system in `docs/style-guide.md`
- Dark mode support required for new components
- Responsive design (mobile-first)

## Project Structure

```
lofiever/
├── src/
│   ├── app/              # Next.js App Router pages
│   │   └── api/          # API routes
│   ├── components/       # React components
│   │   ├── ui/           # Base UI components
│   │   └── features/     # Feature-specific components
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Core utilities
│   │   └── socket/       # Socket.IO client/server
│   ├── services/         # Business logic
│   ├── types/            # TypeScript definitions
│   └── utils/            # Helper functions
├── server/               # Custom Node.js server (Socket.IO)
├── prisma/               # Database schema and migrations
├── streaming/            # Icecast/Liquidsoap configs
├── scripts/              # Utility scripts
├── docs/                 # Documentation
├── messages/             # i18n translations
└── public/               # Static assets
```

### Key Files

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main page component |
| `src/components/AudioPlayer.tsx` | Audio player component |
| `src/services/playlist.service.ts` | Playlist management |
| `server/index.ts` | Socket.IO server entry |
| `prisma/schema.prisma` | Database schema |

## Testing

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### Writing Tests

- Place tests next to source files or in `__tests__` folders
- Use descriptive test names
- Mock external dependencies
- Test edge cases

Example:

```typescript
describe('PlaylistService', () => {
  it('should return next track when available', async () => {
    // Arrange
    const service = new PlaylistService();

    // Act
    const track = await service.getNextTrack();

    // Assert
    expect(track).toBeDefined();
    expect(track.title).toBeTruthy();
  });
});
```

## Documentation

- Update README.md for user-facing changes
- Add JSDoc comments for public APIs
- Update relevant docs in `/docs` folder
- Keep CHANGELOG.md updated

## Community

- **Discussions**: Use GitHub Discussions for questions and ideas
- **Issues**: Bug reports and feature requests
- **Pull Requests**: Code contributions

## Recognition

Contributors will be recognized in:

- README.md contributors section
- Release notes
- GitHub contributors page

Thank you for contributing!
