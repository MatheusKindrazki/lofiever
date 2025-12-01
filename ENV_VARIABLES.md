# Environment Variables Configuration

This document lists all required and optional environment variables for the Lofiever application.

## Required Variables

### Database
```bash
DATABASE_URL="postgresql://user:password@localhost:5432/lofiever"
```

### Redis
```bash
REDIS_URL="redis://localhost:6379"
```

### NextAuth
```bash
AUTH_SECRET="your-auth-secret-here"  # Generate with: openssl rand -base64 32
```

### API Security (REQUIRED FOR PRODUCTION)
```bash
# API key for public routes
API_SECRET_KEY="your-api-secret-key"  # Generate with: openssl rand -base64 32

# Stream token secret for JWT signing
STREAM_TOKEN_SECRET="your-stream-token-secret"  # Generate with: openssl rand -base64 32

# Token expiry in seconds (default: 3600 = 1 hour)
STREAM_TOKEN_EXPIRY="3600"

# Comma-separated list of allowed origins (IMPORTANT for production)
ALLOWED_ORIGINS="http://localhost:3000,https://yourdomain.com"

# Enable rate limiting (default: true)
RATE_LIMIT_ENABLED="true"
```

### OpenAI
```bash
OPENAI_API_KEY="your-openai-api-key"
```

### Cloudflare R2 Storage
```bash
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_ENDPOINT="https://your-account-id.r2.cloudflarestorage.com"
R2_BUCKET_NAME="your-bucket-name"
R2_PUBLIC_URL="https://pub-your-bucket-id.r2.dev"
```

## Optional Variables

### Icecast
```bash
ICECAST_HOST="localhost"
ICECAST_PORT="8000"
ICECAST_MOUNT="/stream"
ICECAST_ADMIN_USER="admin"
ICECAST_ADMIN_PASSWORD="your-admin-password"
```

### GitHub OAuth (optional)
```bash
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
```

### App Configuration
```bash
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="development"  # or "production"
```

## Security Notes

> [!WARNING]
> **Production Security Checklist:**
> 1. Generate strong secrets for `API_SECRET_KEY`, `STREAM_TOKEN_SECRET`, and `AUTH_SECRET`
> 2. Set `ALLOWED_ORIGINS` to your production domain(s) only
> 3. Never commit `.env` file to version control
> 4. Enable rate limiting in production (`RATE_LIMIT_ENABLED="true"`)
> 5. Use HTTPS for all production URLs

## Generating Secrets

Use these commands to generate secure secrets:

```bash
# Generate API_SECRET_KEY
openssl rand -base64 32

# Generate STREAM_TOKEN_SECRET
openssl rand -base64 32

# Generate AUTH_SECRET
openssl rand -base64 32
```

## Development vs Production

### Development (.env.local)
```bash
NODE_ENV="development"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
ALLOWED_ORIGINS="http://localhost:3000"
```

### Production (.env.production)
```bash
NODE_ENV="production"
NEXT_PUBLIC_APP_URL="https://yourdomain.com"
ALLOWED_ORIGINS="https://yourdomain.com"
# ... other production values
```
