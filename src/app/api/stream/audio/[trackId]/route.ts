import { NextResponse } from 'next/server';
import { prismaHelpers } from '@/lib/prisma';

/**
 * GET - Proxy para stream de áudio individual
 * Esta rota serve como fallback para desenvolvimento quando não há stream direto
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackId: string }> }
): Promise<NextResponse> {
  try {
    const { trackId } = await params;

    // Buscar informações da track no banco
    const track = await prismaHelpers.getTrackById(trackId);

    if (!track) {
      return NextResponse.json(
        { error: 'Track not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Para desenvolvimento, redirecionar para arquivo local se existir
    if (track.sourceType === 'local') {
      const audioUrl = `/music/${track.sourceId}`;
      return NextResponse.redirect(new URL(audioUrl, request.url));
    }

    // Para outros tipos, retornar informações da track
    return NextResponse.json({
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      sourceType: track.sourceType,
      sourceId: track.sourceId,
      streamUrl: `/music/${track.sourceId}`, // Fallback para arquivo local
    });

  } catch (error) {
    console.error('Error serving audio track:', error);
    return NextResponse.json(
      { error: 'Failed to serve audio track', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
} 