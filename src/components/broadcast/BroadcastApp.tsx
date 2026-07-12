'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { usePlaybackSync } from '@/lib/socket/client';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useEdition } from './editions';
import { Masthead } from './Masthead';
import { NowPlaying } from './NowPlaying';
import type { BroadcastTrack } from './NowPlaying';
import { Program } from './Program';
import { Transmissions } from './Transmissions';
import { ZenBroadcast } from './ZenBroadcast';

/** Placeholder shown before the first track sync arrives. */
const PLACEHOLDER: BroadcastTrack = {
  id: 'tuning',
  title: 'Tuning in…',
  artist: 'Lofiever',
  duration: 0,
};

/* ============================================================
   BROADCAST APP — orchestrator. Owns the shared audio element +
   AudioContext analyser (same model as the previous player),
   the edition/day-night state, and stitches every panel together.
   ============================================================ */
export function BroadcastApp() {
  const locale = useLocale();
  const { edition, setEdition, night, toggleNight } = useEdition();

  // ---- audio (owned here, shared with the seismograph) ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [playing, setPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const { preferences, isLoaded, setVolume: saveVolume } = useUserPreferences();
  const volume = preferences.volume;

  // ---- live broadcast state from socket ----
  const { currentTrack, isPlaying: syncedPlaying, position } = usePlaybackSync();
  const currentTrackId = currentTrack?.id;

  const track: BroadcastTrack = currentTrack
    ? {
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        duration: currentTrack.duration,
        mood: currentTrack.mood,
        genre: currentTrack.genre,
        artworkUrl: currentTrack.artworkUrl,
      }
    : PLACEHOLDER;

  // monotonically-increasing issue number per distinct track
  const [issueNo, setIssueNo] = useState(41);
  const lastTrackId = useRef<string | null>(null);
  useEffect(() => {
    if (currentTrackId && currentTrackId !== lastTrackId.current) {
      lastTrackId.current = currentTrackId;
      setIssueNo((n) => n + 1);
    }
  }, [currentTrackId]);

  // ---- elapsed: seed from synced position, tick locally while playing ----
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(position || 0);
  }, [position, currentTrackId]);
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      setElapsed((e) => {
        const dur = track.duration || 0;
        if (dur && e + 1 >= dur) return dur;
        return e + 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [playing, track.duration]);

  // ---- setup audio element (mirrors the previous player) ----
  useEffect(() => {
    if (audioRef.current || !isLoaded) return;

    const audio = new Audio();
    audioRef.current = audio;
    audio.crossOrigin = 'anonymous';
    audio.volume = volume / 100;
    audio.src = '/api/stream/audio-stream?proxy=true';
    audio.load();

    const handlePlaying = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleError = (error: Event) => {
      console.error('Audio error:', error);
      setPlaying(false);
      setIsLoading(false);
    };
    const handleLoadStart = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);

    audio.play().catch((e) => console.warn('Autoplay blocked', e));

    return () => {
      audio.pause();
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
      sourceRef.current?.disconnect();
      audioContextRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // keep element volume in sync with preferences
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  const initAudioContext = useCallback(() => {
    if (!audioRef.current || audioContextRef.current) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new Ctx();
      audioContextRef.current = context;
      const node = context.createAnalyser();
      node.fftSize = 256;
      setAnalyser(node);
      if (!sourceRef.current) {
        sourceRef.current = context.createMediaElementSource(audioRef.current);
      }
      sourceRef.current.connect(node);
      node.connect(context.destination);
    } catch (error) {
      console.error('Failed to initialize AudioContext:', error);
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      setIsLoading(true);
      audioRef.current.src = '/api/stream/audio-stream?proxy=true&t=' + Date.now();
      audioRef.current.load();
      initAudioContext();
      audioRef.current.play().catch((e) => {
        console.error('Play error:', e);
        setIsLoading(false);
      });
    }
  }, [playing, initAudioContext]);

  const onVolume = useCallback((v: number) => saveVolume(v), [saveVolume]);

  // ---- zen mode (+ fullscreen) ----
  const containerRef = useRef<HTMLDivElement>(null);
  const [zen, setZen] = useState(false);

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && zen) setZen(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [zen]);

  const enterZen = useCallback(async () => {
    setZen(true);
    try {
      if (containerRef.current && document.fullscreenEnabled) {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen not available:', err);
    }
  }, []);

  const exitZen = useCallback(async () => {
    setZen(false);
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
  }, []);

  // keyboard: Esc exits zen, Space toggles playback
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && zen) exitZen();
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [zen, exitZen, togglePlayPause]);

  // keep React state aligned with server "on air" status when the local
  // audio element hasn't fired yet (e.g. autoplay blocked)
  const onAir = playing || syncedPlaying;

  // colours for the canvases (read from the active edition + theme)
  const paper3 = night ? '#28221A' : '#E2D2AE';
  const ink = night ? '#F2E7CE' : '#1C1813';

  const dateStr = useMemo(
    () =>
      new Date()
        .toLocaleDateString(locale === 'en' ? 'en-US' : 'pt-BR', { month: 'short', day: '2-digit' })
        .toUpperCase(),
    [locale],
  );

  return (
    <div className={`broadcast-app ${night ? 'night' : 'day'}`} data-edition={edition.id} ref={containerRef}>
      <div className="sheet">
        <span className="crop tl" />
        <span className="crop tr" />
        <span className="crop bl" />
        <span className="crop br" />

        <Masthead
          playing={onAir}
          edition={edition}
          onEdition={setEdition}
          night={night}
          onToggleNight={toggleNight}
          onZen={enterZen}
          dateStr={dateStr}
          issue={issueNo}
        />

        <div className="broadcast">
          <NowPlaying
            track={track}
            issueNo={issueNo}
            playing={onAir}
            isLoading={isLoading}
            onToggle={togglePlayPause}
            elapsed={elapsed}
            accent={edition.accent}
            accent2={edition.accent2}
            paper3={paper3}
            ink={ink}
            night={night}
            volume={volume}
            onVolume={onVolume}
            analyser={analyser}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
            <Program current={currentTrack} />
            <Transmissions accent={edition.accent} />
          </div>
        </div>

        <footer className="colophon">
          <div className="colo-mark">
            <span className="barcode" aria-hidden="true" />
            <span className="colo-no">ISSUE {dateStr.replace(/\s/g, '')} · 88.3FM</span>
          </div>
          <div className="c-left">
            Printed in <b>{edition.name}</b> · every reader hears the same second ·{' '}
            <a
              href="https://github.com/MatheusKindrazki/lofiever"
              target="_blank"
              rel="noopener noreferrer"
            >
              source
            </a>
          </div>
        </footer>
      </div>

      {zen && (
        <ZenBroadcast
          track={track}
          issueNo={issueNo}
          playing={onAir}
          isLoading={isLoading}
          onToggle={togglePlayPause}
          onExit={exitZen}
          elapsed={elapsed}
          accent={edition.accent}
          accent2={edition.accent2}
          paper3={paper3}
          ink={ink}
          night={night}
          analyser={analyser}
        />
      )}
    </div>
  );
}
