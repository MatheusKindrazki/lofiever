import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  ImageBackground,
  LogBox,
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
import { LinearGradient } from 'expo-linear-gradient';

type QueueTrack = {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  playbackUrl?: string;
  appleTvPlaybackUrl?: string;
};

type StreamData = {
  currentSong: QueueTrack | null;
  listeners: number;
};

type BackgroundSpark = {
  top: `${number}%`;
  size: number;
  opacity: number;
  left?: `${number}%`;
  right?: `${number}%`;
};

const DEFAULT_API_BASE_URL = 'http://localhost:3000';
const API_BASE_URL = (process.env.EXPO_PUBLIC_LOFIEVER_API_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
const STREAM_METADATA_URL = `${API_BASE_URL}/api/stream`;
const DEFAULT_VOLUME = 0.8;
const VISUALIZER_BAR_COUNT = 34;
const BACKGROUND_SPARKS: BackgroundSpark[] = [
  { top: '18%', left: '12%', size: 5, opacity: 0.5 },
  { top: '24%', right: '18%', size: 4, opacity: 0.36 },
  { top: '31%', left: '74%', size: 6, opacity: 0.22 },
  { top: '56%', left: '11%', size: 3, opacity: 0.32 },
  { top: '62%', right: '14%', size: 4, opacity: 0.28 },
  { top: '72%', left: '26%', size: 5, opacity: 0.26 },
];

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
  return `${value ?? 0}`;
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
  const wasPlayingRef = useRef(false);
  const recoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFinishedTrackIdRef = useRef<string | null>(null);
  const glowPulse = useRef(new Animated.Value(0)).current;
  const ringRotation = useRef(new Animated.Value(0)).current;
  const ambientDrift = useRef(new Animated.Value(0)).current;

  const { width, height } = useWindowDimensions();

  const player = useAudioPlayer(null, {
    keepAudioSessionActive: true,
    updateInterval: 500,
  });
  const playbackStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    void setAudioModeAsync({
      interruptionMode: 'doNotMix',
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    }).catch(() => {
      // tvOS pode recusar parte da configuracao da sessao sem afetar o player.
    });
  }, []);

  useEffect(() => {
    player.volume = DEFAULT_VOLUME;
  }, [player]);

  useEffect(() => {
    wasPlayingRef.current = playbackStatus.playing;
  }, [playbackStatus.playing]);

  useEffect(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, {
          duration: 3200,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(glowPulse, {
          duration: 3200,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );

    const ringAnimation = Animated.loop(
      Animated.timing(ringRotation, {
        duration: 20000,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      })
    );

    const ambientAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(ambientDrift, {
          duration: 5400,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(ambientDrift, {
          duration: 5400,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );

    pulseAnimation.start();
    ringAnimation.start();
    ambientAnimation.start();

    return () => {
      pulseAnimation.stop();
      ringAnimation.stop();
      ambientAnimation.stop();
    };
  }, [ambientDrift, glowPulse, ringRotation]);

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

  const loadStreamData = useCallback(
    async (showLoader: boolean) => {
      if (showLoader) {
        setIsLoading(true);
      }

      try {
        const response = await fetch(STREAM_METADATA_URL);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = (await response.json()) as StreamData;
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
          'Nao consegui falar com o backend do Lofiever. Confirme se o app web esta rodando e se a TV consegue acessar essa URL.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadStreamData(true);

    const interval = setInterval(() => {
      void loadStreamData(false);
    }, 15000);

    return () => clearInterval(interval);
  }, [loadStreamData]);

  const currentSong = streamData?.currentSong ?? null;
  const currentArtworkUrl = currentSong?.artworkUrl ? resolveAbsoluteUrl(currentSong.artworkUrl) : null;
  const tvPlaybackUrl = useMemo(() => resolveTvPlaybackUrl(currentSong), [currentSong]);

  useEffect(() => {
    if (!tvPlaybackUrl) {
      return;
    }

    player.replace({ uri: tvPlaybackUrl });
    player.volume = DEFAULT_VOLUME;

    if (playbackIntent || wasPlayingRef.current) {
      player.play();
    }
  }, [playbackIntent, player, tvPlaybackUrl]);

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
      setError(
        'A API de producao ainda nao foi atualizada para tvOS. Ela entrega metadata, mas ainda nao entrega a URL MP3 assinada da faixa atual para a Apple TV.'
      );
      return;
    }

    if (!tvPlaybackUrl) {
      setError('Nao existe uma URL de playback compativel para a faixa atual na Apple TV.');
      return;
    }

    if (playbackIntent && (playbackStatus.playing || playbackStatus.timeControlStatus === 'waiting')) {
      setPlaybackIntent(false);
      player.pause();
      return;
    }

    setPlaybackIntent(true);
    setError(null);
    player.play();
  }, [
    currentSong?.appleTvPlaybackUrl,
    playbackIntent,
    player,
    playbackStatus.playing,
    playbackStatus.timeControlStatus,
    tvPlaybackUrl,
  ]);

  const liveLabel = playbackStatus.playing
    ? 'ao vivo'
    : playbackStatus.timeControlStatus === 'waiting'
      ? 'conectando'
      : 'em pausa';
  const playerHint = playbackIntent
    ? playbackStatus.playing
      ? 'Clique no player para pausar'
      : 'O player vai tentar retomar sozinho'
    : 'Clique no player para tocar';
  const artworkSize = Math.round(Math.min(width * 0.28, height * 0.42, 430));
  const curtainWidth = Math.round(Math.min(width * 0.24, 360));
  const curtainHeight = Math.round(height * 0.94);
  const rippleOuterSize = Math.round(Math.min(width * 0.64, 920));
  const rippleInnerSize = Math.round(rippleOuterSize * 0.74);
  const horizonWidth = Math.round(Math.min(width * 0.78, 1380));
  const glowScale = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1.08],
  });
  const glowOpacity = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 0.42],
  });
  const rotatingRing = ringRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const curtainTranslateX = ambientDrift.interpolate({
    inputRange: [0, 1],
    outputRange: [-22, 18],
  });
  const curtainTranslateY = ambientDrift.interpolate({
    inputRange: [0, 1],
    outputRange: [-34, 24],
  });
  const curtainReverseX = ambientDrift.interpolate({
    inputRange: [0, 1],
    outputRange: [28, -16],
  });
  const curtainReverseY = ambientDrift.interpolate({
    inputRange: [0, 1],
    outputRange: [22, -24],
  });
  const curtainScale = ambientDrift.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.05],
  });
  const curtainOpacity = ambientDrift.interpolate({
    inputRange: [0, 1],
    outputRange: [0.34, 0.52],
  });
  const ribbonOpacity = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.16, 0.28],
  });
  const rippleInnerScale = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1.03],
  });
  const rippleOuterScale = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1.02, 1.12],
  });
  const horizonOpacity = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.24, 0.42],
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        {currentArtworkUrl ? (
          <ImageBackground
            blurRadius={36}
            imageStyle={styles.backdropImage}
            source={{ uri: currentArtworkUrl }}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.backdropFallback]} />
        )}

        <View style={[StyleSheet.absoluteFill, styles.backdropShade]} />
        <View style={[StyleSheet.absoluteFill, styles.backdropTint]} />

        <View pointerEvents="none" style={styles.backgroundAtmosphere}>
          <Animated.View
            style={[
              styles.lightCurtain,
              {
                height: curtainHeight,
                left: width * 0.12,
                top: -height * 0.06,
                transform: [
                  { translateX: curtainTranslateX },
                  { translateY: curtainTranslateY },
                  { rotate: '-18deg' },
                  { scaleY: curtainScale },
                ],
                width: curtainWidth,
              },
            ]}
          >
            <LinearGradient
              colors={[
                'rgba(76, 234, 214, 0)',
                'rgba(76, 234, 214, 0.24)',
                'rgba(97, 163, 233, 0.16)',
                'rgba(76, 234, 214, 0)',
              ]}
              end={{ x: 0.5, y: 1 }}
              start={{ x: 0.5, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.lightCurtain,
              {
                height: curtainHeight * 0.9,
                left: width * 0.5 - curtainWidth * 0.46,
                opacity: curtainOpacity,
                top: height * 0.03,
                transform: [
                  { translateY: curtainReverseY },
                  { rotate: '8deg' },
                  { scaleY: curtainScale },
                ],
                width: curtainWidth * 0.92,
              },
            ]}
          >
            <LinearGradient
              colors={[
                'rgba(84, 132, 235, 0)',
                'rgba(84, 132, 235, 0.14)',
                'rgba(129, 225, 214, 0.24)',
                'rgba(84, 132, 235, 0)',
              ]}
              end={{ x: 0.5, y: 1 }}
              start={{ x: 0.5, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.lightCurtain,
              {
                height: curtainHeight * 0.88,
                right: width * 0.11,
                top: -height * 0.04,
                transform: [
                  { translateX: curtainReverseX },
                  { translateY: curtainReverseY },
                  { rotate: '18deg' },
                  { scaleY: curtainScale },
                ],
                width: curtainWidth * 0.88,
              },
            ]}
          >
            <LinearGradient
              colors={[
                'rgba(255, 158, 107, 0)',
                'rgba(255, 158, 107, 0.18)',
                'rgba(255, 208, 153, 0.1)',
                'rgba(255, 158, 107, 0)',
              ]}
              end={{ x: 0.5, y: 1 }}
              start={{ x: 0.5, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.soundRipple,
              {
                borderRadius: rippleOuterSize / 2,
                height: rippleOuterSize,
                opacity: ribbonOpacity,
                transform: [{ scale: rippleOuterScale }],
                width: rippleOuterSize,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.soundRipple,
              styles.soundRippleInner,
              {
                borderRadius: rippleInnerSize / 2,
                height: rippleInnerSize,
                opacity: glowOpacity,
                transform: [{ scale: rippleInnerScale }],
                width: rippleInnerSize,
              },
            ]}
          />

          <Animated.View
            style={[
              styles.horizonGlow,
              {
                opacity: horizonOpacity,
                top: height * 0.62,
                width: horizonWidth,
              },
            ]}
          >
            <LinearGradient
              colors={[
                'rgba(0, 0, 0, 0)',
                'rgba(92, 232, 214, 0.1)',
                'rgba(132, 190, 255, 0.26)',
                'rgba(255, 178, 133, 0.12)',
                'rgba(0, 0, 0, 0)',
              ]}
              end={{ x: 1, y: 0.5 }}
              start={{ x: 0, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          {BACKGROUND_SPARKS.map((spark, index) => (
            <Animated.View
              key={index}
              style={[
                styles.backgroundSpark,
                {
                  height: spark.size,
                  left: spark.left,
                  opacity: spark.opacity,
                  right: spark.right,
                  top: spark.top,
                  transform: [{ scale: glowScale }],
                  width: spark.size,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.chrome}>
          {error ? (
            <View style={styles.errorBanner}>
              <MaterialIcons color="#ffc0b2" name="warning-amber" size={22} />
              <Text numberOfLines={2} style={styles.errorBannerText}>
                {error}
              </Text>
            </View>
          ) : null}

          <View style={styles.centerStage}>
            <Text style={styles.brand}>LOFIEVER</Text>
            <Text style={styles.brandSubcopy}>apple tv fullscreen player</Text>

            <Pressable
              hasTVPreferredFocus
              onBlur={() => setPlayerFocused(false)}
              onFocus={() => setPlayerFocused(true)}
              onPress={handleTogglePlayback}
              style={[
                styles.playerCard,
                playerFocused ? styles.playerCardFocused : null,
              ]}
            >
              <Animated.View
                style={[
                  styles.artGlow,
                  {
                    borderRadius: (artworkSize + 120) / 2,
                    height: artworkSize + 120,
                    opacity: glowOpacity,
                    transform: [{ scale: glowScale }],
                    width: artworkSize + 120,
                  },
                ]}
              />

              <Animated.View
                style={[
                  styles.artRing,
                  {
                    borderRadius: (artworkSize + 34) / 2,
                    height: artworkSize + 34,
                    transform: [{ rotate: rotatingRing }],
                    width: artworkSize + 34,
                  },
                ]}
              />

              <View
                style={[
                  styles.playerSurface,
                  {
                    borderRadius: 36,
                    height: artworkSize + 10,
                    width: artworkSize + 10,
                  },
                ]}
              >
                {currentArtworkUrl ? (
                  <Image
                    resizeMode="cover"
                    source={{ uri: currentArtworkUrl }}
                    style={[
                      styles.stageArtwork,
                      {
                        borderRadius: 31,
                        height: artworkSize,
                        width: artworkSize,
                      },
                    ]}
                  />
                ) : (
                  <View
                    style={[
                      styles.stageArtwork,
                      styles.stageArtworkFallback,
                      {
                        borderRadius: 31,
                        height: artworkSize,
                        width: artworkSize,
                      },
                    ]}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#f4efe6" size="large" />
                    ) : (
                      <>
                        <MaterialIcons color="#8fe1d5" name="graphic-eq" size={72} />
                        <Text style={styles.stageArtworkFallbackLabel}>LOFI</Text>
                      </>
                    )}
                  </View>
                )}

                <View style={styles.playerOverlayTop}>
                  <View style={styles.liveChip}>
                    <View style={[styles.liveChipDot, playbackStatus.playing ? styles.liveChipDotOn : null]} />
                    <Text style={styles.liveChipText}>{liveLabel}</Text>
                  </View>
                </View>

                <View style={styles.playerOverlayBottom}>
                  <View style={styles.playIconShell}>
                    <MaterialIcons
                      color="#071018"
                      name={playbackStatus.playing ? 'pause' : 'play-arrow'}
                      size={52}
                    />
                  </View>
                </View>
              </View>
            </Pressable>

            <Text numberOfLines={2} style={styles.trackTitle}>
              {currentSong ? currentSong.title : isLoading ? 'Carregando a programacao...' : 'Sem faixa ativa'}
            </Text>
            <Text numberOfLines={1} style={styles.trackArtist}>
              {currentSong ? currentSong.artist : 'Assim que a API responder, o player entra no ar.'}
            </Text>

            <View style={styles.visualizerShell}>
              <View style={styles.visualizerRow}>
                {visualizerBars.map((bar, index) => (
                  <View
                    key={index}
                    style={[
                      styles.visualizerBar,
                      {
                        height: 18 + bar * 86,
                        opacity: 0.28 + bar * 0.6,
                      },
                    ]}
                  />
                ))}
              </View>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{formatNumber(streamData?.listeners)} ouvintes</Text>
              {lastUpdatedAt ? <Text style={styles.metaText}>atualizado {lastUpdatedAt}</Text> : null}
            </View>

            <Text style={styles.playerHint}>{playerHint}</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#040913',
  },
  screen: {
    flex: 1,
    backgroundColor: '#040913',
    overflow: 'hidden',
  },
  backdropImage: {
    opacity: 0.28,
  },
  backdropFallback: {
    backgroundColor: '#08111d',
  },
  backdropShade: {
    backgroundColor: 'rgba(2, 5, 9, 0.64)',
  },
  backdropTint: {
    backgroundColor: 'rgba(7, 12, 20, 0.54)',
  },
  backgroundAtmosphere: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightCurtain: {
    borderRadius: 999,
    overflow: 'hidden',
    position: 'absolute',
  },
  soundRipple: {
    borderColor: 'rgba(159, 240, 229, 0.14)',
    borderWidth: 1,
    position: 'absolute',
  },
  soundRippleInner: {
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  horizonGlow: {
    borderRadius: 999,
    height: 140,
    overflow: 'hidden',
    position: 'absolute',
  },
  backgroundSpark: {
    backgroundColor: '#dffaf5',
    borderRadius: 999,
    position: 'absolute',
  },
  chrome: {
    flex: 1,
    paddingHorizontal: 64,
    paddingVertical: 40,
  },
  errorBanner: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(84, 22, 14, 0.72)',
    borderColor: 'rgba(255, 176, 156, 0.22)',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 4,
    maxWidth: 980,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  errorBannerText: {
    color: '#ffd7cd',
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    marginLeft: 12,
  },
  centerStage: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  brand: {
    color: '#f4efe6',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 6,
  },
  brandSubcopy: {
    color: '#8fa3b1',
    fontSize: 13,
    letterSpacing: 1.8,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  playerCard: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 34,
    minHeight: 420,
    minWidth: 420,
    transform: [{ scale: 1 }],
  },
  playerCardFocused: {
    transform: [{ scale: 1.04 }],
  },
  artGlow: {
    backgroundColor: 'rgba(119, 229, 213, 0.34)',
    position: 'absolute',
  },
  artRing: {
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderStyle: 'dashed',
    borderWidth: 2,
    position: 'absolute',
  },
  playerSurface: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.35,
    shadowRadius: 38,
  },
  stageArtwork: {
    backgroundColor: '#102131',
  },
  stageArtworkFallback: {
    alignItems: 'center',
    borderColor: 'rgba(143, 225, 213, 0.28)',
    borderWidth: 1,
    justifyContent: 'center',
  },
  stageArtworkFallbackLabel: {
    color: '#95efe1',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 7,
    marginTop: 10,
  },
  playerOverlayTop: {
    left: 22,
    position: 'absolute',
    top: 22,
  },
  playerOverlayBottom: {
    bottom: 22,
    position: 'absolute',
    right: 22,
  },
  liveChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(7, 14, 22, 0.76)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  liveChipDot: {
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    borderRadius: 999,
    height: 9,
    marginRight: 8,
    width: 9,
  },
  liveChipDotOn: {
    backgroundColor: '#67e0c2',
  },
  liveChipText: {
    color: '#f0f6f8',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  playIconShell: {
    alignItems: 'center',
    backgroundColor: '#86e2d4',
    borderRadius: 999,
    height: 86,
    justifyContent: 'center',
    width: 86,
  },
  trackTitle: {
    color: '#f7f2e9',
    fontSize: 56,
    fontWeight: '800',
    letterSpacing: -1.3,
    lineHeight: 62,
    marginTop: 28,
    maxWidth: 980,
    textAlign: 'center',
  },
  trackArtist: {
    color: '#c3d0d8',
    fontSize: 24,
    fontWeight: '500',
    marginTop: 12,
    textAlign: 'center',
  },
  visualizerShell: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 30,
    paddingHorizontal: 22,
    paddingVertical: 18,
    width: 720,
  },
  visualizerRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    height: 112,
    justifyContent: 'space-between',
    width: '100%',
  },
  visualizerBar: {
    backgroundColor: '#dffaf5',
    borderRadius: 999,
    width: 8,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 22,
  },
  metaText: {
    color: '#b8c6cf',
    fontSize: 17,
    marginHorizontal: 12,
  },
  playerHint: {
    color: '#8fa3b1',
    fontSize: 16,
    marginTop: 18,
    textAlign: 'center',
  },
});
