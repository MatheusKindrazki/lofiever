# Storage Integration (AWS S3 / Cloudflare R2)

This document details the integration with cloud storage for music and artwork files.

## Overview

Lofiever supports two storage modes:
- **Local** - Files stored in `public/music/` (development)
- **S3/R2** - Files stored in cloud storage (production)

## Features

- **Dynamic Seed Script** - Automatically scans `public/music`, extracts metadata, and populates the database
- **Seed Modes** - `dev` (local files) and `prod` (cloud upload)
- **Pre-signed URLs** - Secure access to private bucket files
- **Automatic Artwork Extraction** - Extracts cover art from audio files

## Environment Variables

```bash
# AWS S3 Configuration
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
AWS_REGION="us-east-1"
AWS_S3_BUCKET="your-bucket-name"

# Cloudflare R2 Configuration (alternative)
R2_ACCESS_KEY_ID="your-r2-access-key"
R2_SECRET_ACCESS_KEY="your-r2-secret-key"
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
- Upload new files to S3/R2
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
  sourceId    String   // filename or S3 key
  artworkKey  String?  // S3 key for artwork
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
   - If artwork in S3, generates pre-signed URL
   - Frontend displays artwork securely

## S3/R2 Bucket Setup

### AWS S3

1. Create bucket in AWS Console
2. Configure bucket policy (private recommended)
3. Create IAM user with S3 access
4. Generate access keys

### Cloudflare R2

1. Create R2 bucket in Cloudflare Dashboard
2. Keep bucket private
3. Generate API token with Read/Write permissions
4. Note endpoint and bucket name

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
- If S3 is unavailable, falls back to local files (if available)
- Pre-signed URL cache can be added to Redis for performance

## Performance Considerations

- Pre-signed URLs generated on-demand
- Consider Redis cache for frequently accessed URLs
- Use CDN in front of S3/R2 for global distribution
- Set appropriate cache headers on audio files
