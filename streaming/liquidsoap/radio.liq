#!/usr/bin/liquidsoap

set("log.file", "-")
set("server.telnet", false)

# Configurações do servidor
settings.server.telnet := false

def get_next_track() =
  uri = get_process_output("curl -s http://host.docker.internal:3000/api/next-track")
  if uri == "" then
    request.create("/music/example.mp3")
  else
    request.create(uri)
  end
end

dynamic_source = request.dynamic(get_next_track)
fallback_playlist = playlist("/music/", mode="randomize", reload_mode="rounds", reload=3600)

source = fallback([dynamic_source, fallback_playlist])

# Crossfade e normalização
source = normalize(source)
source = smart_crossfade(source)

# Codificação e saída para Icecast
output.icecast(
  %opus(
    samplerate=48000,
    bitrate=128,
    channels=2
  ),
  host="icecast",
  port=8000,
  password=get_env("ICECAST_SOURCE_PASSWORD"),
  mount="/stream",
  name="Lofiever Radio",
  description="Lo-fi 24/7 Radio Stream",
  source)
