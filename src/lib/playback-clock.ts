import type { PlaybackState } from '@/lib/redis';

export type PlaybackClock = {
  isPlaying: boolean;
  position: number;
  startedAt: number;
  serverTime: number;
};

export function createPlaybackClock(
  playbackState: PlaybackState,
  durationSeconds: number,
  serverTime = Date.now(),
): PlaybackClock {
  const elapsedSeconds = playbackState.isPlaying
    ? Math.max(0, (serverTime - playbackState.startedAt) / 1_000)
    : Math.max(0, playbackState.position);
  const boundedPosition = durationSeconds > 0
    ? Math.min(elapsedSeconds, durationSeconds)
    : elapsedSeconds;

  return {
    isPlaying: playbackState.isPlaying,
    position: Math.round(boundedPosition * 1_000) / 1_000,
    startedAt: playbackState.startedAt,
    serverTime,
  };
}
