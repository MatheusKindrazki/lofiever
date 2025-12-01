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
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public"
```

### Redis

```bash
REDIS_URL="redis://localhost:6379"
```

### Auth

```bash
AUTH_SECRET=""  # Generate: openssl rand -base64 32
```

### OpenAI (AI DJ)

```bash
OPENAI_API_KEY="sk-your-openai-api-key"
```

## Cloudflare R2 Storage

```bash
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_ENDPOINT="https://<account_id>.r2.cloudflarestorage.com"
R2_BUCKET_NAME="lofiever"
R2_PUBLIC_URL="https://cdn.lofiever.dev"
```

## Icecast Streaming

```bash
ICECAST_SOURCE_PASSWORD=""
ICECAST_ADMIN_PASSWORD=""
ICECAST_RELAY_PASSWORD=""
```

Generate passwords with:
```bash
openssl rand -base64 32
```

## API Security

```bash
API_SECRET_KEY=""  # Generate: openssl rand -base64 32
ALLOWED_ORIGINS="http://localhost:3000"
RATE_LIMIT_ENABLED="true"
```

## Coolify Deployment

When deploying to Coolify, these variables are auto-generated:

```bash
SERVICE_FQDN_APP_3000="https://your-app-domain.com"
SERVICE_FQDN_ICECAST_8000="https://your-stream-domain.com"
SERVICE_USER_POSTGRES="postgres"
SERVICE_PASSWORD_POSTGRES="generated-password"
```

The `docker-compose.yml` uses these to build the `DATABASE_URL` automatically.

## Security Checklist

> **Production Security:**
> 1. Generate strong secrets for `AUTH_SECRET` and `API_SECRET_KEY`
> 2. Set `ALLOWED_ORIGINS` to your production domain(s) only
> 3. Never commit `.env` to version control
> 4. Enable rate limiting (`RATE_LIMIT_ENABLED="true"`)
> 5. Use HTTPS for all production URLs

## Generate All Secrets

```bash
# Generate all required secrets
echo "AUTH_SECRET=$(openssl rand -base64 32)"
echo "API_SECRET_KEY=$(openssl rand -base64 32)"
echo "ICECAST_SOURCE_PASSWORD=$(openssl rand -base64 32)"
echo "ICECAST_ADMIN_PASSWORD=$(openssl rand -base64 32)"
echo "ICECAST_RELAY_PASSWORD=$(openssl rand -base64 32)"
```

## Example: Development

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public"
REDIS_URL="redis://localhost:6379"
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_ENDPOINT="https://account-id.r2.cloudflarestorage.com"
R2_BUCKET_NAME="lofiever"
R2_PUBLIC_URL="https://cdn.lofiever.dev"
OPENAI_API_KEY="sk-your-key"
ICECAST_SOURCE_PASSWORD="hackme"
ICECAST_ADMIN_PASSWORD="hackme"
ICECAST_RELAY_PASSWORD="hackme"
AUTH_SECRET="dev-secret"
API_SECRET_KEY="dev-api-key"
ALLOWED_ORIGINS="http://localhost:3000"
RATE_LIMIT_ENABLED="true"
```

## R2 Bucket Setup

1. Create R2 bucket in Cloudflare Dashboard
2. Keep bucket **private** (pre-signed URLs are used)
3. Generate API token with Read/Write permissions
4. Configure custom domain (optional): `cdn.lofiever.dev`
