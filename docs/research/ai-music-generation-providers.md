# Provedores de geração de música para o Lofiever

**Consulta:** 18 de julho de 2026
**Escopo:** músicas lo-fi instrumentais autorais de 2–3 minutos, geradas por solicitação do chat ou pela programação editorial automática.
**Metodologia:** somente documentação, preços e termos oficiais dos fornecedores. Valores em USD, sem impostos, armazenamento, transferência, transcodificação ou observabilidade.

## Recomendação

Usar **Google Lyria 3 Pro Preview como provedor principal do MVP** e **Stability AI Stable Audio 3.0 como fallback**.

O Lyria 3 Pro é o melhor encaixe funcional e econômico atual: produz uma música contínua de até 184 segundos, tem modo instrumental explícito, controle de duração/BPM/intensidade, execução em background e custa US$ 0,08 por faixa completa. O Google autoriza expressamente uso comercial e em produção desta Preview. Também incorpora SynthID e suporta C2PA. O risco é operacional: o modelo está em **Public Preview** e a Interactions API é experimental, portanto pode mudar sem a estabilidade de uma API GA. [Modelo](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-3) · [preço](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing) · [Interactions API](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/interactions-api)

O Stable Audio 3.0 é um fallback apropriado porque tem API pública assíncrona, gera até 380 segundos em MP3 ou WAV, custa US$ 0,26 por geração bem-sucedida e seus termos permitem uso comercial dos outputs. Ele não oferece um `force_instrumental`; isso precisa ser imposto pelo prompt e confirmado pela validação posterior. [API](https://platform.stability.ai/docs/api-reference) · [preço](https://platform.stability.ai/pricing) · [termos](https://stability.ai/terms-of-service)

Não usar ElevenLabs self-service sem autorização contratual: embora a API seja boa, os termos atuais excluem **radio** dos direitos de mídia em todos os planos self-service e no Enterprise Lite; somente Enterprise Music cobre todos os usos comerciais. Não usar wrappers de Suno: não há API oficial pública documentada e os termos proíbem scraping, robôs e acesso por meios não disponibilizados intencionalmente. [ElevenLabs Music Model-Specific Terms](https://elevenlabs.io/eleven-music-model-specific-terms) · [Suno Terms](https://suno.com/terms)

## Comparação executiva

| Provedor | API oficial | Faixa contínua | Instrumental | Execução | Saída relevante | Custo de 2–3 min | Proveniência | Veredito |
| --- | --- | ---: | --- | --- | --- | ---: | --- | --- |
| **Google Lyria 3 Pro Preview** | Sim, Public Preview | até 184 s | Modo explícito | Síncrona, SSE ou background | MP3, 44,1 kHz, 192 kbps | **US$ 0,08/faixa** | SynthID + C2PA | **Principal do MVP**, atrás de adapter e feature flag |
| **Stability Stable Audio 3.0** | Sim | até 380 s | Via prompt | Assíncrona, `202` + polling | MP3 ou WAV, 44,1 kHz estéreo | **US$ 0,26/faixa** | C2PA confirmado para WAV da API | **Fallback** e rota conservadora se Preview oscilar |
| **ElevenLabs Music v2** | Sim, plano pago | API aceita até 600 s | `force_instrumental` | Resposta completa ou streaming | padrão v2 MP3, 48 kHz, 192 kbps; outros formatos | **US$ 0,30–0,45** | C2PA opcional em MP3 | Bloqueio contratual para rádio self-service |
| **Google Lyria 2 (`lyria-002`)** | Sim, GA | 32,8 s por clip | Somente instrumental | Síncrona | WAV, 48 kHz | US$ 0,24–0,36 para 4–6 clips | SynthID | Não garante continuidade ao montar uma faixa |
| **Suno v5.5** | **Não foi localizada API pública oficial** | produto web suporta faixas longas | Toggle na UI | Fila da UI | MP3; WAV nos planos pagos | Sem tarifa de API | Não documentada oficialmente | Não integrar por wrappers/engenharia reversa |

## Análise por provedor

### 1. Google Lyria 3 Pro Preview

- **Disponibilidade:** `lyria-3-pro-preview`, global, lançado em Public Preview em 25/03/2026. A documentação da Preview diz expressamente que clientes podem usá-la para produção ou fins comerciais e divulgar o output a terceiros, sujeitos aos termos Pre-GA. [Model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-3)
- **Capacidade:** texto ou imagem para música; música completa de até 184 segundos; modo instrumental; controles de duração, BPM, intensidade e estrutura. Para o Lofiever, usar a instrução positiva `Instrumental.`; o Lyria 3 não expõe negative prompting e frases negativas acionaram filtros no smoke test. [Model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-3) · [prompt guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/music/music-gen-prompt-guide)
- **API/latência:** o Lyria 3 Pro responde de forma síncrona pela Interactions API e rejeitou `background: true` no smoke test. Não há latência numérica ou SLO de geração publicado para o Pro; o Lofiever mantém a operação assíncrona para o usuário por meio da própria fila BullMQ. [Interactions API](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/interactions-api)
- **Formato:** MP3 (`audio/mpeg`), 44,1 kHz, 192 kbps na API; a console também oferece download WAV. [Model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-3)
- **Preço:** US$ 0,08 por música completa de até três minutos; uma faixa de 2 ou 3 minutos custa o mesmo. [Preço oficial](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)
- **Direitos:** Generated Output é Customer Data e o Google não reivindica propriedade sobre nova propriedade intelectual criada no output. Outputs semelhantes podem ser entregues a outros clientes. Não assumir indenização de copyright: Lyria não aparece na lista atual de serviços de IA generativa indenizados. [Service Specific Terms](https://cloud.google.com/terms/service-terms) · [serviços indenizados](https://cloud.google.com/terms/generative-ai-indemnified-services)
- **Segurança e artistas:** filtros de entrada e saída, recitation checking, vocal-likeness e artist-intent checks. Todos os outputs do Lyria 3 recebem SynthID inaudível e suportam C2PA. O produto ainda deve bloquear nomes de artistas, músicas e pedidos de imitação antes do provedor. [Anúncio oficial](https://cloud.google.com/blog/products/ai-machine-learning/lyria-3-and-lyria-3-pro-on-vertex-ai) · [prompt guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/music/music-gen-prompt-guide)
- **Restrição etária:** os termos atuais proíbem oferecer um Generative AI Service em site ou app dirigido a, ou provavelmente acessado por, menores de 18 anos. A geração pedida pelo chat precisa de age gate 18+ enquanto esta cláusula vigorar. [Service Specific Terms, Generative AI Services](https://cloud.google.com/terms/service-terms)

#### Lyria 2 como alternativa GA

`lyria-002` é GA, mas gera somente clips instrumentais de 32,8 segundos em WAV 48 kHz. Custa US$ 0,06 por bloco de 30 segundos; montar 2–3 minutos custaria aproximadamente US$ 0,24–0,36 em 4–6 chamadas, sem garantia de continuidade musical. Serve para vinhetas, não como fallback de uma faixa autoral completa. [API Lyria 2](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/lyria-music-generation) · [modelo](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-002)

### 2. Stability AI Stable Audio 3.0

- **Disponibilidade:** API REST pública `v2beta`, com `POST /v2beta/audio/stable-audio/text-to-audio`. O Stable Audio 3.0 foi lançado na API em 20/05/2026. [API](https://platform.stability.ai/docs/api-reference) · [release notes](https://platform.stability.ai/docs/release-notes)
- **Capacidade:** gera composições de até 380 segundos, 44,1 kHz estéreo. Não há campo instrumental dedicado; use prompt como `instrumental lo-fi, no vocals, no spoken word` e valide o resultado. [API](https://platform.stability.ai/docs/api-reference)
- **API/latência:** assíncrona; a criação devolve HTTP `202` e um `id`, e o resultado é consultado em `/v2beta/audio/results/{id}`. A documentação recomenda polling a cada 10 segundos. Não há latência fim a fim publicada para o 3.0. O 2.5 é divulgado com inferência abaixo de dois segundos em GPU, mas esse número não deve ser extrapolado para a API 3.0. [API](https://platform.stability.ai/docs/api-reference) · [Stable Audio 2.5](https://stability.ai/news-updates/stability-ai-introduces-stable-audio-25-the-first-audio-model-built-for-enterprise-sound-production-at-scale)
- **Formato:** MP3 ou WAV; até 44,1 kHz estéreo. [API](https://platform.stability.ai/docs/api-reference)
- **Preço:** 26 créditos por resultado bem-sucedido; 1 crédito = US$ 0,01. Logo, qualquer geração de até 380 segundos custa US$ 0,26, inclusive uma faixa de 2–3 minutos. Falhas não são cobradas segundo a API. [Preço oficial](https://platform.stability.ai/pricing) · [getting started](https://platform.stability.ai/docs/getting-started)
- **Direitos:** entre cliente e Stability, o cliente possui o output na medida permitida pela lei; a FAQ autoriza uso comercial desde que o output não viole copyright. Isso não garante proteção autoral nem exclusividade. [Termos](https://stability.ai/terms-of-service) · [FAQ](https://platform.stability.ai/faq)
- **Treinamento e restrições:** o 3.0 foi treinado em dados licenciados da AudioSparx, com opt-out e remuneração de criadores. Uploads com material protegido são proibidos e passam por reconhecimento de conteúdo. Os termos também proíbem violação de direitos de terceiros e exigem identificar output de IA como tal. [Release notes](https://platform.stability.ai/docs/release-notes) · [termos](https://stability.ai/terms-of-service)
- **Proveniência:** a Stability informa que áudio WAV gerado pela API recebe metadados C2PA com modelo/versão e selo criptográfico. A mesma fonte não confirma isso para MP3. Conservar o WAV original e gerar um derivado de streaming é a opção mais auditável. [Integrity Transparency Report](https://stability.ai/news-updates/stability-ais-annual-integrity-transparency-report)

### 3. ElevenLabs Music v2

- **Disponibilidade:** API pública para assinantes pagos, com SDKs oficiais. `POST /v1/music` devolve o arquivo e `/v1/music/stream` entrega os bytes progressivamente. `music_v2` está disponível desde 15/06/2026. [Compose](https://elevenlabs.io/docs/api-reference/music/compose) · [stream](https://elevenlabs.io/docs/api-reference/music/stream) · [changelog](https://elevenlabs.io/docs/changelog/2026/6/15)
- **Capacidade:** `force_instrumental: true`; prompt simples ou composition plan com seções. A API aceita `music_length_ms` de 3.000 a 600.000 ms, até dez minutos. Há páginas de overview que ainda dizem cinco minutos; a divergência oficial não afeta o uso de 2–3 minutos. [Compose](https://elevenlabs.io/docs/api-reference/music/compose) · [overview](https://elevenlabs.io/docs/overview/capabilities/music)
- **API/latência:** a rota normal é síncrona e a rota de stream reduz o tempo percebido. Não foi localizado job assíncrono/webhook para Music nem latência numérica publicada; o Lofiever precisaria manter sua própria fila e timeout. [Stream](https://elevenlabs.io/docs/api-reference/music/stream)
- **Formato:** no modo `auto`, v1 devolve `mp3_44100_128` e v2 `mp3_48000_192`; a API enumera MP3, PCM/WAV, Opus, μ-law e A-law em diferentes taxas. [Compose](https://elevenlabs.io/docs/api-reference/music/compose) · [produto](https://elevenlabs.io/music-api)
- **Preço:** US$ 0,15 por minuto gerado: US$ 0,30 para dois minutos ou US$ 0,45 para três, além do plano pago. [Preço oficial](https://elevenlabs.io/pricing/api)
- **Direitos e bloqueio para o Lofiever:** os planos pagos permitem usos comerciais conforme a tabela, mas `Media Rights` exclui explicitamente **film, TV, radio & Studio Games** em todos os planos self-service e no Enterprise Music Lite. Somente Enterprise Music oferece todos os usos comerciais. Como o produto se descreve como rádio 24/7, tratar isso como bloqueio até obter Enterprise Music ou confirmação escrita de que uma web radio própria está coberta. Streaming em plataformas musicais de terceiros é uma categoria separada e não resolve essa ambiguidade. [Model-Specific Terms](https://elevenlabs.io/eleven-music-model-specific-terms)
- **Artistas/copyright:** é proibido enviar nomes de artistas/compositores, títulos de músicas/álbuns, gravadoras/editoras ou trechos identificáveis de letras; imitação de voz, aparência ou características identificáveis de artista também é proibida. Outputs podem não ser exclusivos. [Music Terms](https://elevenlabs.io/music-terms)
- **Proveniência:** `sign_with_c2pa: true` assina MP3 opcionalmente. A documentação não afirma que toda geração musical leva watermark obrigatório. [Compose](https://elevenlabs.io/docs/api-reference/music/compose) · [changelog C2PA](https://elevenlabs.io/docs/changelog/2025/12/8)

### 4. Suno

- **API:** em 18/07/2026, não foi localizado portal, referência, chave ou tarifa de uma API pública oficial da Suno. O serviço oficial documentado é web/mobile. Sites que vendem “Suno API” e wrappers de endpoints internos não são fontes oficiais.
- **Impedimento de integração:** os termos proíbem robôs, scraping, data extraction e obter conteúdo por meios não intencionalmente disponibilizados. Portanto, automatizar conta web, cookies ou endpoints internos não é um caminho aceitável para produção. [Terms of Service](https://suno.com/terms)
- **Produto, não API:** a UI tem toggle instrumental, fila com aviso quando a música fica pronta, downloads MP3 e WAV para Pro/Premier e modelos atuais capazes de faixas longas. Isso demonstra capacidade criativa, mas não cria um contrato de integração. [Modo instrumental](https://help.suno.com/en/articles/3726721) · [downloads](https://help.suno.com/en/articles/2409921) · [model timeline](https://help.suno.com/en/articles/5782721)
- **Preço não comparável:** Pro custa US$ 8/mês no anual e inclui 2.500 créditos, anunciados como cerca de 500 músicas; Premier custa US$ 24/mês no anual e inclui 10.000 créditos. Isso implica cerca de US$ 0,016 ou US$ 0,012 por música incluída, respectivamente, mas é custo de produto/assinatura, **não tarifa de API nem autorização para automação**. [Pricing](https://suno.com/pricing) · [planos](https://help.suno.com/en/articles/2410049)
- **Direitos:** músicas criadas durante Pro/Premier recebem direitos comerciais e podem ser distribuídas, usadas em filme/TV/games e vendidas; a Suno ressalva que isso não garante copyright. No plano gratuito, o uso é somente não comercial. [Direitos pagos](https://help.suno.com/en/articles/9601665) · [ownership/copyright](https://help.suno.com/en/articles/2746945)
- **Proveniência:** não foi localizada, nas fontes oficiais consultadas, documentação de watermark ou C2PA para os arquivos de música da Suno. Não assumir que exista ou que sobreviva ao download.

## Cota e cadência recomendadas

### Solicitações do chat

- **1 música concluída por usuário autenticado a cada dia**, com reset em UTC e sem acumular saldo.
- **Teto global inicial de 20 músicas de usuários por dia**. Ao atingir o teto, informar que a cota do dia encerrou; não deixar uma fila sem limite.
- Uma solicitação recusada antes da geração não consome a cota. Uma geração tecnicamente inválida pode ter uma única retentativa automática sem consumir nova cota do usuário.
- Exigir conta verificada e **18+** enquanto o Lyria estiver sujeito à atual restrição etária do Google.
- Uma música aprovada automaticamente entra entre as próximas faixas, mas no máximo uma solicitação prioritária por vez; as demais ficam em ordem de conclusão para não sequestrar a programação.

Essa cota é deliberadamente simples: reduz abuso e spam, preserva o valor social de pedir uma música e produz dados suficientes para medir demanda, taxa de aprovação e custo antes de liberar mais. Reavaliar em 30 dias usando p95 de espera, percentual de usuários que esgota a cota, taxa de falha/regeração e custo por faixa efetivamente tocada.

### Geração editorial automática

- **Fase de formação do catálogo:** 2 faixas por dia, em horários separados, até chegar a aproximadamente 300 faixas autorais aprovadas.
- **Depois de 300 faixas:** reduzir para 3 novas faixas por semana, além das solicitações dos usuários.
- Variar uma matriz editorial de BPM, energia, instrumentação e período do dia; não variar por nome de artista.
- Faixas editoriais entram naturalmente na rotação, sem prioridade de “próximas faixas”.

### Estimativa mensal do MVP

Premissas de mês de 30 dias, cota global totalmente usada, 2 faixas editoriais/dia e uma geração por faixa:

| Origem | Faixas/mês | Lyria 3 Pro a US$ 0,08 | Stable Audio 3.0 a US$ 0,26 |
| --- | ---: | ---: | ---: |
| Usuários: 20/dia | 600 | US$ 48,00 | US$ 156,00 |
| Editorial: 2/dia | 60 | US$ 4,80 | US$ 15,60 |
| **Total-base** | **660** | **US$ 52,80** | **US$ 171,60** |
| **Com 25% de folga para regenerações** | **até 825 tentativas** | **US$ 66,00** | **US$ 214,50** |

Num cenário operacional razoável em que 10% das 660 faixas migram para o fallback e há 25% de folga, reservar aproximadamente **US$ 81/mês** para geração. Recomenda-se configurar um **hard budget de US$ 100/mês** no MVP e um kill switch. Se todo o tráfego precisar migrar para Stability, elevar temporariamente o teto para **US$ 250/mês** ou reduzir a cota global.

Depois que o catálogo atingir 300 faixas, a cadência editorial de 3/semana representa cerca de 13 faixas/mês: US$ 1,04 no Lyria ou US$ 3,38 no Stable Audio, antes de retentativas.

## Guardrails obrigatórios para a validação automática

A licença comercial do provedor não substitui a validação do Lofiever. Antes de publicar ou enfileirar uma faixa:

1. Rejeitar no prompt nomes de artistas, compositores, músicas, álbuns, gravadoras, personagens/vozes identificáveis e termos como “no estilo de”; converter pedidos válidos em descritores de gênero, BPM, instrumentos, textura e humor.
2. Aplicar moderação de texto antes da geração e manter o identificador pseudonimizado do usuário nos metadados enviados ao provedor quando suportado.
3. Validar duração, decodificação, silêncio, clipping, loudness, true peak, presença de fala/vocal e transições abruptas.
4. Gerar fingerprint e recusar duplicata ou similaridade acima do limiar com o catálogo existente e com uma biblioteca de referência autorizada.
5. Guardar `provider`, `model`, `prompt_normalizado`, `seed` quando existir, timestamps, hashes do original/derivado, resultado dos validadores e C2PA/SynthID detectável.
6. Identificar publicamente a faixa como gerada com IA; não prometer copyright, exclusividade ou autoria humana.
7. Fazer no máximo uma retentativa automática. Depois disso, marcar como falha e devolver a cota ao usuário.

## Decisão operacional

1. Implementar uma interface de provider que trate toda geração como job assíncrono, mesmo quando o fornecedor tiver resposta síncrona/streaming.
2. Iniciar com `lyria-3-pro-preview`, faixa-alvo de 150–180 segundos, modo instrumental e C2PA/SynthID preservados.
3. Acionar `stable-audio-3` quando o Lyria falhar, estiver indisponível, mudar de contrato/schema ou rejeitar um prompt que continue válido após normalização.
4. Antes de abrir para usuários, fazer um bake-off interno de pelo menos 50 prompts lo-fi idênticos nos dois provedores e medir aprovação automática, vocal acidental, defeitos de áudio, latência p50/p95 e custo por faixa aprovada.
5. Reavaliar o uso principal do Lyria quando houver mudança de Preview para GA. Reavaliar ElevenLabs apenas com confirmação contratual sobre web radio; reavaliar Suno somente se a própria Suno publicar API e termos de integração.

> Esta pesquisa orienta produto e engenharia; não é parecer jurídico. Os termos, modelos e preços podem mudar e devem ser reconferidos antes do lançamento público.
