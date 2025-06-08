#!/usr/bin/liquidsoap

set("log.file", "-")
set("server.telnet", false)

# Configurações do servidor
settings.server.telnet := false

# Playlist de músicas
music_source = playlist("/music/", mode="randomize", reload_mode="rounds", reload=3600)

# Fallback para caso não tenha música
silence_source = blank(duration=2.0)
source = fallback([music_source, silence_source])

# Tornar a fonte infallible e aplicar normalização
source = mksafe(source)
source = normalize(source)

# Codificação e saída para Icecast
output.icecast(
  %opus(
    samplerate=48000,
    bitrate=128,
    channels=2
  ),
  host="icecast",
  port=8000,
  password="source_password",
  mount="/stream",
  name="Lofiever Radio",
  description="Lo-fi 24/7 Radio Stream",
  source)
