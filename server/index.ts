import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { createSocketServer } from '../src/lib/socket/server';
import { LiquidsoapIntegrationService } from '../src/services/playlist/liquidsoap-integration.service';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = Number(process.env.PORT) || 3000;

// Initialize Next.js
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Create HTTP server
  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url || '', true);

    if (req.method === 'GET' && parsedUrl.pathname === '/api/next-track') {
      try {
        const trackUrl = await LiquidsoapIntegrationService.getNextTrackUri();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end(trackUrl);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('');
      }
      return;
    }

    handle(req, res, parsedUrl);
  });

  // Initialize Socket.IO and attach to server
  createSocketServer(server);

  // Start listening
  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
}).catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
}); 