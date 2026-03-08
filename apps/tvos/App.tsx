import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

type QueueTrack = {
  id: string;
  title: string;
  artist: string;
  duration?: number;
  artworkUrl?: string;
  sourceType?: string;
  sourceId?: string;
  streamUrl?: string;
  playbackUrl?: string;
  appleTvPlaybackUrl?: string;
};

type StreamData = {
  currentSong: QueueTrack | null;
  listeners: number;
  daysActive?: number;
  songsPlayed?: number;
  nextUp: QueueTrack[];
};

const DEFAULT_API_BASE_URL = 'http://localhost:3000';
const API_BASE_URL = (process.env.EXPO_PUBLIC_LOFIEVER_API_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
const STREAM_METADATA_URL = `${API_BASE_URL}/api/stream`;

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

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return '--';

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

type TvActionButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  hasTVPreferredFocus?: boolean;
};

function TvActionButton({
  label,
  onPress,
  variant = 'secondary',
  hasTVPreferredFocus = false,
}: TvActionButtonProps) {
  const [focused, setFocused] = useState(false);
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={[
        styles.actionButton,
        isPrimary ? styles.actionButtonPrimary : styles.actionButtonSecondary,
        focused ? styles.actionButtonFocused : null,
      ]}
    >
      <Text
        style={[
          styles.actionButtonLabel,
          isPrimary ? styles.actionButtonLabelPrimary : styles.actionButtonLabelSecondary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function App() {
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8);
  const wasPlayingRef = useRef(false);

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
    }).catch((audioModeError) => {
      console.warn('Falha ao configurar a sessão de áudio:', audioModeError);
    });
  }, []);

  useEffect(() => {
    player.volume = volume;
  }, [player, volume]);

  useEffect(() => {
    wasPlayingRef.current = playbackStatus.playing;
  }, [playbackStatus.playing]);

  const loadStreamData = useCallback(
    async (showLoader: boolean) => {
      if (showLoader) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
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
        setIsRefreshing(false);
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
  const nextTracks = streamData?.nextUp ?? [];
  const tvPlaybackUrl = useMemo(() => resolveTvPlaybackUrl(currentSong), [currentSong]);
  const connectionModeMessage =
    API_BASE_URL === DEFAULT_API_BASE_URL
      ? 'Modo simulador: localhost funciona no Apple TV Simulator. Em Apple TV fisica, troque para o IP da sua maquina.'
      : `Conectando em ${API_BASE_URL}`;

  const playbackModeMessage = useMemo(() => {
    if (!currentSong) {
      return 'Sem faixa atual para a TV resolver.';
    }

    if (currentSong.appleTvPlaybackUrl) {
      return 'TV usando a URL compativel exposta pelo backend.';
    }

    if (API_BASE_URL.includes('app.lofiever.dev')) {
      return 'A API de producao ainda precisa expor a URL de playback tvOS para tocar a faixa atual.';
    }

    return 'TV usando a rota de fallback por faixa atual.';
  }, [currentSong, API_BASE_URL]);

  useEffect(() => {
    if (!tvPlaybackUrl) {
      return;
    }

    const shouldResume = wasPlayingRef.current;
    player.replace({ uri: tvPlaybackUrl });
    player.volume = volume;

    if (shouldResume) {
      player.play();
    }
  }, [player, tvPlaybackUrl, volume]);

  const playbackLabel = useMemo(() => {
    if (playbackStatus.playing) {
      return 'Pausar radio';
    }

    if (playbackStatus.timeControlStatus === 'waiting') {
      return 'Conectando...';
    }

    return 'Tocar radio';
  }, [playbackStatus.playing, playbackStatus.timeControlStatus]);

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

    if (playbackStatus.playing) {
      player.pause();
      return;
    }

    setError(null);
    player.play();
  }, [currentSong?.appleTvPlaybackUrl, player, playbackStatus.playing, tvPlaybackUrl]);

  const handleVolumeChange = useCallback((delta: number) => {
    setVolume((currentVolume) => clamp(Number((currentVolume + delta).toFixed(2)), 0.1, 1));
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>LOFIEVER TV</Text>
        <Text style={styles.tagline}>Apple TV app conectada ao backend atual do projeto</Text>

        <View style={styles.statusBar}>
          <View style={styles.statusPill}>
            <View style={[styles.statusDot, error ? styles.statusDotError : styles.statusDotSuccess]} />
            <Text style={styles.statusPillText}>{error ? 'Backend offline' : 'Backend conectado'}</Text>
          </View>
          <Text style={styles.statusBarText}>{connectionModeMessage}</Text>
          <Text style={styles.statusBarText}>{playbackModeMessage}</Text>
          {lastUpdatedAt ? <Text style={styles.statusBarText}>Atualizado as {lastUpdatedAt}</Text> : null}
        </View>

        <View style={styles.grid}>
          <View style={[styles.panel, styles.heroPanel]}>
            <Text style={styles.sectionEyebrow}>ON AIR</Text>
            <Text style={styles.sectionTitle}>
              {currentSong ? currentSong.title : isLoading ? 'Carregando a programacao...' : 'Sem faixa ativa'}
            </Text>
            <Text style={styles.sectionSubtitle}>
              {currentSong ? currentSong.artist : 'Assim que o backend responder, a capa e a fila aparecem aqui.'}
            </Text>

            {currentSong?.artworkUrl ? (
              <Image source={{ uri: currentSong.artworkUrl }} style={styles.artwork} />
            ) : (
              <View style={[styles.artwork, styles.artworkFallback]}>
                {isLoading ? <ActivityIndicator color="#f4efe6" size="large" /> : <Text style={styles.artworkFallbackText}>LOFI</Text>}
              </View>
            )}

            <View style={styles.metricRow}>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{formatNumber(streamData?.listeners)}</Text>
                <Text style={styles.metricLabel}>ouvintes</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{formatNumber(streamData?.daysActive)}</Text>
                <Text style={styles.metricLabel}>dias ativa</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{formatNumber(streamData?.songsPlayed)}</Text>
                <Text style={styles.metricLabel}>faixas tocadas</Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              <TvActionButton
                hasTVPreferredFocus
                label={playbackLabel}
                onPress={handleTogglePlayback}
                variant="primary"
              />
              <TvActionButton
                label={isRefreshing ? 'Atualizando...' : 'Atualizar dados'}
                onPress={() => {
                  void loadStreamData(false);
                }}
              />
              <TvActionButton label="Volume -" onPress={() => handleVolumeChange(-0.1)} />
              <TvActionButton label="Volume +" onPress={() => handleVolumeChange(0.1)} />
            </View>

            <Text style={styles.playerHint}>
              Volume atual: {Math.round(volume * 100)}% · {playbackStatus.playing ? 'tocando agora' : 'aguardando comando'}
            </Text>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>

          <View style={styles.sideColumn}>
            <View style={styles.panel}>
              <Text style={styles.sectionEyebrow}>QUEUE</Text>
              <Text style={styles.sideTitle}>Proximas faixas</Text>

              {nextTracks.length === 0 ? (
                <Text style={styles.emptyText}>A fila ainda nao apareceu. Quando a API responder, ela entra aqui.</Text>
              ) : (
                nextTracks.slice(0, 5).map((track, index) => (
                  <View key={`${track.id}-${index}`} style={styles.queueItem}>
                    <Text style={styles.queueIndex}>{String(index + 1).padStart(2, '0')}</Text>
                    <View style={styles.queueCopy}>
                      <Text style={styles.queueTitle} numberOfLines={1}>
                        {track.title}
                      </Text>
                      <Text style={styles.queueArtist} numberOfLines={1}>
                        {track.artist} · {formatDuration(track.duration)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <View style={styles.panel}>
              <Text style={styles.sectionEyebrow}>SETUP</Text>
              <Text style={styles.sideTitle}>Como ligar na TV</Text>
              <Text style={styles.setupText}>1. Rode o backend web do Lofiever na sua maquina.</Text>
              <Text style={styles.setupText}>2. No simulador Apple TV, `localhost` funciona por padrao.</Text>
              <Text style={styles.setupText}>
                3. Na Apple TV fisica, use `EXPO_PUBLIC_LOFIEVER_API_URL=http://SEU-IP:3000`.
              </Text>
              <Text style={styles.setupText}>4. Gere o projeto nativo com `npm run prebuild:tv` e abra no Xcode.</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#07111a',
  },
  content: {
    minHeight: '100%',
    paddingHorizontal: 72,
    paddingVertical: 48,
  },
  brand: {
    color: '#f7f3ea',
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: 6,
  },
  tagline: {
    color: '#9ab4b9',
    fontSize: 20,
    marginTop: 10,
  },
  statusBar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 28,
  },
  statusPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(244, 239, 230, 0.08)',
    borderColor: 'rgba(244, 239, 230, 0.12)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    marginRight: 18,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  statusDot: {
    borderRadius: 999,
    height: 10,
    marginRight: 10,
    width: 10,
  },
  statusDotSuccess: {
    backgroundColor: '#59d98e',
  },
  statusDotError: {
    backgroundColor: '#ff826a',
  },
  statusPillText: {
    color: '#f7f3ea',
    fontSize: 16,
    fontWeight: '700',
  },
  statusBarText: {
    color: '#8ca2ad',
    fontSize: 15,
    marginBottom: 8,
    marginRight: 18,
  },
  grid: {
    flexDirection: 'row',
    marginTop: 24,
  },
  heroPanel: {
    marginRight: 24,
    minHeight: 760,
    width: '62%',
  },
  sideColumn: {
    width: '38%',
  },
  panel: {
    backgroundColor: 'rgba(9, 23, 33, 0.92)',
    borderColor: 'rgba(111, 168, 176, 0.22)',
    borderRadius: 34,
    borderWidth: 1,
    padding: 28,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 22 },
    shadowOpacity: 0.28,
    shadowRadius: 36,
  },
  sectionEyebrow: {
    color: '#7dd0c6',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2.4,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#f6f1e8',
    fontSize: 42,
    fontWeight: '800',
    lineHeight: 50,
  },
  sectionSubtitle: {
    color: '#9bb1b8',
    fontSize: 18,
    lineHeight: 26,
    marginTop: 12,
  },
  artwork: {
    backgroundColor: '#10202c',
    borderRadius: 28,
    height: 360,
    marginTop: 28,
    width: '100%',
  },
  artworkFallback: {
    alignItems: 'center',
    borderColor: 'rgba(125, 208, 198, 0.25)',
    borderWidth: 1,
    justifyContent: 'center',
  },
  artworkFallbackText: {
    color: '#7dd0c6',
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: 8,
  },
  metricRow: {
    flexDirection: 'row',
    marginTop: 24,
  },
  metricCard: {
    backgroundColor: 'rgba(244, 239, 230, 0.05)',
    borderRadius: 22,
    marginRight: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
    width: 170,
  },
  metricValue: {
    color: '#f7f3ea',
    fontSize: 30,
    fontWeight: '800',
  },
  metricLabel: {
    color: '#93a6ad',
    fontSize: 15,
    marginTop: 6,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 28,
  },
  actionButton: {
    borderRadius: 20,
    borderWidth: 2,
    marginBottom: 12,
    marginRight: 12,
    paddingHorizontal: 22,
    paddingVertical: 18,
    transform: [{ scale: 1 }],
  },
  actionButtonPrimary: {
    backgroundColor: '#7dd0c6',
    borderColor: '#7dd0c6',
  },
  actionButtonSecondary: {
    backgroundColor: 'rgba(244, 239, 230, 0.05)',
    borderColor: 'rgba(244, 239, 230, 0.12)',
  },
  actionButtonFocused: {
    borderColor: '#f7f3ea',
    shadowColor: '#7dd0c6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
    transform: [{ scale: 1.04 }],
  },
  actionButtonLabel: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  actionButtonLabelPrimary: {
    color: '#041018',
  },
  actionButtonLabelSecondary: {
    color: '#f7f3ea',
  },
  playerHint: {
    color: '#8da1aa',
    fontSize: 15,
    marginTop: 8,
  },
  errorText: {
    color: '#ff9c8b',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 20,
  },
  sideTitle: {
    color: '#f7f3ea',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 18,
  },
  emptyText: {
    color: '#8da1aa',
    fontSize: 17,
    lineHeight: 24,
  },
  queueItem: {
    alignItems: 'center',
    borderBottomColor: 'rgba(244, 239, 230, 0.08)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: 16,
  },
  queueIndex: {
    color: '#7dd0c6',
    fontSize: 18,
    fontWeight: '800',
    width: 44,
  },
  queueCopy: {
    flex: 1,
  },
  queueTitle: {
    color: '#f7f3ea',
    fontSize: 20,
    fontWeight: '700',
  },
  queueArtist: {
    color: '#91a6ad',
    fontSize: 16,
    marginTop: 6,
  },
  setupText: {
    color: '#9bb1b8',
    fontSize: 17,
    lineHeight: 25,
    marginBottom: 10,
  },
});
