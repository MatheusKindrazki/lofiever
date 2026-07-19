type ExpectedPositionInput = {
  duration?: number;
  isPlaying: boolean;
  position: number;
  receivedAt: number;
  now?: number;
};

type SeekDecisionInput = {
  currentPosition: number;
  expectedPosition: number;
  thresholdSeconds?: number;
};

export function calculateExpectedPosition({
  duration,
  isPlaying,
  position,
  receivedAt,
  now = Date.now(),
}: ExpectedPositionInput): number {
  const elapsedSinceSnapshot = isPlaying
    ? Math.max(0, now - receivedAt) / 1_000
    : 0;
  const expectedPosition = Math.max(0, position + elapsedSinceSnapshot);
  const boundedPosition = duration && duration > 0
    ? Math.min(expectedPosition, duration)
    : expectedPosition;

  return Math.round(boundedPosition * 1_000) / 1_000;
}

export function shouldSeekToExpectedPosition({
  currentPosition,
  expectedPosition,
  thresholdSeconds = 2.5,
}: SeekDecisionInput): boolean {
  return Math.abs(currentPosition - expectedPosition) >= thresholdSeconds;
}
