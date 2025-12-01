# Storage Integration (Cloudflare R2)

This document details the integration with Cloudflare R2 for music and artwork files.

## Overview

Lofiever supports two storage modes:
- **Local** - Files stored in `public/music/` (development)
- **R2** - Files stored in Cloudflare R2 (production)

## Features

- **Dynamic Seed Script** - Automatically scans `public/music`, extracts metadata, and populates the database
- **Seed Modes** - `dev` (local files) and `prod` (cloud upload)
- **Pre-signed URLs** - Secure access to private bucket files
- **Automatic Artwork Extraction** - Extracts cover art from audio files

## Environment Variables

```bash
# Cloudflare R2 Configuration
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_ENDPOINT="https://your-account-id.r2.cloudflarestorage.com"
R2_BUCKET_NAME="your-bucket-name"
R2_PUBLIC_URL="https://pub-your-bucket-id.r2.dev"
```

## Seed Script Usage

### Development Mode (default)

```bash
npm run db:seed
# or
npm run db:seed -- --mode=dev
```

This will:
- Clear all database records
- Scan `public/music` directory
- Create `Track` records with `sourceType: 'local'`
- No cloud upload

### Production Mode

```bash
npm run db:seed -- --mode=prod
```

This will:
- **NOT** clear the database
- Scan `public/music` directory
- Check for duplicates (title + artist)
- Upload new files to R2
- Create `Track` records with `sourceType: 's3'`

## Database Schema

```prisma
model Track {
  id          String   @id @default(cuid())
  title       String
  artist      String
  album       String?
  duration    Int
  sourceType  String   @default("local") // 'local' | 's3'
  sourceId    String   // filename or R2 key
  artworkKey  String?  // R2 key for artwork
  artworkUrl  String?  // URL or pre-signed URL
}
```

## Pre-signed URL Flow

1. **Audio Playback (Liquidsoap)**
   - `LiquidsoapIntegrationService` checks `sourceType`
   - If `'s3'`, generates pre-signed URL (1 hour expiry)
   - Liquidsoap fetches audio via pre-signed URL

2. **Artwork Display (Frontend)**
   - `/api/stream` endpoint checks `artworkKey`
   - If artwork in R2, generates pre-signed URL
   - Frontend displays artwork securely

## R2 Bucket Setup

1. **Create Bucket** - In Cloudflare Dashboard, create an R2 bucket
2. **Keep Private** - Bucket should be private (pre-signed URLs are used)
3. **Generate API Token** - Create token with Read/Write permissions
4. **Note Credentials**:
   - Account ID (for endpoint URL)
   - Access Key ID
   - Secret Access Key
   - Bucket name
   - Public URL (if public access enabled)

## File Structure in Bucket

```
bucket/
├── audio/
│   ├── track-id-1.mp3
│   ├── track-id-2.mp3
│   └── ...
└── artwork/
    ├── track-id-1.jpg
    ├── track-id-2.jpg
    └── ...
```

## Fallback Behavior

- If artwork generation fails, uses `/default-cover.jpg`
- If R2 is unavailable, falls back to local files (if available)
- Pre-signed URL cache can be added to Redis for performance

## Performance Considerations

- Pre-signed URLs generated on-demand
- Consider Redis cache for frequently accessed URLs
- R2 provides global distribution via Cloudflare's network
- Set appropriate cache headers on audio files

## Code Reference

The R2 integration is implemented in:
- `src/lib/r2.ts` - R2 client and utility functions
- `src/lib/config.ts` - R2 configuration from environment variables
