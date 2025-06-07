# Lofiever - Análise Completa do Projeto

## 📝 Visão Geral

**Lofiever** é uma aplicação de streaming de música lofi 24/7 com curadoria por IA. O projeto implementa uma arquitetura moderna full-stack utilizando Next.js, com funcionalidades em tempo real para sincronização de reprodução, chat ao vivo e votação de playlists.

## 🏗️ Arquitetura do Sistema

O projeto segue uma arquitetura híbrida com:
- **Frontend**: Next.js 15 com React 19 e TypeScript
- **Backend**: API Routes do Next.js + Servidor Socket.IO customizado
- **Banco de Dados**: PostgreSQL (principal) + Redis (cache/tempo real)
- **Gerenciamento de Estado**: React Query + Zustand
- **Comunicação em Tempo Real**: Socket.IO

## 📦 Dependências Principais

### Dependências de Produção

| Dependência | Versão | Propósito |
|-------------|--------|-----------|
| `next` | 15.3.0 | Framework React para produção |
| `react` | 19.0.0 | Biblioteca UI principal |
| `@prisma/client` | 6.6.0 | Cliente ORM para PostgreSQL |
| `@tanstack/react-query` | 5.74.4 | Gerenciamento de estado servidor |
| `socket.io` | 4.8.1 | Comunicação WebSocket servidor |
| `socket.io-client` | 4.8.1 | Cliente WebSocket |
| `ioredis` | 5.6.1 | Cliente Redis para cache |
| `zustand` | 5.0.3 | Gerenciamento de estado local |
| `tailwind-merge` | 3.2.0 | Utilitário CSS |
| `clsx` | 2.1.1 | Utilitário para classes condicionais |
| `nanoid` | 5.1.5 | Gerador de IDs únicos |
| `next-auth` | 4.24.11 | Sistema de autenticação |

### Dependências de Desenvolvimento

| Dependência | Versão | Propósito |
|-------------|--------|-----------|
| `prisma` | 6.6.0 | ORM e migração de banco |
| `tailwindcss` | 4.1.3 | Framework CSS |
| `typescript` | 5.x | Tipagem estática |
| `ts-node` | 10.9.2 | Execução TypeScript |
| `eslint` | 9.x | Linting de código |

## 📁 Estrutura Detalhada do Projeto

```
lofiever/
├── 🗂️ src/                    # Código fonte principal
│   ├── 🗂️ app/               # App Router do Next.js
│   ├── 🗂️ components/        # Componentes React reutilizáveis
│   ├── 🗂️ lib/              # Bibliotecas e utilitários core
│   ├── 🗂️ services/         # Serviços de negócio
│   ├── 🗂️ styles/           # Estilos globais CSS
│   ├── 🗂️ types/            # Definições TypeScript
│   └── 🗂️ utils/            # Funções utilitárias
├── 🗂️ prisma/               # Schema e migrações do banco
├── 🗂️ server/               # Servidor Socket.IO customizado
├── 🗂️ public/               # Assets estáticos
├── 🗂️ scripts/              # Scripts utilitários
└── ⚙️ Arquivos de configuração
```

## 📋 Descrição Detalhada dos Arquivos

### 🗂️ `/src/app` - App Router (Next.js)

#### API Routes (`/src/app/api/`)

| Arquivo | Descrição |
|---------|-----------|
| `curation/route.ts` | Endpoint para recomendações de IA (mock) |
| `playlist/route.ts` | CRUD de playlists ativas |
| `stats/route.ts` | Estatísticas de streaming |
| `stream/route.ts` | Dados da stream atual |
| `tracks/route.ts` | Gerenciamento de faixas musicais |
| `ws/route.ts` | Placeholder para WebSocket |

#### Páginas

| Arquivo | Descrição |
|---------|-----------|
| `layout.tsx` | Layout raiz com providers |
| `page.tsx` | Página principal do player |

### 🗂️ `/src/components` - Componentes React

| Arquivo | Descrição |
|---------|-----------|
| `Player.tsx` | Player de música principal com controles |
| `Stats.tsx` | Componente de estatísticas em tempo real |
| `Curation.tsx` | Interface para curadoria por IA |

### 🗂️ `/src/lib` - Bibliotecas Core

| Arquivo | Descrição |
|---------|-----------|
| `prisma.ts` | Cliente Prisma e helpers de banco |
| `redis.ts` | Cliente Redis com helpers especializados |
| `config.ts` | Configurações centralizadas |
| `api.ts` | Funções para consumo de APIs |
| `api-utils.ts` | Utilitários para tratamento de APIs |

#### `/src/lib/providers`

| Arquivo | Descrição |
|---------|-----------|
| `ReactQueryProvider.tsx` | Provider do React Query |

#### `/src/lib/socket` - Sistema WebSocket

| Arquivo | Descrição |
|---------|-----------|
| `client.ts` | Hooks e cliente Socket.IO |
| `server.ts` | Servidor Socket.IO com eventos |
| `types.ts` | Tipagem para eventos WebSocket |

### 🗂️ `/src/services` - Camada de Serviços

| Arquivo | Descrição |
|---------|-----------|
| `database.ts` | Serviços que integram Redis + PostgreSQL |

### 🗂️ `/src/utils` - Utilitários

| Arquivo | Descrição |
|---------|-----------|
| `player-source.ts` | Gerenciamento de fontes de mídia |
| `socket.ts` | Utilitários WebSocket (placeholder) |

### 🗂️ `/prisma` - Banco de Dados

| Arquivo | Descrição |
|---------|-----------|
| `schema.prisma` | Schema do banco com models |
| `seed.ts` | Script para popular banco inicial |
| `migrations/` | Histórico de migrações SQL |

### ⚙️ Arquivos de Configuração

| Arquivo | Descrição |
|---------|-----------|
| `package.json` | Dependências e scripts |
| `next.config.ts` | Configuração do Next.js |
| `tailwind.config.js` | Configuração do Tailwind CSS |
| `tsconfig.json` | Configuração TypeScript |
| `docker-compose.yml` | Serviços Redis + PostgreSQL |
| `eslint.config.mjs` | Configuração ESLint |

## 🏛️ Modelos de Dados (Prisma)

### Principais Entidades

1. **Track** - Informações das músicas
2. **Playlist** - Playlists versionadas 
3. **PlaylistTrack** - Relacionamento N:N com posições
4. **PlaybackHistory** - Histórico de reprodução
5. **Feedback** - Avaliações dos usuários
6. **ChatMessage** - Mensagens do chat

## 🔄 Fluxo de Dados em Tempo Real

### Sistema de Cache (Redis)

- **Playback State**: Estado atual de reprodução
- **Current Track**: Faixa tocando agora
- **Listeners Count**: Contador de ouvintes
- **Chat Messages**: Mensagens recentes
- **Playlist Cache**: Cache de playlists ativas

### Sincronização WebSocket

1. Cliente conecta via Socket.IO
2. Servidor envia estado atual (sync)
3. Eventos em tempo real:
   - Mudança de faixa
   - Play/Pause
   - Contagem de ouvintes
   - Mensagens de chat
   - Votos em playlist

## 🚀 Scripts Disponíveis

```bash
# Desenvolvimento
npm run dev          # Servidor completo (Socket.IO + Next.js)
npm run dev:server   # Apenas servidor Socket.IO
npm run dev:next     # Apenas Next.js

# Produção
npm run build        # Build da aplicação
npm run start        # Servidor produção

# Banco de dados
npx prisma migrate dev    # Aplicar migrações
npx prisma db seed       # Popular banco inicial
npx prisma studio        # Interface visual

# Utilitários
npm run test:redis   # Testar conexão Redis
npm run lint         # Verificar código
```

## 🌊 Diagrama da Arquitetura

```mermaid
graph TB
    subgraph "🖥️ Frontend (Next.js)"
        A[Player Component]
        B[Stats Component] 
        C[Curation Component]
        D[React Query]
        E[Socket.IO Client]
    end
    
    subgraph "⚡ Backend Services"
        F[Next.js API Routes]
        G[Socket.IO Server]
        H[Database Service]
    end
    
    subgraph "💾 Data Layer"
        I[(PostgreSQL)]
        J[(Redis Cache)]
    end
    
    subgraph "🎵 External Sources"
        K[YouTube API]
        L[S3 Storage]
        M[Local Files]
    end
    
    %% Conexões Frontend
    A --> D
    A --> E
    B --> D
    C --> D
    D --> F
    E --> G
    
    %% Conexões Backend
    F --> H
    G --> H
    H --> I
    H --> J
    
    %% Dados em tempo real
    G -.->|WebSocket| E
    J -.->|Cache| H
    
    %% Fontes externas
    F --> K
    F --> L  
    F --> M
    
    %% Fluxo de dados
    I -->|Persist| H
    J -->|Cache| H
    H -->|API| F
    H -->|Events| G
```

## 🔧 Funcionalidades Implementadas

### ✅ Core Features
- [x] Player de música com controles
- [x] Streaming contínuo 24/7 simulado
- [x] Sistema de playlists versionadas
- [x] Contagem de ouvintes em tempo real
- [x] Chat ao vivo
- [x] Estatísticas de uso
- [x] Curadoria por IA (mock)

### ✅ Arquitetura
- [x] Cache Redis para performance
- [x] WebSocket para sincronização
- [x] API REST para operações CRUD
- [x] Banco PostgreSQL estruturado
- [x] Sistema de logs e monitoramento

### 🚧 Próximas Features
- [ ] Autenticação de usuários
- [ ] Integração real com IA (OpenAI)
- [ ] Suporte a múltiplas fontes de áudio
- [ ] Sistema de votos em playlists
- [ ] Monetização e analytics

## 🛠️ Configuração para Desenvolvimento

### Pré-requisitos
```bash
# Instalar dependências
npm install

# Configurar banco (Docker)
docker-compose up -d

# Configurar variáveis de ambiente
cp .env.example .env
```

### Variáveis de Ambiente Necessárias
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
REDIS_URL="redis://localhost:6379"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
AUTH_SECRET="your-secret-key"
```

### Inicialização
```bash
# Executar migrações
npx prisma migrate dev

# Popular banco inicial
npx prisma db seed

# Iniciar desenvolvimento
npm run dev
```

---

**Autor**: Matheus Kindrazki  
**Projeto**: Lofiever - 24/7 Lofi Streaming Platform  
**Última Atualização**: Janeiro 2025 