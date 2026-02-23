import { NextResponse } from 'next/server';
import { access } from 'fs/promises';
import { constants } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { config } from '@/lib/config';

const execFileAsync = promisify(execFile);

export async function GET() {
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      redis: 'unknown',
      youtube: {
        enabled: config.youtube.enabled,
        ytDlp: config.youtube.enabled ? 'unknown' : 'disabled',
        ffmpeg: config.youtube.enabled ? 'unknown' : 'disabled',
        cacheDir: config.youtube.enabled ? 'unknown' : 'disabled',
      },
    },
  };

  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    checks.services.database = 'healthy';
  } catch {
    checks.services.database = 'unhealthy';
    checks.status = 'degraded';
  }

  try {
    // Check Redis connection
    await redis.ping();
    checks.services.redis = 'healthy';
  } catch {
    checks.services.redis = 'unhealthy';
    checks.status = 'degraded';
  }

  if (config.youtube.enabled) {
    try {
      await execFileAsync('yt-dlp', ['--version'], { timeout: 5000 });
      checks.services.youtube.ytDlp = 'healthy';
    } catch {
      checks.services.youtube.ytDlp = 'unhealthy';
      checks.status = 'degraded';
    }

    try {
      await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
      checks.services.youtube.ffmpeg = 'healthy';
    } catch {
      checks.services.youtube.ffmpeg = 'unhealthy';
      checks.status = 'degraded';
    }

    try {
      await access(config.youtube.cacheDir, constants.R_OK | constants.W_OK);
      checks.services.youtube.cacheDir = 'healthy';
    } catch {
      checks.services.youtube.cacheDir = 'unhealthy';
      checks.status = 'degraded';
    }
  }

  const httpStatus = checks.status === 'healthy' ? 200 : 503;

  return NextResponse.json(checks, { status: httpStatus });
}
