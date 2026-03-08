import { NextResponse } from 'next/server';
import { prismaHelpers } from '@/lib/prisma';
import { resolveTrackPlaybackUrl, type PlaybackPlatform } from '@/lib/stream-playback';

/**
 * GET - Resolve a playable URL for the current track.
 * tvOS clients use `platform=tvos` so we can avoid serving unsupported codecs.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackId: string }> }
): Promise<NextResponse> {
  try {
    const { trackId } = await params;
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform') === 'tvos' ? 'tvos' : 'generic';

    const track = await prismaHelpers.getTrackById(trackId);

    if (!track) {
      return NextResponse.json(
        { error: 'Track not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const playbackUrl = await resolveTrackPlaybackUrl(
      track,
      request,
      platform as PlaybackPlatform
    );

    if (!playbackUrl) {
      return NextResponse.json(
        {
          error: platform === 'tvos'
            ? 'Current track is not available in a tvOS-compatible format yet'
            : 'Playable track URL could not be resolved',
          code: 'UNSUPPORTED_FORMAT',
          sourceType: track.sourceType,
          sourceId: track.sourceId,
        },
        { status: 415 }
      );
    }

    return NextResponse.redirect(playbackUrl);
  } catch (error) {
    console.error('Error resolving track playback URL:', error);
    return NextResponse.json(
      { error: 'Failed to serve audio track', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
