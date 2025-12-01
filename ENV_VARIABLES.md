# Environment Variables

Complete reference for all environment variables used in Lofiever.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your values
```

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
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret"  # Generate: openssl rand -base64 32
```

### OpenAI (AI DJ)

```bash
OPENAI_API_KEY="sk-your-openai-api-key"
```

## Storage (AWS S3)

```bash
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
AWS_REGION="us-east-1"
AWS_S3_BUCKET="your-bucket-name"
```

## Storage (Cloudflare R2) - Alternative

```bash
R2_ACCESS_KEY_ID="your-r2-access-key"
R2_SECRET_ACCESS_KEY="your-r2-secret-key"
R2_ENDPOINT="https://your-account-id.r2.cloudflarestorage.com"
R2_BUCKET_NAME="your-bucket-name"
R2_PUBLIC_URL="https://pub-your-bucket-id.r2.dev"
```

## Streaming (Icecast)

```bash
ICECAST_PORT=8000
ICECAST_HOST="localhost"
ICECAST_MOUNT="/stream"
ICECAST_SOURCE_PASSWORD="your-source-password"
ICECAST_ADMIN_PASSWORD="your-admin-password"
ICECAST_RELAY_PASSWORD="your-relay-password"
ICECAST_ADMIN_USER="admin"
ICECAST_HOSTNAME="localhost"
```

## Stream URLs

```bash
ICECAST_URL="http://localhost:8000"
ICECAST_STREAM_URL="http://localhost:8000/stream"
```

## OAuth (Optional)

```bash
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
```

## API Security (Production)

```bash
API_SECRET_KEY="your-api-secret"           # Generate: openssl rand -base64 32
STREAM_TOKEN_SECRET="your-token-secret"    # Generate: openssl rand -base64 32
STREAM_TOKEN_EXPIRY="3600"                 # Token expiry in seconds
ALLOWED_ORIGINS="https://yourdomain.com"   # Comma-separated list
RATE_LIMIT_ENABLED="true"
```

## Application

```bash
NODE_ENV="development"  # or "production"
PORT=3000
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## Coolify Deployment

When deploying to Coolify, these variables are auto-generated:

```bash
SERVICE_FQDN_APP_3000="https://your-app-domain.com"
SERVICE_FQDN_ICECAST_8000="https://your-stream-domain.com"
SERVICE_USER_POSTGRES="postgres"
SERVICE_PASSWORD_POSTGRES="generated-password"
```

## Security Checklist

> **Production Security:**
> 1. Generate strong secrets for all `*_SECRET` variables
> 2. Set `ALLOWED_ORIGINS` to your production domain(s) only
> 3. Never commit `.env` to version control
> 4. Enable rate limiting (`RATE_LIMIT_ENABLED="true"`)
> 5. Use HTTPS for all production URLs
> 6. Use Docker secrets for sensitive values

## Generate Secrets

```bash
# Generate strong random secrets
openssl rand -base64 32
```

## Example Configurations

### Development (.env)

```bash
NODE_ENV="development"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lofiever"
REDIS_URL="redis://localhost:6379"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="dev-secret-change-in-production"
OPENAI_API_KEY="sk-your-key"
ICECAST_SOURCE_PASSWORD="hackme"
ICECAST_ADMIN_PASSWORD="hackme"
```

### Production (.env)

```bash
NODE_ENV="production"
DATABASE_URL="postgresql://user:password@postgres:5432/lofiever"
REDIS_URL="redis://redis:6379"
NEXTAUTH_URL="https://yourdomain.com"
NEXTAUTH_SECRET="your-strong-secret"
OPENAI_API_KEY="sk-your-key"
AWS_ACCESS_KEY_ID="your-key"
AWS_SECRET_ACCESS_KEY="your-secret"
AWS_S3_BUCKET="your-bucket"
ICECAST_SOURCE_PASSWORD="strong-password"
ICECAST_ADMIN_PASSWORD="strong-password"
ALLOWED_ORIGINS="https://yourdomain.com"
RATE_LIMIT_ENABLED="true"
```
