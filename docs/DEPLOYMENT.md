# Deployment Guide - Zero Downtime

Este guia explica como fazer deploy do Lofiever no Coolify com zero-downtime.

## Arquitetura Recomendada

Para ter **rolling updates** (zero-downtime), separe os serviços:

```
┌─────────────────────────────────────────────────────────────┐
│                        COOLIFY                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │   Resources      │    │   Applications               │   │
│  │                  │    │                              │   │
│  │  • PostgreSQL    │◄───│  • lofiever-app (Dockerfile) │   │
│  │  • Redis         │    │    ✅ Rolling Updates        │   │
│  │                  │    │                              │   │
│  └──────────────────┘    │  • lofiever-streaming        │   │
│                          │    (Docker Compose)          │   │
│                          │    - Icecast                 │   │
│                          │    - Liquidsoap              │   │
│                          └──────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Passo 1: Criar Resources (PostgreSQL + Redis)

### PostgreSQL
1. No Coolify, vá em **Resources** > **New Resource**
2. Selecione **PostgreSQL**
3. Configure:
   - Name: `lofiever-postgres`
   - Database: `lofiever`
   - User: `lofiever`
4. Copie a **connection string** gerada

### Redis
1. **Resources** > **New Resource** > **Redis**
2. Configure:
   - Name: `lofiever-redis`
3. Copie a **connection string** gerada

## Passo 2: Deploy do App (com Rolling Updates)

### Configuração no Coolify

1. **New Application** > **Dockerfile**
2. Configure:
   - **Git Repository**: seu repo do Lofiever
   - **Build Pack**: `Dockerfile`
   - **Dockerfile Location**: `/Dockerfile`

3. **Environment Variables** (obrigatórias):
   ```env
   # Database (use a URL do Resource)
   DATABASE_URL=postgresql://lofiever:xxx@lofiever-postgres:5432/lofiever

   # Redis (use a URL do Resource)
   REDIS_URL=redis://lofiever-redis:6379

   # Auth
   AUTH_SECRET=<gerar-com-openssl-rand-base64-32>
   NEXTAUTH_URL=https://app.lofiever.dev

   # Admin
   ADMIN_EMAILS=seu@email.com

   # OpenAI (opcional)
   OPENAI_API_KEY=sk-xxx

   # Icecast (URL externa do serviço de streaming)
   ICECAST_URL=https://stream.lofiever.dev
   ICECAST_STREAM_URL=https://stream.lofiever.dev/stream

   # API Security
   API_SECRET_KEY=<gerar-chave-segura>
   ALLOWED_ORIGINS=https://app.lofiever.dev
   ```

4. **Health Check** (já configurado no Dockerfile):
   - Path: `/api/health`
   - Interval: 10s
   - Timeout: 5s

5. **Advanced Settings**:
   - ✅ **Enable** custom container name: `OFF` (manter padrão)
   - ✅ Container port: `3000`

### Verificar Rolling Updates

Com essa configuração, quando fizer deploy:
1. Novo container inicia
2. Health check verifica `/api/health`
3. Quando saudável, tráfego é redirecionado
4. Container antigo é removido
5. **Zero downtime!**

## Passo 3: Deploy do Streaming (Icecast + Liquidsoap)

### Configuração

1. **New Application** > **Docker Compose**
2. Configure:
   - **Git Repository**: mesmo repo
   - **Docker Compose File**: `docker-compose.streaming.yml`

3. **Environment Variables**:
   ```env
   ICECAST_SOURCE_PASSWORD=<senha-segura>
   ICECAST_ADMIN_PASSWORD=<senha-admin>
   ICECAST_RELAY_PASSWORD=<senha-relay>
   ICECAST_HOSTNAME=stream.lofiever.dev
   APP_URL=https://app.lofiever.dev
   API_SECRET_KEY=<mesma-chave-do-app>
   ```

4. **Domains**:
   - Icecast: `stream.lofiever.dev` → porta 8000

> **Nota**: Streaming não precisa de rolling updates pois é um serviço de longa duração.

## Passo 4: Executar Migrations

Após o primeiro deploy do app:

```bash
# No terminal do Coolify ou via SSH
docker exec -it <container-app> npx prisma migrate deploy
docker exec -it <container-app> npx prisma db seed
```

Ou configure um **Post-deploy Command** no Coolify:
```bash
npx prisma migrate deploy
```

## Troubleshooting

### App não inicia (health check falhando)
1. Verifique logs: `docker logs <container>`
2. Confirme que DATABASE_URL e REDIS_URL estão corretos
3. Verifique se os Resources estão no mesmo network

### Rolling update não funciona
Verifique:
- [ ] Build Pack é `Dockerfile` (não Docker Compose)
- [ ] Container name está no padrão (não customizado)
- [ ] Health check está configurado e passando
- [ ] Porta não está mapeada diretamente no host

### Streaming não conecta ao app
- Verifique se `APP_URL` está correto
- Confirme que `API_SECRET_KEY` é igual nos dois serviços

## Arquivos de Configuração

| Arquivo | Uso |
|---------|-----|
| `Dockerfile` | Build do app Next.js |
| `docker-compose.yml` | Desenvolvimento local |
| `docker-compose.streaming.yml` | Serviços de streaming (Coolify) |

## Comandos Úteis

```bash
# Verificar health local
curl http://localhost:3000/api/health

# Ver logs do container
docker logs -f lofiever-app

# Executar migration manualmente
docker exec -it lofiever-app npx prisma migrate deploy
```
