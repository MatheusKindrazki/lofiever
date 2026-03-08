import { config } from '@/lib/config';
import { R2Lib } from '@/lib/r2';
import { normalizeYouTubeVideoId } from '@/services/youtube';

type TrackSourceLike = {
  id: string;
  sourceType?: string | null;
  sourceId?: string | null;
};

export type PlaybackPlatform = 'generic' | 'tvos';

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function resolvePublicBaseUrl(request: Request): string {
  const forwardedProto =
    request.headers.get('x-forwarded-proto') ||
    request.headers.get('x-forwarded-protocol');
  const forwardedHost =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host');

  if (forwardedHost && !forwardedHost.startsWith('0.0.0.0')) {
    const protocol = forwardedProto || new URL(request.url).protocol.replace(':', '') || 'https';
    return `${protocol}://${forwardedHost}`.replace(/\/$/, '');
  }

  return config.app.url.replace(/\/$/, '');
}

function toAbsoluteUrl(request: Request, path: string): string {
  return new URL(path, `${resolvePublicBaseUrl(request)}/`).toString();
}

function getFileExtension(sourceId: string): string {
  const normalized = sourceId.toLowerCase().split('?')[0];
  const lastDot = normalized.lastIndexOf('.');
  return lastDot >= 0 ? normalized.slice(lastDot) : '';
}

function isTvCompatibleAudio(sourceId: string): boolean {
  return new Set(['.mp3', '.m4a', '.aac', '.wav', '.aif', '.aiff', '.caf', '.mp4']).has(
    getFileExtension(sourceId)
  );
}

export async function resolveTrackPlaybackUrl(
  track: TrackSourceLike,
  request: Request,
  platform: PlaybackPlatform = 'generic'
): Promise<string | null> {
  if (!track.sourceType || !track.sourceId) {
    return null;
  }

  switch (track.sourceType) {
    case 'local': {
      const encodedPath = encodePathSegments(track.sourceId);
      const relativePath = track.sourceId.startsWith('music/')
        ? `/${encodedPath}`
        : `/music/${encodedPath}`;
      return toAbsoluteUrl(request, relativePath);
    }

    case 's3':
    case 'r2':
      if (platform === 'tvos' && !isTvCompatibleAudio(track.sourceId)) {
        return null;
      }
      return R2Lib.getPresignedUrl(track.sourceId, 3600);

    case 'youtube':
      if (platform === 'tvos') {
        return null;
      }
      return toAbsoluteUrl(
        request,
        `/api/youtube/serve/${normalizeYouTubeVideoId(track.sourceId)}`
      );

    default:
      return null;
  }
}
