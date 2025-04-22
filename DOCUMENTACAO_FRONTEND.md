# Lofiever - Documentação Frontend OnePage

![Lofiever](https://images.unsplash.com/photo-1569982175971-d92b01cf8694?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3)

## Visão Geral

Lofiever é uma plataforma de streaming de música lofi 24/7 com curadoria baseada em IA. O frontend é construído com tecnologias modernas para oferecer uma experiência de usuário fluida e responsiva, permitindo que os usuários escutem música lofi enquanto veem estatísticas em tempo real e recebem recomendações personalizadas.

## Stack Tecnológico

- **Framework**: Next.js 15.3.0 (com App Router)
- **UI**: React 19.0.0
- **Estilização**: Tailwind CSS 4.1.3
- **Comunicação em Tempo Real**: Socket.io-client 4.8.1
- **Build Tool**: Turbopack (via flag `--turbopack`)
- **Tipagem**: TypeScript 5.x

## Estrutura do Projeto

```
src/
├── app/                 # Estrutura do Next.js App Router
│   ├── api/             # Endpoints da API (route handlers)
│   ├── layout.tsx       # Layout principal da aplicação
│   └── page.tsx         # Página inicial
├── components/          # Componentes React reutilizáveis
│   ├── Player.tsx       # Reprodutor de música
│   ├── Stats.tsx        # Estatísticas do streaming
│   └── Curation.tsx     # Recomendações de IA
├── lib/                 # Funções utilitárias e chamadas de API
│   └── api.ts           # Funções para comunicação com o backend
├── styles/              # Estilos globais
│   └── globals.css      # CSS global com imports do Tailwind
└── utils/               # Utilitários adicionais
```

## Arquitetura Frontend

```
                                  +-------------------+
                                  |                   |
                                  |  Next.js App      |
                                  |  (page.tsx)       |
                                  |                   |
                                  +---------+---------+
                                            |
                +---------------------------+---------------------------+
                |                           |                           |
    +-----------v-----------+   +-----------v-----------+   +-----------v-----------+
    |                       |   |                       |   |                       |
    |      Player.tsx       |   |      Stats.tsx        |   |    Curation.tsx       |
    |                       |   |                       |   |                       |
    +-----------+-----------+   +-----------+-----------+   +-----------+-----------+
                |                           |                           |
                +---------------------------+---------------------------+
                                            |
                                  +---------v---------+
                                  |                   |
                                  |    API (lib/api)  |
                                  |                   |
                                  +---------+---------+
                                            |
                        +-----------------+-----------------+
                        |                 |                 |
              +---------v--------+ +------v---------+ +----v-------------+
              |                  | |                | |                  |
              | /api/stream      | | /api/curation  | | Socket.io        |
              | (Dados do Player)| | (Recomendações)| | (Futuro: Stream) |
              |                  | |                | |                  |
              +------------------+ +----------------+ +------------------+
```

## Componentes Principais

### Player.tsx
- **Funcionalidade**: Reprodutor de música principal
- **Recursos**:
  - Controles de reprodução (play/pause)
  - Ajuste de volume
  - Exibição de capa do álbum
  - Informações da música atual (título, artista)
  - Visualização de progresso
  - Estado de loading/erro tratados adequadamente

### Stats.tsx
- **Funcionalidade**: Métricas em tempo real do streaming
- **Recursos**:
  - Contagem de ouvintes
  - Dias de atividade
  - Total de músicas reproduzidas
  - Atualização automática a cada 60 segundos
  - Exibição visual com ícones

### Curation.tsx
- **Funcionalidade**: Interface para recomendações de música baseadas em IA
- **Recursos**:
  - Campo de prompt personalizável
  - Exibição de recomendações de músicas
  - Detalhes como título, artista, mood e BPM
  - Loading state para feedback visual durante solicitações

## Tema e Design

- **Paleta de Cores**:
  - Cores principais: tons de roxo ("lofi")
  - Esquema customizado no Tailwind
  - Variações do tema base de roxo (50-950)
- **Modo Escuro**:
  - Suporte nativo a dark mode
  - Detecção automática da preferência do sistema
  - Transições suaves entre temas
- **Responsividade**:
  - Layout adaptativo para todos os tamanhos de tela
  - Grid de coluna única em mobile, duas colunas em desktop
  - Tamanhos de fonte e elementos responsivos

## Fluxo de Dados

1. **Inicialização**:
   - Componentes fazem requisições iniciais aos endpoints da API
   - Dados mockados são carregados (música atual, estatísticas)

2. **Streaming de Música**:
   - Player simula streaming com arquivo local (/mock-lofi.mp3)
   - Em implementação futura, usará websockets (Socket.io)

3. **Atualizações em Tempo Real**:
   - As estatísticas são atualizadas a cada 60 segundos
   - Informações de stream são atualizadas a cada 30 segundos

4. **Curadoria por IA**:
   - O usuário pode enviar prompts personalizados
   - Requisição é feita à API de curadoria
   - Resposta simula recomendações baseadas em IA

## Implementações Futuras

- Integração real com OpenAI para curadoria
- Autenticação de usuários e playlists salvas
- Streaming real via Socket.io
- Integração com fontes de música (Spotify, YouTube)
- Recursos sociais (compartilhamento, comentários)

## API Endpoints

- **/api/stream**:
  - Método: GET
  - Resposta: Dados do stream atual (música, estatísticas)

- **/api/curation**:
  - Método: POST
  - Payload: { prompt: string }
  - Resposta: Lista de recomendações de músicas

## Interface Visual

### Tela Principal
A interface principal do Lofiever é dividida em duas colunas em desktop (uma coluna em mobile):

```
┌────────────────────────────────────────────────────┐
│                   LOFIEVER                         │
│        24/7 Lofi streaming with AI curation        │
├────────────────────┬───────────────────────────────┤
│                    │                               │
│                    │  ┌───────────────────────┐    │
│                    │  │   STATS COMPONENT     │    │
│   PLAYER COMPONENT │  │ Listeners | Active | Songs │    
│                    │  └───────────────────────┘    │
│   [Album Cover]    │                               │
│                    │  ┌───────────────────────┐    │
│   Title - Artist   │  │                       │    │
│                    │  │   CURATION COMPONENT  │    │
│   [Progress Bar]   │  │                       │    │
│                    │  │ [AI Recommendations]  │    │
│   [Play Button]    │  │                       │    │
│                    │  │                       │    │
│   [Volume Control] │  │                       │    │
│                    │  └───────────────────────┘    │
├────────────────────┴───────────────────────────────┤
│                  © 2023 Lofiever                   │
│         Built with ❤️ using Next.js, React, and AI  │
└────────────────────────────────────────────────────┘
```

### Estados do Player
O player possui três estados principais:

1. **Loading**: Exibe um spinner de carregamento
2. **Error**: Exibe mensagem de erro com botão para tentar novamente
3. **Playing**: Exibe a interface completa do player com controles

### Tema Escuro
O tema escuro inverte as cores principais mantendo o contraste e acessibilidade:
- Fundo escuro (tons de cinza próximos a preto)
- Elementos de UI em tons escuros de roxo
- Texto em tons claros para contraste adequado

### Mobile View
Em dispositivos móveis, a interface se adapta para um layout de coluna única:
```
┌────────────────────────┐
│       LOFIEVER         │
│                        │
│    PLAYER COMPONENT    │
│                        │
│    STATS COMPONENT     │
│                        │
│    CURATION COMPONENT  │
│                        │
│    © 2023 Lofiever     │
└────────────────────────┘
```

## Experiência do Usuário

A interface foi projetada para ser minimalista mas funcional, com elementos visuais que transmitem a vibe relaxante do lofi. A experiência do usuário prioriza:

- **Simplicidade**: Foco na experiência de audição sem distrações
- **Feedback Visual**: Estados de loading claros e tratamento de erros
- **Personalização**: Capacidade de ajustar o tipo de música via prompts de IA
- **Responsividade**: Experiência consistente em dispositivos móveis e desktop

## Perfomance e Acessibilidade

- Uso de imagens otimizadas via componente Image do Next.js
- Carregamento de estados para feedback visual imediato
- Uso de tratamento de erros para cenários de falha
- Semântica HTML adequada para acessibilidade

---

**Versão**: 0.1.0  
**Última Atualização**: Novembro 2023 