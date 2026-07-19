import { calculateExpectedPosition, shouldSeekToExpectedPosition } from './playbackSync';

describe('tvOS synchronized playback position', () => {
  it('advances the server snapshot while the compatible audio file loads', () => {
    expect(calculateExpectedPosition({
      duration: 125,
      isPlaying: true,
      position: 60,
      receivedAt: 1_000_000,
      now: 1_002_500,
    })).toBe(62.5);
  });

  it('resynchronizes only when playback drift becomes perceptible', () => {
    expect(shouldSeekToExpectedPosition({ currentPosition: 60, expectedPosition: 64 })).toBe(true);
    expect(shouldSeekToExpectedPosition({ currentPosition: 60, expectedPosition: 61 })).toBe(false);
  });
});
