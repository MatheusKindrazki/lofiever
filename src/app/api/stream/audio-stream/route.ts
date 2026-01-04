import { NextResponse, type NextRequest } from 'next/server';
import { validateRequest, RATE_LIMITS } from '@/lib/api-security';

// Force Node.js runtime
export const runtime = 'nodejs';

/**
 * GET - Proxy para o stream principal do Icecast
 * Esta rota redireciona para o stream Opus do Icecast
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Security Check
  const securityError = await validateRequest(request, {
    rateLimit: RATE_LIMITS.stream,
  });
  if (securityError) return securityError;

  const { searchParams } = new URL(request.url);
  const isProxy = searchParams.get('proxy') === 'true';

  try {
    // URL do stream Icecast (configurável via env)
    const icecastHost = process.env.ICECAST_HOST;
    const icecastPort = process.env.ICECAST_PORT;
    const streamMount = process.env.ICECAST_MOUNT;
    const adminUser = process.env.ICECAST_ADMIN_USER;
    const adminPassword = process.env.ICECAST_ADMIN_PASSWORD;

    if (!icecastHost || !icecastPort || !streamMount || !adminUser || !adminPassword) {
      console.error('Missing Icecast configuration');
      return NextResponse.json(
        { error: 'Stream configuration missing', code: 'CONFIG_ERROR' },
        { status: 500 }
      );
    }

    const streamUrl = `http://${icecastHost}:${icecastPort}${streamMount}`;
    const statsUrl = `http://${icecastHost}:${icecastPort}/admin/stats.xml`;

    // Se for requisição de proxy, fazer stream direto
    if (isProxy) {
      try {
        const response = await fetch(streamUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Lofiever/1.0)',
            'Accept': 'audio/ogg, audio/*',
          }
        });

        if (!response.ok) {
          throw new Error(`Stream proxy error: ${response.status}`);
        }

        return new NextResponse(response.body, {
          status: 200,
          headers: {
            'Content-Type': response.headers.get('Content-Type') || 'application/ogg',
            'Cache-Control': 'no-cache, no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      } catch (error) {
        console.error('Stream proxy failed:', error);
        return NextResponse.redirect(new URL('/music/example.mp3', request.url));
      }
    }

    // Verificar se o stream está disponível via admin stats
    try {
      const credentials = Buffer.from(`${adminUser}:${adminPassword}`).toString('base64');
      const response = await fetch(statsUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${credentials}`
        },
        signal: AbortSignal.timeout(5000) // 5 segundos timeout
      });

      if (!response.ok) {
        throw new Error(`Stats not available: ${response.status}`);
      }

      const statsXml = await response.text();

      // Verificar se há sources ativas no XML
      const hasActiveSources = statsXml.includes('<sources>') &&
        statsXml.includes(`<source mount="${streamMount}">`) &&
        !statsXml.includes('<sources>0</sources>');

      if (!hasActiveSources) {
        throw new Error('No active sources found');
      }

    } catch (error) {
      console.error('Stream health check failed:', error);
      return NextResponse.json(
        {
          error: 'Stream temporarily unavailable',
          code: 'STREAM_UNAVAILABLE',
          fallback: '/music/example.mp3'
        },
        { status: 503 }
      );
    }

    // Retornar informações do stream com URL de proxy
    const proxyUrl = new URL('/api/stream/audio-stream?proxy=true', request.url);

    return NextResponse.json({
      streamUrl: proxyUrl.toString(),
      directUrl: streamUrl,
      format: 'opus',
      bitrate: 128,
      sampleRate: 48000,
      channels: 2,
      status: 'live',
      mount: streamMount,
    });

  } catch (error) {
    console.error('Error accessing audio stream:', error);
    return NextResponse.json(
      { error: 'Failed to access stream', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
} 