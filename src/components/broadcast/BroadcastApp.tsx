'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePlaybackSync } from '@/lib/socket/client';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useEdition } from './editions';
import { Masthead } from './Masthead';
import { NowPlaying } from './NowPlaying';
import type { BroadcastTrack } from './NowPlaying';
import { Program } from './Program';
import { Transmissions } from './Transmissions';
import { ZenBroadcast } from './ZenBroadcast';

const LIVE_STREAM_URL = '/api/stream/audio-stream?proxy=true';
const STALL_RECOVERY_DELAY_MS = 5_000;
const MAX_RECOVERY_DELAY_MS = 30_000;

function isAutoplayBlocked(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'NotAllowedError';
}

/* ============================================================
   BROADCAST APP — orchestrator. Owns the shared audio element +
   AudioContext analyser (same model as the previous player),
   the edition/day-night state, and stitches every panel together.
   ============================================================ */
export function BroadcastApp() {
  const locale = useLocale();
  const tBroadcast = useTranslations('broadcast');
  const { edition, setEdition, night, toggleNight } = useEdition();

  // ---- audio (owned here, shared with the seismograph) ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioContextStateHandlerRef = useRef<(() => void) | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryAttemptRef = useRef(0);
  const wantsPlaybackRef = useRef(false);
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
        bpm: currentTrack.bpm,
        mood: currentTrack.mood,
        genre: currentTrack.genre,
        origin: currentTrack.origin,
        artworkUrl: currentTrack.artworkUrl,
      }
    : {
        id: 'tuning',
        title: tBroadcast('nowPlaying.connecting'),
        artist: 'Lofiever',
        duration: 0,
      };

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

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const resumeAudioContext = useCallback(async () => {
    const context = audioContextRef.current;
    if (context && context.state !== 'running' && context.state !== 'closed') {
      await context.resume();
    }
  }, []);

  const initAudioContext = useCallback(() => {
    if (!audioRef.current) return;

    if (audioContextRef.current) {
      void resumeAudioContext();
      return;
    }

    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new Ctx();
      audioContextRef.current = context;
      const node = context.createAnalyser();
      node.fftSize = 256;
      setAnalyser(node);
      sourceRef.current = context.createMediaElementSource(audioRef.current);
      sourceRef.current.connect(node);
      node.connect(context.destination);

      const handleStateChange = () => {
        if (wantsPlaybackRef.current && document.visibilityState === 'visible') {
          void resumeAudioContext();
        }
      };
      audioContextStateHandlerRef.current = handleStateChange;
      context.addEventListener('statechange', handleStateChange);
      void resumeAudioContext();
    } catch (error) {
      console.error('Failed to initialize AudioContext:', error);
    }
  }, [resumeAudioContext]);

  const restartStream = useCallback(async (audio: HTMLAudioElement) => {
    clearRecoveryTimer();
    if (!wantsPlaybackRef.current) return;

    setIsLoading(true);
    audio.src = `${LIVE_STREAM_URL}&t=${Date.now()}`;
    audio.load();

    try {
      await resumeAudioContext();
      if (!wantsPlaybackRef.current) return;
      await audio.play();
      if (wantsPlaybackRef.current) {
        setPlaying(true);
        setIsLoading(false);
      }
    } catch (error) {
      setPlaying(false);
      setIsLoading(false);

      if (isAutoplayBlocked(error)) {
        wantsPlaybackRef.current = false;
        return;
      }

      if (wantsPlaybackRef.current) {
        recoveryAttemptRef.current += 1;
        const delay = Math.min(
          STALL_RECOVERY_DELAY_MS * 2 ** recoveryAttemptRef.current,
          MAX_RECOVERY_DELAY_MS,
        );
        recoveryTimerRef.current = setTimeout(() => {
          recoveryTimerRef.current = null;
          void restartStream(audio);
        }, delay);
      }
    }
  }, [clearRecoveryTimer, resumeAudioContext]);

  const scheduleRecovery = useCallback((delay = STALL_RECOVERY_DELAY_MS) => {
    const audio = audioRef.current;
    if (!audio || !wantsPlaybackRef.current || recoveryTimerRef.current) return;

    setIsLoading(true);
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null;
      void restartStream(audio);
    }, delay);
  }, [restartStream]);

  // ---- setup audio element (mirrors the previous player) ----
  useEffect(() => {
    if (audioRef.current || !isLoaded) return;

    const audio = new Audio();
    audioRef.current = audio;
    audio.crossOrigin = 'anonymous';
    audio.volume = volume / 100;
    audio.src = LIVE_STREAM_URL;
    audio.load();

    const handlePlaying = () => {
      clearRecoveryTimer();
      recoveryAttemptRef.current = 0;
      setPlaying(true);
      setIsLoading(false);
    };
    const handlePause = () => setPlaying(false);
    const handleError = (error: Event) => {
      console.error('Audio error:', error);
      setPlaying(false);
      setIsLoading(false);
      scheduleRecovery();
    };
    const handleLoadStart = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);
    const handleInterruption = () => scheduleRecovery();
    const handleEnded = () => scheduleRecovery(0);
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !wantsPlaybackRef.current) return;
      void resumeAudioContext();
      if (audio.paused) scheduleRecovery(0);
    };
    const handleOnline = () => scheduleRecovery(0);

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('waiting', handleInterruption);
    audio.addEventListener('stalled', handleInterruption);
    audio.addEventListener('ended', handleEnded);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    wantsPlaybackRef.current = true;
    audio.play().then(() => {
      if (wantsPlaybackRef.current) {
        setPlaying(true);
        setIsLoading(false);
      }
    }).catch((error: unknown) => {
      if (isAutoplayBlocked(error)) {
        wantsPlaybackRef.current = false;
        setIsLoading(false);
        return;
      }
      console.warn('Initial stream playback failed', error);
      scheduleRecovery();
    });

    return () => {
      wantsPlaybackRef.current = false;
      clearRecoveryTimer();
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('waiting', handleInterruption);
      audio.removeEventListener('stalled', handleInterruption);
      audio.removeEventListener('ended', handleEnded);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      sourceRef.current?.disconnect();
      const context = audioContextRef.current;
      if (context && audioContextStateHandlerRef.current) {
        context.removeEventListener('statechange', audioContextStateHandlerRef.current);
      }
      void context?.close();
      audioRef.current = null;
      sourceRef.current = null;
      audioContextRef.current = null;
      audioContextStateHandlerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, clearRecoveryTimer, resumeAudioContext, scheduleRecovery]);

  // keep element volume in sync with preferences
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      wantsPlaybackRef.current = false;
      clearRecoveryTimer();
      audio.pause();
      setIsLoading(false);
    } else {
      wantsPlaybackRef.current = true;
      initAudioContext();
      void restartStream(audio);
    }
  }, [playing, clearRecoveryTimer, initAudioContext, restartStream]);

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

  // The masthead reports the station state; the transport uses local playback.
  const onAir = syncedPlaying;

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
        />

        <div className="broadcast">
          <NowPlaying
            track={track}
            playing={playing}
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
          <Program current={currentTrack} />
          <Transmissions accent={edition.accent} />
        </div>

        <footer className="colophon">
          <div className="colo-mark">
            <span className="barcode" aria-hidden="true" />
            <span className="colo-no">{tBroadcast('footer.stamp')}</span>
          </div>
          <div className="c-left">
            {tBroadcast('footer.description')} ·{' '}
            <a
              href="https://github.com/MatheusKindrazki/lofiever"
              target="_blank"
              rel="noopener noreferrer"
            >
              {tBroadcast('footer.source')}
            </a>
          </div>
        </footer>
      </div>

      {zen && (
        <ZenBroadcast
          track={track}
          playing={playing}
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
