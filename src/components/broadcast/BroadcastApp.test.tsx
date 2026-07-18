import { act, fireEvent, render, screen } from '@testing-library/react';
import { BroadcastApp } from './BroadcastApp';

jest.mock('next-intl', () => ({
  useLocale: () => 'pt',
  useTranslations: () => (key: string) => key,
}));

jest.mock('@/lib/socket/client', () => ({
  usePlaybackSync: () => ({
    currentTrack: {
      id: 'track-1',
      title: 'Test track',
      artist: 'Lofiever',
      duration: 180,
    },
    isPlaying: true,
    position: 12,
  }),
}));

jest.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: { volume: 70 },
    isLoaded: true,
    setVolume: jest.fn(),
  }),
}));

jest.mock('./editions', () => ({
  useEdition: () => ({
    edition: { id: 'test', accent: '#111', accent2: '#222' },
    setEdition: jest.fn(),
    night: false,
    toggleNight: jest.fn(),
  }),
}));

jest.mock('./Masthead', () => ({ Masthead: () => null }));
jest.mock('./Program', () => ({ Program: () => null }));
jest.mock('./Transmissions', () => ({ Transmissions: () => null }));
jest.mock('./ZenBroadcast', () => ({ ZenBroadcast: () => null }));
jest.mock('./NowPlaying', () => ({
  NowPlaying: ({ playing, onToggle }: { playing: boolean; onToggle: () => void }) => (
    <button type="button" data-playing={String(playing)} onClick={onToggle}>
      toggle
    </button>
  ),
}));

class FakeAudio extends EventTarget {
  crossOrigin: string | null = null;
  volume = 1;
  src = '';
  paused = true;
  load = jest.fn();
  play = jest.fn(async () => {
    this.paused = false;
  });
  pause = jest.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  removeAttribute = jest.fn((name: string) => {
    if (name === 'src') this.src = '';
  });
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  destination = {} as AudioDestinationNode;
  analyser = {
    fftSize: 0,
    connect: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as AnalyserNode;
  source = {
    connect: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as MediaElementAudioSourceNode;
  createAnalyser = jest.fn(() => this.analyser);
  createMediaElementSource = jest.fn(() => this.source);
  resume = jest.fn(async () => {
    this.state = 'running';
  });
  close = jest.fn(async () => undefined);
  addEventListener = jest.fn();
  removeEventListener = jest.fn();
}

describe('BroadcastApp live stream recovery', () => {
  let audio: FakeAudio;
  let audioContext: FakeAudioContext;
  let originalAudio: typeof Audio;
  let originalAudioContext: typeof AudioContext;

  beforeEach(() => {
    jest.useFakeTimers();
    audio = new FakeAudio();
    audioContext = new FakeAudioContext();
    originalAudio = global.Audio;
    originalAudioContext = global.AudioContext;
    global.Audio = jest.fn(() => audio) as unknown as typeof Audio;
    global.AudioContext = jest.fn(() => audioContext) as unknown as typeof AudioContext;
  });

  afterEach(() => {
    global.Audio = originalAudio;
    global.AudioContext = originalAudioContext;
    jest.useRealTimers();
  });

  it('opens a fresh stream connection when active playback stalls', async () => {
    render(<BroadcastApp />);

    await act(async () => undefined);
    expect(audio.load).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(1);

    await act(async () => {
      audio.dispatchEvent(new Event('playing'));
      audio.dispatchEvent(new Event('stalled'));
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
    });

    expect(audio.load).toHaveBeenCalledTimes(2);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.src).toMatch(/^\/api\/stream\/audio-stream\?proxy=true&t=\d+$/);
    expect(screen.getByRole('button', { name: 'toggle' })).toHaveAttribute('data-playing', 'true');
  });

  it('keeps the current connection when playback recovers before the grace period', async () => {
    render(<BroadcastApp />);

    await act(async () => undefined);
    act(() => {
      audio.dispatchEvent(new Event('waiting'));
      jest.advanceTimersByTime(4_000);
      audio.dispatchEvent(new Event('playing'));
      jest.advanceTimersByTime(1_000);
    });

    expect(audio.load).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect after the listener intentionally pauses', async () => {
    render(<BroadcastApp />);

    await act(async () => undefined);
    act(() => audio.dispatchEvent(new Event('waiting')));
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    act(() => jest.advanceTimersByTime(5_000));

    expect(audio.load).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('shows the local listener state instead of the server broadcast state', async () => {
    audio.play.mockRejectedValueOnce(Object.assign(new Error('autoplay blocked'), {
      name: 'NotAllowedError',
    }));
    render(<BroadcastApp />);

    await act(async () => undefined);

    expect(screen.getByRole('button', { name: 'toggle' })).toHaveAttribute('data-playing', 'false');
  });

  it('resumes a suspended audio context when the listener presses play', async () => {
    audio.play.mockRejectedValueOnce(Object.assign(new Error('autoplay blocked'), {
      name: 'NotAllowedError',
    }));
    render(<BroadcastApp />);

    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    await act(async () => undefined);

    expect(audioContext.resume).toHaveBeenCalledTimes(1);
  });
});
