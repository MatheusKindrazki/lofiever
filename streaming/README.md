# Streaming Stack

This folder contains configuration files for the radio streaming core used by Lofiever.

## Icecast

`icecast.xml` defines the server configuration. It exposes a mount point at `/stream` and uses simple default credentials. Adjust the passwords before deploying to production.

## Liquidsoap

`radio.liq` is a basic Liquidsoap script that plays a static playlist (`playlist.m3u`) and streams it to the Icecast server using the Opus codec. Place your audio files in this directory and list them in `playlist.m3u`.

Run both services using Docker:

```bash
docker compose up icecast liquidsoap
```

## DASH Segmenter

The `dash/segmenter.sh` script shows how to generate MPEG-DASH segments from the Icecast stream using `ffmpeg`. The resulting `manifest.mpd` and segments will be written to `dash-output/`.

## NTP Sync

Use `setup-ntp.sh` to enable NTP time synchronization on your host system, ensuring clients receive audio at the same time reference.
