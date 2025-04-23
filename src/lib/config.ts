export const config = {
  app: {
    name: 'Lofiever',
    description: '24/7 Lofi Streaming with AI Curation',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    env: process.env.NODE_ENV || 'development',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    maxRetriesPerRequest: 3,
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  socket: {
    path: '/api/ws',
    transports: ['websocket'] as const,
  },
  auth: {
    secret: process.env.AUTH_SECRET,
    providers: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
      },
    },
  },
  streaming: {
    chunkDuration: 10, // seconds
    playlistSize: 100,
    maxCacheAge: 60 * 60 * 24, // 24 hours
  },
} as const;

// Create a separate type declaration file for environment variables
export interface Env {
  NEXT_PUBLIC_APP_URL?: string;
  DATABASE_URL: string;
  REDIS_URL?: string;
  AUTH_SECRET: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  NODE_ENV: 'development' | 'production' | 'test';
} 