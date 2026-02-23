import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { statSync } from 'fs';
import { YouTubeCacheService } from '@/services/youtube';
import { InvalidYouTubeVideoIdError, normalizeYouTubeVideoId } from '@/services/youtube';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';

/**
 * GET - Serve cached YouTube audio file to Liquidsoap.
 * Supports Range requests for seeking.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> },
): Promise<Response> {
  const { videoId } = await params;

  if (!config.youtube.enabled) {
    return new NextResponse('YouTube integration disabled', { status: 503 });
  }

  let normalizedVideoId = '';
  try {
    normalizedVideoId = normalizeYouTubeVideoId(videoId);
  } catch (error) {
    if (error instanceof InvalidYouTubeVideoIdError) {
      return new NextResponse('Invalid video ID', { status: 400 });
    }
    throw error;
  }

  // Verify track exists in database (prevents use as open YouTube proxy)
  const track = await prisma.track.findFirst({
    where: { sourceType: 'youtube', sourceId: normalizedVideoId },
  });
  if (!track) {
    return new NextResponse('Track not found', { status: 404 });
  }

  try {
    // Ensure file is cached (downloads if needed)
    const filePath = await YouTubeCacheService.ensureCached(normalizedVideoId);

    // Get file stats
    const stats = statSync(filePath);
    const fileSize = stats.size;

    // Handle Range header (for seeking)
    const range = request.headers.get('range');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      // Validate range bounds
      if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${fileSize}` },
        });
      }

      const chunkSize = end - start + 1;
      const fileBuffer = await fs.readFile(filePath);
      const chunk = fileBuffer.subarray(start, end + 1);

      return new Response(chunk, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': 'audio/ogg',
        },
      });
    }

    // Full file response
    const fileBuffer = await fs.readFile(filePath);

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Length': String(fileSize),
        'Content-Type': 'audio/ogg',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error(`[YouTube Serve] Error serving ${normalizedVideoId}:`, error);
    return new NextResponse('Audio not available', { status: 404 });
  }
}
