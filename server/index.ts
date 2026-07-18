import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { createSocketServer } from '../src/lib/socket/server';
import { startEditorialMusicScheduler } from '../src/services/music-generation/editorial';
import { startMusicGenerationWorker } from '../src/services/music-generation/worker';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = Number(process.env.PORT) || 3000;

// Initialize Next.js
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Create HTTP server
  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url || '', true);

    // Let Next.js handle all routes, including /api/next-track
    handle(req, res, parsedUrl);
  });

  // Initialize Socket.IO and attach to server
  createSocketServer(server);
  startMusicGenerationWorker();
  startEditorialMusicScheduler();

  // Start listening
  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
}).catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});
