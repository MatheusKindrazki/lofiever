# TODO.MD - Roteiro de Implementação para o Lofiever

Este documento detalha as tarefas necessárias para reestruturar o projeto Lofiever, focando em um streaming de áudio sincronizado e uma geração de playlists dinâmica com IA.

## Fase 1: Reestruturação do Core de Streaming

**Objetivo:** Substituir a simulação de streaming por uma arquitetura de rádio 24/7 real, onde todos os usuários ouvem a mesma parte da música simultaneamente.

-   [ ] **1.1. Configurar o Servidor de Streaming Icecast:**
    -   [ ] Instalar o Icecast em um servidor de desenvolvimento.
    -   [ ] Configurar as fontes (`<source>`) e os pontos de montagem (`<mount>`) no `icecast.xml`.
    -   [ ] Proteger o acesso de administrador e de fonte com senhas seguras.
    -   [ ] Testar a conexão ao servidor Icecast com um cliente de áudio (ex: VLC).

-   [ ] **1.2. Instalar e Configurar o Liquidsoap:**
    -   [ ] Instalar o Liquidsoap no mesmo servidor ou em um servidor separado.
    -   [ ] Criar um script básico `.liq` para testar a conexão com o Icecast.
    -   [ ] Configurar o Liquidsoap para transcodificar o áudio para um formato compatível (ex: Opus ou AAC).
    -   [ ] Implementar a saída de áudio para o ponto de montagem do Icecast (`output.icecast`).

-   [ ] **1.3. Sincronização de Tempo com NTP:**
    -   [ ] Configurar o servidor (e, se possível, os clientes) para sincronizar com um servidor NTP (Network Time Protocol) público (ex: `a.ntp.br`). Isso garante uma base de tempo comum.

-   [ ] **1.4. (Opcional, mas recomendado) Mudar para o Protocolo DASH:**
    -   [ ] Pesquisar e implementar uma ferramenta (como o Shaka Packager ou Bento4) para segmentar o áudio do Icecast/Liquidsoap em fragmentos DASH.
    -   [ ] Gerar um `manifest.mpd` dinâmico.
    -   **Justificativa:** DASH oferece menor latência que os streams tradicionais de Icecast, essencial para a sincronização.

## Fase 2: Implementação da Playlist Dinâmica

**Objetivo:** Criar um sistema onde as músicas são adicionadas dinamicamente à playlist por uma IA, sem interromper o stream.

-   [ ] **2.1. Criar o Serviço de Geração de Playlist (Node.js):**
    -   [ ] Desenvolver um novo serviço/módulo em Node.js que será o "cérebro" da rádio.
    -   [ ] Criar uma API REST para que o Liquidsoap possa solicitar a próxima música.
    -   [ ] Implementar a lógica para consultar o motor de recomendação de IA (Fase 3).

-   [ ] **2.2. Integrar o Node.js com o Liquidsoap:**
    -   [ ] Modificar o script `.liq` para usar `request.dynamic` ou um protocolo customizado.
    -   [ ] Fazer o Liquidsoap chamar a API Node.js para obter a URL da próxima música.
    -   [ ] Implementar `fallbacks` no Liquidsoap (uma playlist de emergência) caso a API falhe.

-   [ ] **2.3. Adicionar Transições Suaves:**
    -   [ ] Usar a função `add_smart_crossfade` do Liquidsoap para criar transições suaves (crossfade) entre as músicas.

## Fase 3: Desenvolvimento da IA de Curadoria

**Objetivo:** Construir um motor de recomendação que selecione músicas com base em suas características sonoras.

-   [ ] **3.1. Preparar o Ambiente Python:**
    -   [ ] Configurar um ambiente virtual Python (`venv` ou `conda`).
    -   [ ] Instalar as bibliotecas necessárias: `pandas`, `scikit-learn`, `numpy`, `fastapi`.

-   [ ] **3.2. Análise e Preparação dos Dados:**
    -   [ ] Obter um dataset de músicas lofi com características de áudio (ex: do Kaggle ou via API do Spotify).
    -   [ ] Normalizar os dados (colocar as features na mesma escala) usando `StandardScaler` do scikit-learn.

-   [ ] **3.3. Treinar o Modelo de Clustering (K-Means):**
    -   [ ] Aplicar o algoritmo K-Means para agrupar as músicas em clusters com base em suas features (energia, dançabilidade, etc.).
    -   [ ] Experimentar com o número de clusters (`k`) para encontrar a melhor separação.
    -   [ ] Salvar o modelo treinado em um arquivo (`.pkl`) para não precisar retreinar a cada vez.

-   [ ] **3.4. Desenvolver a API de Recomendação (FastAPI):**
    -   [ ] Criar um endpoint na API que recebe uma música ou um cluster como entrada.
    -   [ ] Implementar a lógica para retornar uma música aleatória do mesmo cluster.
    -   [ ] Esta API será consumida pelo serviço Node.js da Fase 2.

## Fase 4: Integração com o Frontend e Backend Existente

**Objetivo:** Remover as bibliotecas e funcionalidades antigas e integrar a nova arquitetura.

-   [ ] **4.1. Remover Código Obsoleto:**
    -   [ ] **Remover `socket.io` e `socket.io-client`:** A sincronização agora é feita pelo stream do Icecast, não mais por eventos WebSocket. O chat pode ser mantido se desejado, mas a sincronização do player deve ser removida.
    -   [ ] **Remover `ioredis` para contagem de ouvintes:** O Icecast fornece essa informação nativamente através de sua API de status (`/status-json.xsl`).
    -   [ ] **Remover a lógica de "streaming simulado"** do backend e do frontend.
    -   [ ] **Arquivar o sistema de playlists versionadas:** A nova playlist é um fluxo contínuo e dinâmico.

-   [ ] **4.2. Integrar o Novo Player no Frontend (Next.js):**
    -   [ ] Substituir o player atual por um player de áudio compatível com streams Icecast/DASH (ex: `HTML5 <audio>`, `Dash.js`, ou `Shaka Player`).
    -   [ ] Configurar o player para apontar para a URL do seu stream Icecast (ex: `http://seu-servidor:8000/stream`).

-   [ ] **4.3. Exibir Informações em Tempo Real:**
    -   [ ] Criar uma rota no seu backend (API Routes do Next.js) que atue como um proxy para a API de status do Icecast.
    -   [ ] Fazer o frontend consultar essa rota para obter e exibir:
        -   O nome da música atual (`title`).
        -   O número de ouvintes (`listeners`).
    -   [ ] Usar `React Query` (`useQuery`) com um `refetchInterval` para atualizar essas informações periodicamente.

## Fase 5: Implantação e Monitoramento

**Objetivo:** Colocar a nova arquitetura em produção.

-   [ ] **5.1. Escolher a Estratégia de Hospedagem:**
    -   **Opção A (Auto-hospedagem):**
        -   [ ] Provisionar um servidor VPS (ex: DigitalOcean, Vultr, AWS EC2).
        -   [ ] Instalar e configurar Icecast, Liquidsoap e o ambiente Node.js/Python.
        -   [ ] Configurar um firewall e outras medidas de segurança.
    -   **Opção B (Serviços Gerenciados):**
        -   [ ] Contratar um serviço de hosting para Icecast.
        -   [ ] Implantar os serviços Node.js e Python em plataformas como Vercel, Heroku ou um VPS separado.

-   [ ] **5.2. Configurar o CI/CD:**
    -   [ ] Criar ou atualizar os pipelines de CI/CD (ex: GitHub Actions) para implantar as diferentes partes da aplicação (frontend, backend, serviços de IA).

-   [ ] **5.3. Monitoramento:**
    -   [ ] Configurar um sistema de logs e monitoramento (ex: o já implementado ou um novo como o Sentry) para acompanhar a saúde do Icecast, Liquidsoap e dos serviços de IA.
    -   [ ] Criar alertas para quando um dos serviços cair.
