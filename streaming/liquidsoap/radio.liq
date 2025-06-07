#!/usr/bin/liquidsoap

set("log.file", "-")
set("server.telnet", false)

# Playlist static
playlist = playlist("./playlist.m3u")

# Encode to Opus (48kHz)
encoded = audio_to_stereo(playlist)

output.icecast(
  %opus(
    samplerate=48000,
    bitrate=128k,
    channels=2
  ),
  host="icecast",
  port=8000,
  password="source_password",
  mount="/stream",
  name="Lofiever Radio"
)(encoded)
