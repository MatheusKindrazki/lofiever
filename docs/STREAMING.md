# Streaming Infrastructure

This document describes the audio streaming infrastructure used by Lofiever.

## Overview

Lofiever uses a professional radio streaming stack:

- **Icecast** - Audio streaming server
- **Liquidsoap** - Audio processing and playlist engine

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Music Files   │────▶│   Liquidsoap    │────▶│    Icecast      │
│   (S3/Local)    │     │   (Processing)  │     │   (Streaming)   │
│                 │     │                 │     │                 │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 │                       │
                        ┌────────▼────────┐     ┌────────▼────────┐
                        │                 │     │                 │
                        │   Next.js API   │     │   Web Clients   │
                        │  (Next Track)   │     │  (HTML5 Audio)  │
                        │                 │     │                 │
                        └─────────────────┘     └─────────────────┘
```

## Icecast Configuration

The Icecast server is configured via `streaming/icecast/icecast.xml`:

### Key Settings

| Setting | Value | Description |
|---------|-------|-------------|
| Mount Point | `/stream` | Stream URL path |
| Port | 8000 | HTTP port |
| Max Listeners | 100 | Concurrent listeners |
| Burst Size | 65536 | Initial buffer |

### Authentication

```bash
# Source password (Liquidsoap -> Icecast)
ICECAST_SOURCE_PASSWORD=your-source-password

# Admin password
ICECAST_ADMIN_PASSWORD=your-admin-password

# Relay password
ICECAST_RELAY_PASSWORD=your-relay-password
```

## Liquidsoap Configuration

The Liquidsoap script is at `streaming/liquidsoap/radio.liq`:

### Features

1. **Dynamic Playlist** - Fetches next track from Next.js API
2. **Crossfade** - Smooth transitions between tracks
3. **Fallback** - Emergency playlist if API fails
4. **Metadata** - Track info sent to Icecast

### API Integration

```liquidsoap
# Fetch next track from API
def get_next_track() =
  result = http.get("http://api:3000/api/next-track")
  json.parse(result)
end
```

## Stream URLs

| URL | Description |
|-----|-------------|
| `http://localhost:8000/stream` | Main audio stream |
| `http://localhost:8000/admin/` | Icecast admin panel |
| `http://localhost:8000/status-json.xsl` | Stream status (JSON) |

## Docker Services

### docker-compose.yml

```yaml
services:
  icecast:
    image: moul/icecast
    ports:
      - "8000:8000"
    environment:
      - ICECAST_SOURCE_PASSWORD=${ICECAST_SOURCE_PASSWORD}
      - ICECAST_ADMIN_PASSWORD=${ICECAST_ADMIN_PASSWORD}

  liquidsoap:
    image: savonet/liquidsoap:v2.3.3
    depends_on:
      - icecast
    volumes:
      - ./streaming/liquidsoap:/radio
      - ./public/music:/music
```

## Monitoring

### Check Stream Status

```bash
# JSON status
npm run stream:test

# Monitor script
npm run stream:monitor

# Continuous watch
npm run stream:watch
```

### Health Check

```bash
curl http://localhost:8000/status-json.xsl | jq '.'
```

## Troubleshooting

### Stream Not Playing

1. Check Icecast is running:
   ```bash
   docker-compose logs icecast
   ```

2. Check Liquidsoap connection:
   ```bash
   docker-compose logs liquidsoap
   ```

3. Verify music files exist:
   ```bash
   ls -la public/music/
   ```

### Audio Cuts Out

- Check network stability
- Increase Icecast burst size
- Monitor Liquidsoap logs for errors

### High Latency

- Reduce buffer sizes
- Consider DASH/HLS for adaptive streaming
- Use CDN for global distribution

## Advanced Topics

### NTP Synchronization

For precise synchronization across clients:

```bash
# Enable NTP on host
./streaming/setup-ntp.sh
```

### DASH Segmentation (Future)

For lower latency and adaptive bitrate:

```bash
# Generate DASH segments
./streaming/dash/segmenter.sh
```

This creates `manifest.mpd` and audio segments for DASH players.

## Security

- Never expose source/admin passwords publicly
- Use reverse proxy (nginx) with SSL in production
- Configure firewall to restrict admin access
- Monitor for unauthorized connections
