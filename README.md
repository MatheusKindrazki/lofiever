# Lofiever - 24/7 Lofi Streaming with AI Curation

Lofiever is an open-source platform for streaming lofi music continuously, with playlists curated by AI. The application provides a seamless listening experience with real-time statistics and a customizable music player.

## Features

- **Continuous Streaming**: Listen to lofi music 24/7 without interruptions.
- **AI Curation**: Get personalized music recommendations using AI technology.
- **Real-time Statistics**: See listener count, days active, and songs played.
- **Responsive Design**: Enjoy the application on any device with a responsive interface.
- **Dark Mode Support**: Automatically adapts to your system's theme preference.

## Tech Stack

- **Frontend**: Next.js 15, React 19, Tailwind CSS 4
- **Backend**: Next.js API Routes
- **Streaming**: WebSockets via Socket.IO (planned)
- **AI Integration**: OpenAI API (simulated in current version)
- **Styling**: Tailwind CSS with custom lofi theme

## Getting Started

### Prerequisites

- Node.js 20.x or later
- pnpm (this project uses pnpm as the package manager)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/lofiever.git
cd lofiever
```

2. Install dependencies:
```bash
pnpm install
```

3. Run the development server:
```bash
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

- `src/components/`: React components
- `src/app/`: Next.js pages and app router
- `src/lib/`: Utility functions and API services
- `src/app/api/`: Backend API routes
- `src/styles/`: Global styles and Tailwind configuration

## Roadmap

- [ ] Implement real-time streaming with Socket.IO
- [ ] Add user authentication for saved playlists
- [ ] Integrate with actual music sources (Spotify, YouTube)
- [ ] Implement real AI curation with OpenAI
- [ ] Add social features (share playlists, comments)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Inspired by lofi hip hop radio streams
- Built with Next.js, React, and Tailwind CSS
