import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LogBox,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { calculateExpectedPosition, shouldSeekToExpectedPosition } from './playbackSync';

type QueueTrack = {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  playbackUrl?: string;
  appleTvPlaybackUrl?: string;
  duration?: number;
  mood?: string;
  genre?: string;
  origin?: string;
};

type StreamData = {
  currentSong: QueueTrack | null;
  playback?: {
    isPlaying: boolean;
    position: number;
    startedAt: number;
    serverTime: number;
  };
  daysActive?: number;
  songsPlayed?: number;
  nextUp?: QueueTrack[];
};

const DEFAULT_API_BASE_URL = 'https://app.lofiever.dev';
const API_BASE_URL = (process.env.EXPO_PUBLIC_LOFIEVER_API_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
const STREAM_METADATA_URL = `${API_BASE_URL}/api/stream`;
const STREAM_METADATA_REFRESH_MS = 5_000;
const DEFAULT_VOLUME = 0.8;
const VISUALIZER_BAR_COUNT = 28;
const PAPER = '#F2E7CE';
const PAPER_RAISED = '#EADCBD';
const INK = '#1C1813';
const INK_SOFT = '#625A4C';
const ACCENT = '#E8430F';
const ACCENT_GOLD = '#F4B41A';

if (__DEV__ && Platform.isTV) {
  LogBox.ignoreAllLogs(true);
}

function resolveAbsoluteUrl(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl).toString();
  } catch {
    return new URL(pathOrUrl.replace(/^\//, ''), `${API_BASE_URL}/`).toString();
  }
}

function resolveTvPlaybackUrl(track: QueueTrack | null): string | null {
  if (!track?.id) {
    return null;
  }

  if (track.appleTvPlaybackUrl) {
    return resolveAbsoluteUrl(track.appleTvPlaybackUrl);
  }

  if (track.playbackUrl) {
    const separator = track.playbackUrl.includes('?') ? '&' : '?';
    return resolveAbsoluteUrl(`${track.playbackUrl}${separator}platform=tvos`);
  }

  return resolveAbsoluteUrl(`/api/stream/audio/${track.id}?platform=tvos`);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat('pt-BR').format(value ?? 0);
}

function formatDuration(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return '--:--';
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function buildVisualizerBars(active: boolean) {
  const now = Date.now() / 170;

  return Array.from({ length: VISUALIZER_BAR_COUNT }, (_, index) => {
    if (!active) {
      return 0.12 + (index % 7 === 0 ? 0.08 : 0);
    }

    const pulse = Math.abs(Math.sin(now + index * 0.58));
    const sway = Math.abs(Math.cos(now * 0.55 + index * 0.27)) * 0.18;
    return clamp(Number((0.14 + pulse * 0.68 + sway).toFixed(2)), 0.12, 1);
  });
}

export default function App() {
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [playbackIntent, setPlaybackIntent] = useState(false);
  const [visualizerBars, setVisualizerBars] = useState<number[]>(() => buildVisualizerBars(false));
  const [playerFocused, setPlayerFocused] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacyButtonFocused, setPrivacyButtonFocused] = useState(false);
  const wasPlayingRef = useRef(false);
  const playbackIntentRef = useRef(false);
  const playbackClockAvailableRef = useRef(false);
  const streamSnapshotReceivedAtRef = useRef(Date.now());
  const synchronizedTrackIdRef = useRef<string | null>(null);
  const recoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFinishedTrackIdRef = useRef<string | null>(null);
  const { width, height } = useWindowDimensions();
  const compact = width < 1500 || height < 850;

  const player = useAudioPlayer(null, {
    keepAudioSessionActive: true,
    updateInterval: 500,
  });
  const playbackStatus = useAudioPlayerStatus(player);
  const playbackStatusRef = useRef(playbackStatus);

  useEffect(() => {
    void setAudioModeAsync({
      interruptionMode: 'doNotMix',
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    }).catch(() => {
      // tvOS pode recusar parte da configuração da sessão sem afetar o player.
    });
  }, []);

  useEffect(() => {
    player.volume = DEFAULT_VOLUME;
  }, [player]);

  useEffect(() => {
    wasPlayingRef.current = playbackStatus.playing;
    playbackStatusRef.current = playbackStatus;
  }, [playbackStatus]);

  useEffect(() => {
    const isActive = playbackStatus.playing || playbackStatus.timeControlStatus === 'waiting';
    setVisualizerBars(buildVisualizerBars(isActive));

    if (!isActive) {
      return;
    }

    const interval = setInterval(() => {
      setVisualizerBars(buildVisualizerBars(true));
    }, 150);

    return () => clearInterval(interval);
  }, [playbackStatus.playing, playbackStatus.timeControlStatus]);

  const loadStreamData = useCallback(async (showLoader: boolean) => {
    if (showLoader) {
      setIsLoading(true);
    }

    try {
      const response = await fetch(STREAM_METADATA_URL);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as StreamData;
      playbackClockAvailableRef.current = Boolean(data.playback);
      streamSnapshotReceivedAtRef.current = Date.now();
      setStreamData(data);
      setError(null);
      setLastUpdatedAt(
        new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    } catch (requestError) {
      console.error('Falha ao carregar a stream do Lofiever TV:', requestError);
      setError(
        'Não consegui falar com o Lofiever. Confirme se a TV consegue acessar o endereço configurado.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStreamData(true);

    const interval = setInterval(() => {
      void loadStreamData(false);
    }, STREAM_METADATA_REFRESH_MS);

    return () => clearInterval(interval);
  }, [loadStreamData]);

  const currentSong = streamData?.currentSong ?? null;
  const currentArtworkUrl = currentSong?.artworkUrl ? resolveAbsoluteUrl(currentSong.artworkUrl) : null;
  const tvPlaybackUrl = useMemo(() => resolveTvPlaybackUrl(currentSong), [currentSong]);

  useEffect(() => {
    if (!tvPlaybackUrl) {
      return;
    }

    synchronizedTrackIdRef.current = null;
    player.replace({ uri: tvPlaybackUrl });
    player.volume = DEFAULT_VOLUME;

    if (!playbackClockAvailableRef.current && (playbackIntentRef.current || wasPlayingRef.current)) {
      player.play();
    }
  }, [player, tvPlaybackUrl]);

  useEffect(() => {
    const playback = streamData?.playback;

    if (!playback || !currentSong?.id || !tvPlaybackUrl || !playbackStatus.isLoaded) {
      return;
    }

    const currentPlaybackStatus = playbackStatusRef.current;

    const expectedPosition = calculateExpectedPosition({
      duration: currentPlaybackStatus.duration || currentSong.duration,
      isPlaying: playback.isPlaying,
      position: playback.position,
      receivedAt: streamSnapshotReceivedAtRef.current,
    });
    const trackNeedsInitialSync = synchronizedTrackIdRef.current !== currentSong.id;
    const playbackDrifted = shouldSeekToExpectedPosition({
      currentPosition: currentPlaybackStatus.currentTime,
      expectedPosition,
    });

    if (!trackNeedsInitialSync && !playbackDrifted) {
      if (playbackIntent && playback.isPlaying && !currentPlaybackStatus.playing) {
        player.play();
      }
      return;
    }

    let active = true;

    void player.seekTo(expectedPosition).then(() => {
      if (!active) {
        return;
      }

      synchronizedTrackIdRef.current = currentSong.id;

      if (playbackIntentRef.current && playback.isPlaying) {
        player.play();
      }
    }).catch((syncError: unknown) => {
      if (!active) {
        return;
      }

      console.error('Falha ao sincronizar a reprodução da Apple TV:', syncError);
      setError('O áudio abriu, mas não consegui sincronizar com a transmissão ao vivo.');
    });

    return () => {
      active = false;
    };
  }, [
    currentSong?.duration,
    currentSong?.id,
    playbackIntent,
    playbackStatus.isLoaded,
    player,
    streamData?.playback,
    tvPlaybackUrl,
  ]);

  useEffect(() => {
    if (currentSong?.id !== lastFinishedTrackIdRef.current) {
      lastFinishedTrackIdRef.current = null;
    }
  }, [currentSong?.id]);

  useEffect(() => {
    if (recoveryTimeoutRef.current) {
      clearTimeout(recoveryTimeoutRef.current);
      recoveryTimeoutRef.current = null;
    }

    if (!playbackIntent || !tvPlaybackUrl) {
      return;
    }

    if (playbackStatus.playing) {
      return;
    }

    if (playbackStatus.didJustFinish && currentSong?.id) {
      if (lastFinishedTrackIdRef.current === currentSong.id) {
        return;
      }

      lastFinishedTrackIdRef.current = currentSong.id;
      void loadStreamData(false);
      recoveryTimeoutRef.current = setTimeout(() => {
        void loadStreamData(false);
      }, 2200);

      return () => {
        if (recoveryTimeoutRef.current) {
          clearTimeout(recoveryTimeoutRef.current);
          recoveryTimeoutRef.current = null;
        }
      };
    }

    if (playbackStatus.timeControlStatus === 'waiting' || playbackStatus.isBuffering) {
      recoveryTimeoutRef.current = setTimeout(() => {
        void loadStreamData(false);
        player.play();
      }, 6500);

      return () => {
        if (recoveryTimeoutRef.current) {
          clearTimeout(recoveryTimeoutRef.current);
          recoveryTimeoutRef.current = null;
        }
      };
    }

    if (playbackStatus.currentTime > 0) {
      recoveryTimeoutRef.current = setTimeout(() => {
        player.play();
      }, 1400);

      return () => {
        if (recoveryTimeoutRef.current) {
          clearTimeout(recoveryTimeoutRef.current);
          recoveryTimeoutRef.current = null;
        }
      };
    }
  }, [
    currentSong?.id,
    loadStreamData,
    playbackIntent,
    playbackStatus.currentTime,
    playbackStatus.didJustFinish,
    playbackStatus.isBuffering,
    playbackStatus.playing,
    playbackStatus.timeControlStatus,
    player,
    tvPlaybackUrl,
  ]);

  const handleTogglePlayback = useCallback(() => {
    if (API_BASE_URL.includes('app.lofiever.dev') && !currentSong?.appleTvPlaybackUrl) {
      setError('A API de produção ainda não entregou uma URL de áudio compatível com a Apple TV.');
      return;
    }

    if (!tvPlaybackUrl) {
      setError('Não existe uma faixa compatível disponível para a Apple TV agora.');
      return;
    }

    if (playbackIntent && (playbackStatus.playing || playbackStatus.timeControlStatus === 'waiting')) {
      playbackIntentRef.current = false;
      setPlaybackIntent(false);
      player.pause();
      return;
    }

    playbackIntentRef.current = true;
    setPlaybackIntent(true);
    setError(null);

    if (!streamData?.playback) {
      player.play();
    }
  }, [
    currentSong?.appleTvPlaybackUrl,
    playbackIntent,
    player,
    playbackStatus.playing,
    playbackStatus.timeControlStatus,
    streamData?.playback,
    tvPlaybackUrl,
  ]);

  const liveLabel = playbackStatus.playing
    ? 'Ao vivo'
    : playbackStatus.timeControlStatus === 'waiting'
      ? 'Conectando'
      : 'Em pausa';
  const playerHint = playbackIntent
    ? playbackStatus.playing
      ? 'Pressione OK para pausar'
      : 'A transmissão vai retomar automaticamente'
    : 'Pressione OK para ouvir';
  const editionDate = new Date()
    .toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    .replace('.', '')
    .toUpperCase();
  const nextTracks = streamData?.nextUp?.slice(0, compact ? 2 : 3) ?? [];
  const playbackDuration = playbackStatus.duration || currentSong?.duration;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View pointerEvents="none" style={styles.paperTexture}>
          <View style={[styles.textureDot, styles.textureDotOne]} />
          <View style={[styles.textureDot, styles.textureDotTwo]} />
          <View style={[styles.textureDot, styles.textureDotThree]} />
          <View style={styles.textureRule} />
        </View>

        <View style={[styles.sheet, compact ? styles.sheetCompact : null]}>
          <View style={styles.masthead}>
            <View style={styles.nameplate}>
              <Text style={[styles.wordmark, compact ? styles.wordmarkCompact : null]}>
                Lofieve<Text style={styles.wordmarkAccent}>r</Text>
              </Text>
              <Text style={styles.tagline}>Música lo-fi para foco, relaxamento e sono</Text>
            </View>

            <View style={styles.editionMark}>
              <Text style={styles.editionEyebrow}>EDIÇÃO PARA TV</Text>
              <Text style={styles.editionTitle}>TRANSMISSÃO DIÁRIA</Text>
            </View>
          </View>

          <View style={styles.dateline}>
            <View style={[styles.datelineItem, styles.datelineStatus]}>
              <View style={[styles.liveDot, playbackStatus.playing ? styles.liveDotActive : null]} />
              <Text style={styles.datelineStrong}>{liveLabel}</Text>
            </View>
            <View style={styles.datelineItem}>
              <Text style={styles.datelineText}>STREAM 24/7</Text>
            </View>
            <View style={styles.datelineItem}>
              <Text style={styles.datelineText}>LO-FI INSTRUMENTAL</Text>
            </View>
            <View style={[styles.datelineItem, styles.datelineWide]}>
              <Text style={styles.datelineStrong}>PROGRAMAÇÃO COMPARTILHADA</Text>
            </View>
            <View style={styles.datelineItem}>
              <Text style={styles.datelineText}>{editionDate}</Text>
            </View>
          </View>

          <View style={styles.broadcastGrid}>
            <Pressable
              accessibilityHint={playerHint}
              accessibilityLabel={`${liveLabel}. ${currentSong?.title ?? 'Sem faixa ativa'}. ${playerHint}`}
              accessibilityRole="button"
              hasTVPreferredFocus
              onBlur={() => setPlayerFocused(false)}
              onFocus={() => setPlayerFocused(true)}
              onPress={handleTogglePlayback}
              style={[
                styles.nowPlayingCard,
                playerFocused ? styles.nowPlayingCardFocused : null,
              ]}
            >
              <View style={styles.artworkColumn}>
                {currentArtworkUrl ? (
                  <Image
                    accessibilityLabel={`Capa de ${currentSong?.title ?? 'faixa atual'}`}
                    alt={`Capa de ${currentSong?.title ?? 'faixa atual'}`}
                    resizeMode="cover"
                    source={{ uri: currentArtworkUrl }}
                    style={styles.artwork}
                  />
                ) : (
                  <View style={[styles.artwork, styles.artworkFallback]}>
                    {isLoading ? (
                      <ActivityIndicator color={INK} size="large" />
                    ) : (
                      <>
                        <MaterialIcons color={INK} name="graphic-eq" size={compact ? 68 : 92} />
                        <Text style={styles.fallbackTitle}>LOFI</Text>
                      </>
                    )}
                  </View>
                )}

                <View style={styles.artworkCaption}>
                  <Text style={styles.artworkCaptionText}>CAPA DA TRANSMISSÃO</Text>
                  <Text style={styles.artworkCaptionText}>LOFIEVER TV</Text>
                </View>

                <View style={[styles.playStamp, playerFocused ? styles.playStampFocused : null]}>
                  <MaterialIcons
                    color="#FFF7E8"
                    name={playbackStatus.playing ? 'pause' : 'play-arrow'}
                    size={compact ? 54 : 68}
                  />
                </View>
              </View>

              <View style={[styles.trackCopy, compact ? styles.trackCopyCompact : null]}>
                <View style={styles.kickerRow}>
                  <Text style={styles.kicker}>NO AR AGORA</Text>
                  <Text style={styles.issueNumber}>EDIÇÃO 24/7</Text>
                </View>

                <View style={styles.titleRule} />

                <Text
                  numberOfLines={2}
                  style={[styles.trackTitle, compact ? styles.trackTitleCompact : null]}
                >
                  {currentSong ? currentSong.title : isLoading ? 'Sintonizando a estação' : 'Sem faixa ativa'}
                </Text>
                <Text numberOfLines={1} style={styles.trackArtist}>
                  {currentSong ? currentSong.artist : 'Lofiever'}
                </Text>

                <Text numberOfLines={2} style={styles.trackDeck}>
                  Uma seleção contínua para acompanhar o seu espaço, sem anúncios e sem interrupções.
                </Text>

                <View style={styles.visualizer}>
                  {visualizerBars.map((bar, index) => (
                    <View
                      key={index}
                      style={[
                        styles.visualizerBar,
                        {
                          height: 8 + bar * (compact ? 42 : 58),
                          opacity: 0.32 + bar * 0.68,
                        },
                      ]}
                    />
                  ))}
                </View>

                {error ? (
                  <View style={styles.inlineError}>
                    <MaterialIcons color={INK} name="warning-amber" size={22} />
                    <Text numberOfLines={2} style={styles.inlineErrorText}>{error}</Text>
                  </View>
                ) : null}

                <View style={styles.transportFooter}>
                  <View>
                    <Text style={styles.transportLabel}>{playerHint}</Text>
                    <Text style={styles.transportMeta}>
                      {formatDuration(playbackStatus.currentTime)} / {formatDuration(playbackDuration)}
                    </Text>
                  </View>
                  <View style={styles.transportState}>
                    <View style={[styles.transportDot, playbackStatus.playing ? styles.liveDotActive : null]} />
                    <Text style={styles.transportStateText}>{liveLabel.toUpperCase()}</Text>
                  </View>
                </View>
              </View>
            </Pressable>

            <View style={styles.programPanel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelHeaderTitle}>PROGRAMAÇÃO</Text>
                <Text style={styles.panelHeaderMeta}>A SEGUIR</Text>
              </View>

              <View style={styles.programBody}>
                <View style={styles.programSummary}>
                  <Text style={styles.programSummaryLabel}>TRANSMISSÃO ATUAL</Text>
                  <Text style={styles.programSummaryValue} numberOfLines={1}>
                    {currentSong?.genre || currentSong?.mood || 'Seleção lo-fi'}
                  </Text>
                </View>

                <View style={styles.programList}>
                  {nextTracks.length > 0 ? (
                    nextTracks.map((track, index) => (
                      <View key={`${track.id}-${index}`} style={styles.programRow}>
                        <Text style={styles.programIndex}>{String(index + 1).padStart(2, '0')}</Text>
                        <View style={styles.programTrack}>
                          <Text numberOfLines={1} style={styles.programTitle}>{track.title}</Text>
                          <Text numberOfLines={1} style={styles.programArtist}>{track.artist}</Text>
                        </View>
                        <Text style={styles.programDuration}>{formatDuration(track.duration)}</Text>
                      </View>
                    ))
                  ) : (
                    <View style={styles.programEmpty}>
                      <MaterialIcons color={INK_SOFT} name="schedule" size={30} />
                      <Text style={styles.programEmptyText}>
                        A próxima seleção está sendo preparada pela estação.
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.stationRule} />

                <View style={styles.stationStats}>
                  <View style={styles.statBlock}>
                    <Text style={styles.statValue}>{formatNumber(streamData?.songsPlayed)}</Text>
                    <Text style={styles.statLabel}>FAIXAS TOCADAS</Text>
                  </View>
                </View>

                <View style={styles.sharedNotice}>
                  <MaterialIcons color={INK} name="public" size={24} />
                  <Text style={styles.sharedNoticeText}>
                    Todos acompanham a mesma programação da rádio.
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.colophon}>
            <Text style={styles.colophonStrong}>LOFIEVER — RÁDIO LO-FI 24/7</Text>
            <Pressable
              accessibilityHint="Abre a política de privacidade e os canais de suporte"
              accessibilityLabel="Privacidade e suporte"
              accessibilityRole="button"
              onBlur={() => setPrivacyButtonFocused(false)}
              onFocus={() => setPrivacyButtonFocused(true)}
              onPress={() => setPrivacyOpen(true)}
              style={[
                styles.colophonAction,
                privacyButtonFocused ? styles.colophonActionFocused : null,
              ]}
            >
              <Text style={styles.colophonActionText}>PRIVACIDADE &amp; SUPORTE</Text>
            </Pressable>
            <Text style={styles.colophonText}>APPLE TV · SEM ANÚNCIOS</Text>
            <Text style={styles.colophonText}>
              {lastUpdatedAt ? `SINAL ATUALIZADO ÀS ${lastUpdatedAt}` : 'AGUARDANDO SINAL DA ESTAÇÃO'}
            </Text>
          </View>
        </View>

        <Modal
          animationType="fade"
          onRequestClose={() => setPrivacyOpen(false)}
          transparent
          visible={privacyOpen}
        >
          <View style={styles.privacyBackdrop}>
            <View style={styles.privacyCard}>
              <Text style={styles.privacyEyebrow}>INFORMAÇÕES DO APLICATIVO</Text>
              <Text style={styles.privacyTitle}>Privacidade &amp; suporte</Text>
              <Text style={styles.privacyBody}>
                O Lofiever TV não exige conta, não exibe anúncios e não rastreia você entre apps.
                A conexão transmite apenas os dados técnicos necessários para entregar o áudio,
                manter a segurança e diagnosticar falhas.
              </Text>
              <View style={styles.privacyRule} />
              <Text style={styles.privacyLink}>app.lofiever.dev/pt/privacy</Text>
              <Text style={styles.privacyLink}>app.lofiever.dev/pt/support</Text>
              <Pressable
                accessibilityLabel="Fechar informações de privacidade e suporte"
                accessibilityRole="button"
                hasTVPreferredFocus={privacyOpen}
                onPress={() => setPrivacyOpen(false)}
                style={({ focused }) => [
                  styles.privacyClose,
                  focused ? styles.privacyCloseFocused : null,
                ]}
              >
                <Text style={styles.privacyCloseText}>FECHAR</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: PAPER,
    flex: 1,
  },
  screen: {
    backgroundColor: PAPER,
    flex: 1,
    overflow: 'hidden',
  },
  paperTexture: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.28,
  },
  textureDot: {
    backgroundColor: ACCENT_GOLD,
    borderRadius: 999,
    height: 280,
    opacity: 0.13,
    position: 'absolute',
    width: 280,
  },
  textureDotOne: {
    left: -110,
    top: -100,
  },
  textureDotTwo: {
    right: -80,
    top: 260,
  },
  textureDotThree: {
    bottom: -180,
    left: '42%',
  },
  textureRule: {
    backgroundColor: INK,
    bottom: 0,
    left: '16%',
    opacity: 0.06,
    position: 'absolute',
    top: 0,
    width: 1,
  },
  sheet: {
    flex: 1,
    paddingHorizontal: 56,
    paddingVertical: 34,
  },
  sheetCompact: {
    paddingHorizontal: 36,
    paddingVertical: 22,
  },
  masthead: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  nameplate: {
    flexShrink: 1,
  },
  wordmark: {
    color: INK,
    fontSize: 88,
    fontWeight: '900',
    letterSpacing: -5,
    lineHeight: 90,
  },
  wordmarkCompact: {
    fontSize: 64,
    lineHeight: 66,
  },
  wordmarkAccent: {
    color: ACCENT,
  },
  tagline: {
    color: INK_SOFT,
    fontSize: 20,
    fontStyle: 'italic',
    marginTop: 4,
  },
  editionMark: {
    alignItems: 'flex-end',
    borderLeftColor: INK,
    borderLeftWidth: 2,
    marginBottom: 6,
    paddingLeft: 20,
  },
  editionEyebrow: {
    color: INK_SOFT,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
  },
  editionTitle: {
    color: INK,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 5,
  },
  dateline: {
    borderBottomColor: INK,
    borderBottomWidth: 1,
    borderTopColor: INK,
    borderTopWidth: 4,
    flexDirection: 'row',
    marginTop: 20,
    minHeight: 46,
  },
  datelineItem: {
    alignItems: 'center',
    borderRightColor: 'rgba(28, 24, 19, 0.22)',
    borderRightWidth: 1,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  datelineStatus: {
    flex: 0.72,
  },
  datelineWide: {
    flex: 1.35,
  },
  liveDot: {
    backgroundColor: '#857B6C',
    borderRadius: 999,
    height: 10,
    marginRight: 10,
    width: 10,
  },
  liveDotActive: {
    backgroundColor: ACCENT,
  },
  datelineText: {
    color: INK_SOFT,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  datelineStrong: {
    color: INK,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  broadcastGrid: {
    flex: 1,
    flexDirection: 'row',
    gap: 24,
    marginTop: 24,
    minHeight: 0,
  },
  nowPlayingCard: {
    backgroundColor: PAPER_RAISED,
    borderColor: INK,
    borderWidth: 3,
    flex: 1.58,
    flexDirection: 'row',
    shadowColor: INK,
    shadowOffset: { height: 8, width: 8 },
    shadowOpacity: 1,
    shadowRadius: 0,
    transform: [{ scale: 1 }],
  },
  nowPlayingCardFocused: {
    borderColor: ACCENT,
    borderWidth: 6,
    shadowColor: ACCENT,
    shadowOffset: { height: 10, width: 10 },
    transform: [{ scale: 1.012 }],
  },
  artworkColumn: {
    borderRightColor: INK,
    borderRightWidth: 3,
    position: 'relative',
    width: '43%',
  },
  artwork: {
    backgroundColor: ACCENT_GOLD,
    height: '100%',
    width: '100%',
  },
  artworkFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackTitle: {
    color: INK,
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: 8,
    marginTop: 12,
  },
  artworkCaption: {
    backgroundColor: 'rgba(28, 24, 19, 0.78)',
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: 0,
    paddingHorizontal: 12,
    paddingVertical: 9,
    position: 'absolute',
    right: 0,
  },
  artworkCaptionText: {
    color: '#FFF7E8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  playStamp: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderColor: INK,
    borderRadius: 999,
    borderWidth: 4,
    height: 116,
    justifyContent: 'center',
    position: 'absolute',
    right: -58,
    shadowColor: INK,
    shadowOffset: { height: 6, width: 6 },
    shadowOpacity: 1,
    shadowRadius: 0,
    top: '41%',
    transform: [{ rotate: '-7deg' }],
    width: 116,
    zIndex: 10,
  },
  playStampFocused: {
    backgroundColor: INK,
    borderColor: ACCENT,
  },
  trackCopy: {
    flex: 1,
    justifyContent: 'space-between',
    paddingBottom: 30,
    paddingLeft: 76,
    paddingRight: 34,
    paddingTop: 30,
  },
  trackCopyCompact: {
    paddingBottom: 20,
    paddingLeft: 66,
    paddingRight: 24,
    paddingTop: 20,
  },
  kickerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  kicker: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2.2,
  },
  issueNumber: {
    color: INK_SOFT,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  titleRule: {
    backgroundColor: INK,
    height: 2,
    marginTop: 14,
  },
  trackTitle: {
    color: INK,
    fontSize: 54,
    fontWeight: '900',
    letterSpacing: -1.8,
    lineHeight: 58,
    marginTop: 24,
  },
  trackTitleCompact: {
    fontSize: 42,
    lineHeight: 45,
    marginTop: 16,
  },
  trackArtist: {
    color: INK_SOFT,
    fontSize: 24,
    fontStyle: 'italic',
    fontWeight: '600',
    marginTop: 10,
  },
  trackDeck: {
    color: INK_SOFT,
    fontSize: 18,
    lineHeight: 25,
    marginTop: 20,
  },
  visualizer: {
    alignItems: 'flex-end',
    borderBottomColor: INK,
    borderBottomWidth: 2,
    flexDirection: 'row',
    gap: 6,
    height: 78,
    marginTop: 18,
    overflow: 'hidden',
    paddingHorizontal: 3,
  },
  visualizerBar: {
    backgroundColor: INK,
    flex: 1,
    maxWidth: 9,
    minWidth: 3,
  },
  inlineError: {
    alignItems: 'center',
    backgroundColor: '#F4B41A',
    borderColor: INK,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineErrorText: {
    color: INK,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  transportFooter: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  transportLabel: {
    color: INK,
    fontSize: 15,
    fontWeight: '800',
  },
  transportMeta: {
    color: INK_SOFT,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    marginTop: 5,
  },
  transportState: {
    alignItems: 'center',
    borderColor: INK,
    borderWidth: 2,
    flexDirection: 'row',
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  transportDot: {
    backgroundColor: '#857B6C',
    borderRadius: 999,
    height: 8,
    marginRight: 8,
    width: 8,
  },
  transportStateText: {
    color: INK,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  programPanel: {
    backgroundColor: PAPER_RAISED,
    borderColor: INK,
    borderWidth: 3,
    flex: 0.72,
    shadowColor: INK,
    shadowOffset: { height: 8, width: 8 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  panelHeader: {
    alignItems: 'center',
    backgroundColor: INK,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  panelHeaderTitle: {
    color: PAPER,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2.1,
  },
  panelHeaderMeta: {
    color: '#C8BFAF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  programBody: {
    flex: 1,
    padding: 22,
  },
  programSummary: {
    borderBottomColor: INK,
    borderBottomWidth: 2,
    paddingBottom: 16,
  },
  programSummaryLabel: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.7,
  },
  programSummaryValue: {
    color: INK,
    fontSize: 25,
    fontWeight: '900',
    marginTop: 7,
    textTransform: 'capitalize',
  },
  programList: {
    flex: 1,
    justifyContent: 'center',
  },
  programRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(28, 24, 19, 0.22)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 82,
    paddingVertical: 12,
  },
  programIndex: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '900',
    marginRight: 14,
    width: 24,
  },
  programTrack: {
    flex: 1,
  },
  programTitle: {
    color: INK,
    fontSize: 17,
    fontWeight: '800',
  },
  programArtist: {
    color: INK_SOFT,
    fontSize: 14,
    marginTop: 5,
  },
  programDuration: {
    color: INK_SOFT,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginLeft: 10,
  },
  programEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  programEmptyText: {
    color: INK_SOFT,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 12,
    textAlign: 'center',
  },
  stationRule: {
    backgroundColor: INK,
    height: 2,
  },
  stationStats: {
    flexDirection: 'row',
    paddingVertical: 18,
  },
  statBlock: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    color: INK,
    fontSize: 28,
    fontWeight: '900',
  },
  statLabel: {
    color: INK_SOFT,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginTop: 4,
  },
  sharedNotice: {
    alignItems: 'center',
    backgroundColor: ACCENT_GOLD,
    borderColor: INK,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sharedNoticeText: {
    color: INK,
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  colophon: {
    alignItems: 'center',
    borderTopColor: INK,
    borderTopWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    paddingTop: 13,
  },
  colophonStrong: {
    color: INK,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  colophonText: {
    color: INK_SOFT,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  colophonAction: {
    borderColor: 'transparent',
    borderWidth: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  colophonActionFocused: {
    backgroundColor: ACCENT,
    borderColor: INK,
  },
  colophonActionText: {
    color: INK,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  privacyBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(28, 24, 19, 0.86)',
    flex: 1,
    justifyContent: 'center',
    padding: 80,
  },
  privacyCard: {
    backgroundColor: PAPER,
    borderColor: INK,
    borderWidth: 5,
    maxWidth: 980,
    paddingHorizontal: 62,
    paddingVertical: 48,
    shadowColor: ACCENT,
    shadowOffset: { height: 14, width: 14 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: '100%',
  },
  privacyEyebrow: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2.2,
  },
  privacyTitle: {
    color: INK,
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: -1.4,
    marginTop: 8,
  },
  privacyBody: {
    color: INK_SOFT,
    fontSize: 22,
    lineHeight: 32,
    marginTop: 24,
  },
  privacyRule: {
    backgroundColor: INK,
    height: 3,
    marginVertical: 28,
  },
  privacyLink: {
    color: INK,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: 8,
  },
  privacyClose: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: INK,
    borderColor: INK,
    borderWidth: 4,
    marginTop: 34,
    minWidth: 190,
    paddingHorizontal: 28,
    paddingVertical: 15,
  },
  privacyCloseFocused: {
    backgroundColor: ACCENT,
    borderColor: ACCENT_GOLD,
    transform: [{ scale: 1.04 }],
  },
  privacyCloseText: {
    color: '#FFF7E8',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 2,
  },
});
