# RFC 0001 — Fábrica híbrida local de música lo-fi (300–400 faixas autorais)

| Campo | Valor |
| --- | --- |
| **Status** | `Draft` — pesquisa externa obrigatória **completa** em 2026-08-22 (§0.2). **Não aprovado. Não implementado. Nenhum benchmark executado.** |
| **Owners** | Matheus Kindrazki (decisão de produto/orçamento) · CTO Lofiever (arquitetura, spike) |
| **Data** | 2026-08-22 |
| **Work-Control-ID** | `01a029e0-7453-7fe6-bf84-94a3c23bc037` |
| **Escopo** | Gerar, avaliar, masterizar e publicar 300–400 faixas lo-fi instrumentais autorais |
| **Alvo de execução** | MacBook Pro M5 Max 128 GB (worker principal) · Mac Mini M4 Pro 24 GB (suporte) |
| **Tipo de mudança** | Documentação. **Nenhum código é alterado por este RFC.** |
| **Supersede** | Nada. **Complementa e corrige** `docs/QUALITY-PROCESS.md` e complementa `docs/features/ai-original-music.md` |

---

## 0. Como ler este documento

### 0.1 Classificação epistemológica (obrigatória e visível)

Toda afirmação relevante deste RFC carrega uma etiqueta. Sem etiqueta, é texto de contexto ou
design interno, não uma alegação de fato.

| Etiqueta | Significado | Como se torna verdade |
| --- | --- | --- |
| **PÚBLICO** | Confirmado em fonte externa oficial, citada inline `[n]` | Já citado |
| **MEDIDO** | Medição real do spike deste projeto | Hoje **vazio/TBD** em todo o documento |
| **DERIVADO** | Conta/fórmula reproduzível a partir de entradas explícitas declaradas no próprio texto | Recalcular com as entradas |
| **ESTIMADO** | Hipótese operacional a calibrar com dado do piloto | Substituir por MEDIDO após onda 2 |
| **HIPÓTESE** | Decisão de design ainda não validada; pode cair | Resolver em §18 open questions |
| **NÃO VERIFICADO** | Alegação externa que **permanece sem fonte primária** depois da pesquisa de §0.2 | Ver §20.2 antes de agir |

**Duas camadas de `PÚBLICO`, e a diferença importa.** §20.1 separa as citações em dois grupos, e
cada citação inline herda o grupo do seu número:

- **`[1]`–`[44]` — verificadas em 2026-08-22**, nesta passagem, contra fonte primária, com
  permalink de commit/revisão onde a fonte é repositório ou model card.
- **`[45]`–`[50]` — transcritas de `docs/research/ai-music-generation-providers.md`**, consulta de
  **2026-07-18**, e **não reconferidas em 2026-08-22**. Onde uma dessas sustenta a única evidência
  de um claim, o texto diz `PÚBLICO (2026-07-18, não reconferido)`.

Regras que este RFC segue e que o revisor deve cobrar:

1. **Nenhuma linha `MEDIDO` está preenchida.** Não existe medição de M5 Max nem de M4 Pro neste
   projeto. Todas as células de performance são `TBD` até a onda 1 (§14).
2. **Não há benchmark de M5 Max ou M4 Pro apresentado como `MEDIDO` neste RFC.** Qualquer número
   de RTF, tokens/s ou tempo de parede que apareça aqui é `TBD` ou uma fórmula simbólica — nunca
   um valor herdado de outra máquina, outro chip ou outro modelo. Onde uma fonte oficial publica
   número de outra máquina (por exemplo o M4 Pro 48 GB do PR #1042 de ACE-Step [10]), ele aparece
   rotulado como **`PÚBLICO` sobre hardware de terceiro**, e explicitamente **não** como medição
   deste projeto.
3. **Nenhum tempo de parede é derivado sem RTF medido.** §10 entrega fórmulas simbólicas e
   cenários explicitamente `ESTIMADO`, com a entrada `RTF` isolada como variável livre.
4. **Nenhuma URL, comando ou flag foi inventado.** Todo comando de ferramenta de terceiro em §9 e
   §11 vem citado do arquivo oficial que o define. Onde a flag não existe, o texto diz que não
   existe, em vez de propor uma plausível.

### 0.2 Estado da pesquisa externa — **concluída em 2026-08-22**

O mandato deste RFC exigia pesquisa primária em fontes oficiais atuais sobre ACE-Step 1.5,
DiffRhythm2, Google Lyria 3/3 Pro, MiniMax Music 1.5 e licenças de descarte. **Essa pesquisa foi
executada e está fechada.** A limitação de sandbox que travava a primeira passagem deste documento
não se aplica mais: a pesquisa foi refeita de forma independente em fontes primárias, com
permalinks e citações literais verificadas. O registro versionado está na seção Fontes (§20.1):
ACE-Step usa código em `14c0211d5a0653b0f63e27686f4c3f151b4d8629` e model cards em revisões
imutáveis; DiffRhythm2 usa código em `7804f821b797b4f276090e1a9dcd37e97d9915d5`, model card e Space
em revisões imutáveis; Google, MiniMax, Replicate e Meta usam as páginas primárias consultadas em
2026-08-22.

Consequências, explícitas:

- **§7 (alternatives matrix) está preenchida com fato PÚBLICO**, distinguindo em cada linha
  **código**, **pesos**, **outputs** e **termos** — que são quatro objetos jurídicos diferentes e
  frequentemente divergentes no mesmo projeto.
- **§9 (setup) é reproduzível e exata para ACE-Step 1.5**, com comandos e nomes de parâmetro
  citados dos arquivos oficiais. **Nada em §9 foi executado, instalado ou testado.** Ela é uma
  receita verificada na fonte, não um relato de execução.
- **§2 (decisão) mudou.** ACE-Step 1.5 passa a candidato local principal *condicionado ao spike*;
  DiffRhythm2 cai a challenger de baixo fit no Mac; MiniMax Music 1.5 oficial sai da mesa como
  integração nova; MusicGen é descartado por licença de pesos. Detalhe e evidência em §7.
- **O que continua faltando é performance, não pesquisa.** O gate de aprovação deixou de ser
  "verificar fontes" e passou a ser "executar a onda 1" (§11): `RTF`, pico de memória, teto de
  batch e taxa de aprovação automática **neste** hardware. §20.2 registra o que foi verificado e
  as **lacunas residuais reais** — que são poucas, nomeadas, e nenhuma delas bloqueia a decisão
  de §2.

**O que este RFC ainda não é:** aprovado, implementado, nem medido. A pesquisa obrigatória está
completa; a execução não começou.

---

## 1. Resumo executivo

O Lofiever já tem um estúdio de geração musical funcionando: fila BullMQ, provider Google Lyria 3
Pro, validação fail-closed com `ffprobe`/`ffmpeg`, upload no R2, criação de `Track` e publicação na
rotação. Ele foi dimensionado para **uma faixa por vez, sob demanda** — concorrência 1, uma
retentativa, orçamento mensal único de US$ 100 por padrão.

Este RFC propõe **estender** esse control plane para uma campanha de catálogo: produzir 300–400
faixas aprovadas gerando 900–2000 candidatas, com a geração pesada rodando **localmente** nos dois
Macs em vez de na API, e com a publicação deixando de ser automática e passando a ser
explicitamente aprovada.

Três mudanças estruturais, e nada além delas:

1. **Um segundo caminho de execução, não um segundo sistema.** Um `LocalMusicProvider` que
   implementa a interface `MusicGenerationProvider` já existente
   (`src/services/music-generation/types.ts:56`), falando com um servidor HTTP versionado nos
   Macs. O caminho de pedido de usuário não muda em nenhum byte.
2. **Um nível de agregação novo: a campanha.** Hoje o domínio é `MusicGeneration` = 1 pedido = 1
   faixa publicada. A campanha precisa de `Campaign → StyleCard → Candidate`, onde candidata
   reprovada é um resultado normal e barato, não uma falha. Fila separada, tabelas separadas,
   mesma Redis, mesmo Postgres, mesmo R2.
3. **Publicação com gate explícito.** Hoje `worker.ts:176` chama `finalizePublishedTrack` logo
   após criar a `Track`: sucesso técnico **é** publicação. Para 2000 candidatas isso é
   inaceitável. A campanha grava candidatas que **não são `Track`**, e promover a `Track` é uma
   ação separada, auditável e reversível.

O que este RFC **não** propõe: trocar o Lyria, reescrever o worker existente, abandonar a API,
mexer no streaming/Liquidsoap, ou tratar a máquina interativa do dono como servidor dedicado.

**Prontidão honesta:** a arquitetura, o spike, a capacidade simbólica e a quality factory estão
prontos para implementar. A pesquisa de fornecedores está fechada (§0.2), e com ela a escolha do
**candidato** local: **ACE-Step 1.5**, cujo código e pesos oficiais são MIT e cujo model card
afirma uso comercial dos outputs (§7.3). O que continua aberto é se ele **entrega performance
aceitável neste hardware** — isso é a onda 1, e nenhum número dela existe hoje.

---

## 2. Decisão

### 2.1 O que está decidido por este RFC

| # | Decisão | Reversível? |
| --- | --- | --- |
| D1 | A campanha de catálogo é um **fluxo novo** (`Campaign`/`Candidate`/fila própria), não uma mudança no fluxo de pedido de usuário | Sim — o fluxo novo pode ser deletado |
| D2 | A geração local entra pela fronteira `MusicGenerationProvider` já existente, via **protocolo HTTP versionado** (`/v1/...`), nunca por `child_process` no processo Node | Sim |
| D3 | **Publicação da campanha é gated.** Candidata aprovada não é `Track` até promoção explícita | Sim, e é o gate que torna tudo o mais reversível |
| D4 | **Idempotência por hash de candidata.** Retomada = recomputar a chave e pular o que existe | Sim |
| D5 | **Nenhuma faixa da campanha vai ao ar antes do fim da onda 2** (piloto de 50 gerações) | Sim |
| D6 | Referências de áudio são **locais, hasheadas, e nunca enviadas a API externa** sem opt-in por artefato | Sim, mas um envio indevido é **irreversível** — ver §15 |
| D7 | **ACE-Step 1.5 é o candidato local principal, condicionado ao spike.** Código e pesos oficiais MIT [7][8][9]; o model card afirma uso comercial dos outputs [8][9]. Suporte oficial a Apple Silicon com PyTorch `mps` + backend `mlx` [3][6] | Sim — o candidato pode ser reprovado pela onda 1 |
| D8 | Lyria permanece como fallback e como gerador de **faixas-âncora** de calibração | Sim |
| D9 | O orçamento da campanha é **separado** do orçamento mensal do estúdio de usuários | Sim |
| D10 | **DiffRhythm2 é challenger de baixo fit no Mac**, e só de pesquisa. O seletor de device oficial é `cuda if available else cpu` — não há MPS, então no Mac cai em **CPU** [17]; e instrumental-only é TODO declarado, não recurso [16]. Não é plano primário de nenhuma das duas máquinas | Sim |
| D11 | **MiniMax Music 1.5 oficial não é integração nova.** O modelo não consta no catálogo nem na tabela de preços atual [38][39], e desde 2026-08-20 as APIs pagas de música não aceitam novos usuários [38]. Replicate entra como **host terceiro comparativo**, não como fornecedor | Sim |
| D12 | **MusicGen é descartado.** Pesos oficiais em CC BY-NC 4.0 [43][44]; o código MIT não neutraliza a restrição dos pesos | Não precisa voltar — é R7 |

### 2.2 O que está explicitamente NÃO decidido

- **Se ACE-Step 1.5 entrega performance aceitável nos dois Macs.** `RTF`, pico de memória, teto de
  batch: onda 1. §10, §11.
- Batch size, concorrência e duty-cycle por máquina — saem do spike. §10, §11.
- Todos os thresholds numéricos de qualidade — `ESTIMADO`, calibrados na onda 2. §13.
- Se `reference_audio` entra em produção ou fica restrito ao spike. §12.4.

**O que deixou de estar aberto** (e a diferença em relação à primeira passagem deste RFC):

- *"Qual modelo local"* — respondido no nível de **candidato**: ACE-Step 1.5 (D7), com DiffRhythm2
  como challenger de pesquisa (D10). Falta o veredito de performance, não o de escolha.
- *"Se a licença dos pesos permite uso comercial"* — **não é mais bloqueador legal aberto** para
  ACE-Step: pesos marcados MIT e uso comercial dos outputs afirmado no model card [8][9]. Ver a
  ressalva de §7.3 e §15.1: **afirmação de model card não é garantia jurídica**, e este RFC não a
  vende como tal.

### 2.3 Critérios de decisão (como fechar o modelo local, na onda 1)

Ordem lexicográfica: um critério só é avaliado se todos os anteriores passaram. Isso é
deliberado — não existe média ponderada que compense licença incompatível.

A coluna **Estado (2026-08-22)** é o que a pesquisa de §0.2 já resolveu. Onde ela diz `PÚBLICO`, o
critério está satisfeito **na documentação oficial**; onde diz `TBD`, só a execução responde.

| Ordem | Critério | Gate | ACE-Step 1.5 — estado (2026-08-22) | DiffRhythm2 — estado |
| --- | --- | --- | --- | --- |
| 1 | **Licença dos pesos permite uso comercial do output** | Binário. Falha = descarte imediato, sem spike | ✅ `PÚBLICO` — cards marcam `license: mit` e afirmam uso comercial dos outputs [8][9] | ✅ `PÚBLICO` — Apache-2.0 para código **e** pesos [16][22][23]; **sem** licença autônoma de outputs (§7.4) |
| 2 | **Licença do código permite uso interno/servidor** | Binário | ✅ `PÚBLICO` — MIT [7] | ✅ `PÚBLICO` — Apache-2.0 [22] |
| 3 | **Roda no macOS Apple Silicon** (MPS ou MLX) sem CUDA | Binário | ✅ `PÚBLICO` na documentação — `--device mps` + `--lm-backend mlx`, launchers macOS próprios [3][6]. **Execução real: `TBD` (onda 1)** | ❌ `PÚBLICO` **negativo** — seletor é `cuda if available else cpu`; no Mac cai em CPU [17] |
| 4 | **Gera instrumental sem vocal** de forma controlável | Binário — o validador atual é fail-closed em vocal (`audio-validator.ts:215`) | ✅ `PÚBLICO` — no REST principal via `lyrics` vazio ou `[Instrumental]` [14]; `instrumental` existe na API Python [5]. **Confiabilidade: `TBD`** | ❌ `PÚBLICO` **negativo** — instrumental-only é TODO [16] |
| 5 | **Duração alvo alcançável** em uma passada (§13.1 fixa a janela 150–184 s) | Binário | `TBD` — a matriz default do benchmark oficial cobre 30/60/120/240 s [6], o que **cerca** a janela, mas não é medição nossa | ✅ `PÚBLICO` — até 210 s publicados [25] |
| 6 | **API headless/batch existe** (sem UI obrigatória) | Binário | ✅ `PÚBLICO` — `uv run acestep-api` (REST, porta 8001) [2][3]; `batch_size` default 2, máx 8 [4] | ⚠️ Parcial — CLI headless com JSONL **sequencial** [17][20]; **nenhuma REST local documentada** [16][23] |
| 7 | **Taxa de aprovação automática** ≥ gate da onda 1 | Comparativo | `TBD` | `TBD` |
| 8 | **RTF amortizado** e memória de pico | Comparativo | `TBD` | `TBD` |
| 9 | Suporte a `reference_audio` com força controlável | Desejável, não gate | ✅ `PÚBLICO` — `reference_audio` (estilo) e `audio_cover_strength` 0–1, default 1.0 [4][5] | ✅ `PÚBLICO` — `style_prompt` aceita áudio; >10 s é cortado em trecho aleatório de 10 s [17][27] |

**Leitura da tabela.** DiffRhythm2 reprova em 3 e 4 — os dois binários que decidem o *fit no Mac* —
e é por isso que D10 o classifica como challenger de pesquisa, não plano primário. ACE-Step 1.5
passa 1, 2, 4, 6 e 9 na documentação e chega à onda 1 com 3, 5, 7 e 8 abertos.

**Go/no-go da campanha local** (fim da onda 1): critério 1–6 aprovados **na execução** para ao
menos um modelo, **e** custo marginal local por candidata aprovada menor que o custo API
equivalente, **e** saturação da máquina interativa dentro do limite de §10.5. Falhando qualquer um:
a campanha roda por API com orçamento explicitamente aprovado, e o caminho local é arquivado — não
empurrado.

---

## 3. Estado atual do repositório (o que **já existe**)

Esta seção é fato de código, lido nesta sessão. É a linha de base contra a qual tudo o que vem
depois é proposta. Nada aqui é a implementar.

### 3.1 Control plane de geração — existe

| Componente | Arquivo | Comportamento real |
| --- | --- | --- |
| Fila | `src/services/music-generation/queue.ts:5` | BullMQ, fila única `lofiever-music-generation`, `jobId = generationId` (enqueue idempotente) |
| Retry | `queue.ts:23-28` | `attempts` de config (default 2), backoff exponencial 15 s |
| Worker | `worker.ts:219-232` | **concorrência 1**, `lockDuration` 15 min |
| Provider boundary | `types.ts:56`, `provider.ts:8` | Interface `MusicGenerationProvider` + factory por `config.musicGeneration.provider`; hoje só `google-lyria` é aceito |
| Provider Lyria | `lyria-provider.ts` | Interactions API [45], poll de 10 s, teto de 12 min, exige `audio/mpeg` |
| Política de prompt | `prompt-policy.ts` | Bloqueia imitação, vocal e conteúdo inseguro; redige PII; clampa BPM 55–95 e duração `min(184, max(150, …))` |
| Validação | `audio-validator.ts` | Fail-closed: `ffprobe`, silêncio, pico, vocal via Whisper, normalização, hash |
| Cotas/orçamento | `service.ts:124-222` | Transação `Serializable`, cota diária por usuário e IP, teto global, **orçamento mensal único** |
| Publicação | `worker.ts:145-176` | Cria `Track` e publica **na mesma transação lógica** |
| Storage | `worker.ts:139-143` | R2: `music/generated/{id}/original.mp3` + `streaming.mp3` |
| Editorial | `editorial.ts` | Scheduler horário, lock Redis, 6 direções fixas, meta de catálogo 300 |
| Domínio | `prisma/schema.prisma:203` | `MusicGeneration` com `audioSha256 @unique`, `idempotencyKey @unique`, `trackId @unique` |

### 3.2 Sete propriedades do sistema atual que a campanha **quebra**

Não são bugs. São decisões corretas para "uma faixa sob demanda" e erradas para "2000 candidatas".
A arquitetura de §8 existe para resolver exatamente estas sete.

| # | Propriedade atual | Por que quebra em escala de campanha |
| --- | --- | --- |
| P1 | **Sucesso técnico = publicação.** `worker.ts:176` publica logo após criar a `Track` | 2000 candidatas viram 2000 faixas no ar. Não existe estado "aprovada tecnicamente, reprovada editorialmente" |
| P2 | **`MusicGeneration` é 1:1 com `Track`** (`trackId @unique`) | Não há como representar "5 candidatas do mesmo style card, 1 promovida" |
| P3 | **Dedupe é só `sha256` exato** do MP3 **normalizado** (`worker.ts:124-137`) | Pega apenas bit-identidade. Duas candidatas quase idênticas passam as duas |
| P4 | **Concorrência 1, uma fila** | Não há paralelismo, nem roteamento por máquina/capability |
| P5 | **Orçamento mensal único** (`service.ts:190-199`) | Uma campanha de 1200 candidatas na API consome ~US$ 96 (§16.1) e **mata a cota de usuário** dentro do default de US$ 100 |
| P6 | **`Track.bpm` vem do prompt**, nunca do áudio (`worker.ts:154`) | O catálogo afirma um BPM que ninguém mediu. §13 corrige |
| P7 | **Custo por tentativa é literal `0.08` em três lugares** — `service.ts:217`, `lyria-provider.ts:75`, `schema.prisma:222` | Trocar provider ou preço exige mudar três arquivos e uma migration |

### 3.3 O que o `docs/QUALITY-PROCESS.md` já dá — e o que nele precisa de correção

`docs/QUALITY-PROCESS.md` (originado no commit `924c017`) é a melhor fonte existente para o desenho
de gates, estrutura de style card e cadência. Ele foi escrito antes de o pipeline atual existir e
continha divergências concretas com o código e com sua própria aritmética. Esta mudança já aplica
as correções bloqueantes de semântica de similaridade, gates não compensáveis e providers
compatíveis; §6 registra o conjunto completo que a implementação deve respeitar.

---

## 4. Objetivo e definição de pronto

**Objetivo:** 300–400 faixas lo-fi instrumentais autorais, tituladas, creditadas a `Lofine DJ`
(`constants.ts:1`), aprovadas por gate automático + amostragem humana, masterizadas de forma
consistente, dedupadas, e publicáveis progressivamente no catálogo do Lofiever.

**Definição de "faixa aprovada"** (`ESTIMADO` nos números, estrutural na forma):

Uma candidata é *aprovada* quando, e só quando, todas as condições valem:

1. passa todos os gates técnicos de §13.2 (fail-closed: gate que não roda = reprovado);
2. passa o gate de similaridade contra referências **e** contra o catálogo (§13.3);
3. passa o gate de fingerprint/dedupe (§13.4);
4. foi ouvida por humano **ou** caiu na fatia auto-aprovável definida por §13.6 com auditoria;
5. foi masterizada e **revalidada após a masterização**;
6. tem manifesto de proveniência completo e verificável (§8.6).

**Não é aprovação:** ter sido gerada; ter passado no `audio-validator.ts` atual; existir no R2.

---

## 5. Restrições

| # | Restrição | Origem |
| --- | --- | --- |
| R1 | Sem nome de artista, banda, música, álbum, gravadora ou marca em prompt ou style card | `QUALITY-PROCESS §12.1`; filtros de recitação/semelhança vocal do próprio Lyria [33]; proibição explícita nos termos da ElevenLabs [50]; pedido de verificação de originalidade e de permissão ao adaptar estilo protegido nos READMEs de ACE-Step [1] e DiffRhythm2 [16] |
| R2 | Somente instrumental. Vocal detectado é reprovação, não aviso | `prompt-policy.ts:102`, `audio-validator.ts:215` |
| R3 | O MacBook é a máquina **interativa** do dono. A campanha não pode degradá-la | §10.5 |
| R4 | Referências de áudio ficam **locais**. Nada de referência sai para API sem opt-in por artefato | §15.2 |
| R5 | Nenhuma faixa vai ao ar antes do gate humano da onda | D5 |
| R6 | O caminho de pedido de usuário não pode regredir | D1 |
| R7 | Licença incompatível é descarte, não risco gerenciado | §2.3 critério 1 |
| R8 | Sem segredo real em arquivo versionado. Nenhum log com áudio, PII ou segredo | §15.4 |

---

## 6. Correções normativas integradas ao `docs/QUALITY-PROCESS.md`

As correções bloqueantes abaixo foram aplicadas ao `docs/QUALITY-PROCESS.md` nesta mesma mudança
para que o playbook não recomende um fluxo inseguro enquanto a implementação é dividida em PRs.
Este RFC continua sendo a especificação normativa da campanha; os thresholds permanecem
`ESTIMADO` e só se tornam operacionais depois do piloto.

### C1 — "distância" vs "similaridade" está invertida no nome (bug real, não estilo)

`QUALITY-PROCESS §7` tem duas linhas nomeadas **distância**:

> `Reference embedding distance` | `≤ 0.70 cosine` | reject if `> 0.85` | "too close to original references"
> `Catalog embedding distance` | `≤ 0.75 nearest neighbor` | reject if `> 0.85` | "near-duplicate"

A justificativa ("too close", "near-duplicate") só é coerente se a métrica for **similaridade**:
com distância, valor **alto** significa **mais original**, e rejeitar por distância alta é o
oposto do objetivo. O próprio arquivo confirma a leitura correta em `§12.2`, que fala em
`Embedding similarity ... ≤ 0.85 (soft) e ≤ 0.90 (hard reject)`, e em `§9`, que sinaliza pares com
`cosine similarity > 0.85`.

Além de invertida no nome, a numeração é **internamente inconsistente**: `§7` reprova acima de
0.85, `§12.2` reprova em definitivo acima de 0.90 e apenas sinaliza acima de 0.85.

**Correção normativa.** Uma única escala em todo o pipeline: **similaridade de cosseno**,
domínio `[-1, 1]`, mesmo modelo de embedding para referência, catálogo e candidata. Três bandas
por eixo, sem faixa não definida:

| Eixo | Aceita | Sinaliza (escuta humana obrigatória) | Reprova |
| --- | --- | --- | --- |
| Similaridade × referência | `< 0.80` | `0.80 ≤ s < 0.88` | `≥ 0.88` |
| Similaridade × catálogo (vizinho mais próximo) | `< 0.82` | `0.82 ≤ s < 0.90` | `≥ 0.90` |

`ESTIMADO`. Estes seis números não têm base empírica neste projeto e **não são verdades
universais** — similaridade de cosseno não é comparável entre modelos de embedding diferentes,
nem entre versões do mesmo modelo. Eles são pontos de partida a calibrar na onda 2 contra
distribuição real (§13.7), e devem ser versionados junto do modelo de embedding que os produziu.

### C2 — A função de `qualityScore` está aritmeticamente quebrada

`QUALITY-PROCESS §7`:

```
qualityScore = 0.35*technicalPass + 0.25*referenceDistanceOk + 0.20*catalogDistanceOk + 0.20*humanRating
qualityScore >= 0.75  →  elegível
```

Dois defeitos, ambos `DERIVADO` da própria fórmula:

1. **O gate é satisfeito sem nenhum humano.** Com os três primeiros termos booleanos em 1 e
   `humanRating = 0`: `0.35 + 0.25 + 0.20 = 0.80 ≥ 0.75`. O termo humano é decorativo.
2. **O gate é satisfeito sem nenhuma qualidade técnica.** `humanRating` está na escala 1–5 do
   `§8`. Com todos os gates técnicos reprovados e `humanRating = 4`:
   `0.20 × 4 = 0.80 ≥ 0.75`. O máximo da fórmula é `0.35+0.25+0.20+0.20×5 = 1.80`, então o
   limiar `0.75` não significa "75%" de nada.

**Correção normativa.** Separar o que é **gate** do que é **ranking** — misturar os dois foi a
causa raiz:

- **Gates são booleanos e bloqueantes.** Técnico, similaridade e fingerprint. Reprovou = fora.
  Nenhuma nota compensa. Fail-closed: gate que não executou conta como reprovado.
- **`qualityScore` só existe para *ordenar* candidatas que já passaram todos os gates** — para
  escolher qual promover dentro de um cluster de dedupe e para priorizar a fila de escuta.

```
# só definido para candidatas com todos os gates = pass
qualityScore = 0.45 * humanRating01
             + 0.25 * (1 - refSimNorm)
             + 0.20 * (1 - catSimNorm)
             + 0.10 * technicalMargin01
```

onde: `humanRating01 = (mediaHumana - 1) / 4` ∈ `[0,1]`, e `= 0.5` quando não houve escuta
(neutro, nunca bônus); `refSimNorm` e `catSimNorm` são a similaridade reescalada linearmente
dentro da banda de aceitação de C1, clampada em `[0,1]`; `technicalMargin01` é a margem
normalizada nos gates técnicos contínuos (LUFS, true peak, silêncio). Pesos: `ESTIMADO`.

### C3 — A janela de duração contradiz o validador que já roda em produção

| Fonte | Janela alvo | Reprova |
| --- | --- | --- |
| `QUALITY-PROCESS §7` | 150–225 s | `< 120 s` ou `> 240 s` |
| `audio-validator.ts:13-14` (**código rodando**) | — | `< 145 s` ou `> 190 s` |
| `prompt-policy.ts:115` (**código rodando**) | pede `min(184, max(150, …))` | — |
| `config.ts:110` | default 180 s | — |

Uma candidata de 200 s é "dentro do alvo" pelo documento e **hard-reject** pelo código. Uma de
230 s é aceita pelo documento e reprovada pelo código.

**Correção normativa.** A janela da campanha é **150–184 s**, alvo 180 s, reprovando fora de
**145–190 s** — alinhada ao `audio-validator.ts` que já existe, e ao teto de 184 s da API Lyria
[33]. Se o modelo local exigir outra janela, muda-se o validador **em PR próprio, com teste**, e
não por divergência silenciosa entre doc e código. `PÚBLICO` para o teto de 184 s do Lyria [33]
("Maximum audio clip length: 184 seconds"); o resto é alinhamento interno.

Nota de compatibilidade com os candidatos locais, `PÚBLICO`: a janela 150–184 s cabe dentro do
teto publicado de DiffRhythm2 (210 s [25]) e é cercada — não confirmada — pela matriz default do
benchmark de ACE-Step, que testa 30/60/120/240 s [6]. Nenhum dos dois publica um limite que
**exclua** a janela; nenhum dos dois foi medido nela por nós.

### C4 — "true peak" não é medido; o que é medido é pico de amostra

`QUALITY-PROCESS §7` exige `True peak ≤ -1.0 dBTP`, reprovando `> -0.5 dBTP`. O código
(`audio-validator.ts:271-277`) reprova quando `volumedetect` reporta `max_volume > -0.1 dB`.

`volumedetect` do ffmpeg reporta **pico de amostra**, não *true peak*. True peak (dBTP) exige
medição sobre-amostrada — é isso que a família `ebur128` / a saída de `loudnorm` fornece. São
grandezas diferentes: um sinal pode ter pico de amostra `-0.5 dB` e true peak acima de `0 dBTP`
por reconstrução inter-amostral. Portanto o gate atual é **mais frouxo do que o documento afirma**,
por dois motivos somados (grandeza errada, limiar `-0.1` em vez de `-1.0`).

**Correção normativa.** A campanha mede LUFS integrado **e** true peak com um medidor
`ebur128`/`loudnorm` e reprova por `dBTP`, mantendo o pico de amostra apenas como sanidade
secundária. `DERIVADO` da diferença documentada entre as duas grandezas; o comando exato fica em
§19.4 e é conferido no spike, não afirmado aqui.

### C5 — LUFS integrado é exigido pelo documento e não é verificado por ninguém

`QUALITY-PROCESS §7` reprova fora de `-16..-12 LUFS`. O código aplica
`loudnorm=I=-14:TP=-1:LRA=11` em **uma passada** (`audio-validator.ts:121`) e depois **nunca mede
LUFS** — a única verificação pós-normalização é o `volumedetect` de C4.

Duas consequências: (a) o gate de LUFS do documento não está implementado; (b) `loudnorm` em
passada única opera como normalizador dinâmico e **não garante** o alvo integrado, que é o que a
passada dupla (medir → aplicar) entrega.

**Correção normativa.** A masterização da campanha é **duas passadas** e a **revalidação
pós-master mede LUFS integrado e true peak explicitamente**, reprovando fora da banda. Sem
revalidação pós-master, "masterizado" é uma alegação sem verificação.

### C6 — O gate de silêncio mede uma coisa e o documento pede outra

| Fonte | Métrica |
| --- | --- |
| `QUALITY-PROCESS §7` | silêncio de **cabeça/cauda**: `< 2 s`, reprova `> 5 s` |
| `audio-validator.ts:15,74` | **razão total** de silêncio no arquivo, reprova `> 0.20`, detectando só trechos `≥ 4 s` abaixo de `-50 dB` |

São métricas independentes, e a divergência tem sinal: `DERIVADO` — uma faixa de 180 s com 6 s de
silêncio inicial tem razão total `6/180 = 3,3 %`, **passa** no código e **reprova** no documento.
Inversamente, silêncio distribuído em muitos trechos curtos (`< 4 s`) é invisível para o código.

**Correção normativa.** A campanha mede **os dois**: (a) silêncio de cabeça e de cauda, cada um
com limiar próprio; (b) razão total. Cabeça/cauda governa o corte da masterização
(`QUALITY-PROCESS §10` pede `≤ 300 ms`); razão total continua sendo o detector de faixa oca.

### C7 — BPM é reprovado contra um alvo, e nunca medido

`QUALITY-PROCESS §7` reprova desvio `> ±5` do BPM do style card. Mas nada no pipeline mede BPM:
`worker.ts:154` grava `bpm: generation.bpm`, isto é, **o BPM que o prompt pediu**. O catálogo
afirma um BPM que nunca foi verificado no áudio, e o gate de BPM compara o alvo consigo mesmo.

**Correção normativa.** A campanha executa detecção de BPM e de tonalidade **no áudio gerado**,
grava valor medido + confiança **separados** do valor pedido, e o gate compara medido × pedido.
`Track.bpm` recebe o **medido**, nunca o pedido.

### C8 — Fingerprint acústico não é detector de plágio melódico

`QUALITY-PROCESS §12.2` posiciona Chromaprint/AcoustID como o gate de copyright contra "um corpus
comercial curado". Fingerprinting acústico é projetado para **identificar a mesma gravação** sob
degradação (codec, ruído, corte) — é dessa invariância que ele vive. Ele não é, e não pretende
ser, um detector de semelhança de composição: uma faixa nova com melodia parecida e arranjo
diferente não produz match.

**Correção normativa.** O fingerprint fica no pipeline, mas com o papel correto e o nome correto:
**detector de duplicata/vazamento** (a candidata é, na prática, uma cópia de algo já conhecido).
A semelhança composicional é endereçada por embedding (C1) + escuta humana, e **nenhuma das duas é
parecer jurídico** (§15.1). Consequência prática: **remover a promessa** de que o gate de
copyright detecta melodia protegida — ele não detecta, e prometer isso é pior que não ter o gate.

`QUALITY-PROCESS §12.2` também cita "Shazam API" como detecção de terceiros. `NÃO VERIFICADO` — e
esta é uma das **lacunas residuais reais** de §20.2 (L3): a pesquisa de 2026-08-22 cobriu
geradores e licenças, não serviços de identificação. Até haver fonte primária, não prometer esse
gate.

### C9 — Piloto e cadência confundem **gerações** com **faixas aprovadas**

`QUALITY-PROCESS §13-14` diz: "Batch size: 50 tracks per week", "At 400 tracks: 8 weeks of
production at 50/week", e "Pilot scope: 50 tracks — 5 style cards × 10 generations".

No piloto, 5 × 10 = **50 gerações**, não 50 aprovadas. Mas a cadência de 8 semanas trata 50 como
aprovadas. Usando os **próprios critérios de Go** do documento — `≥70 %` de aprovação automática,
`≥80 %` de aprovação humana, dedupe rejeitando `≤15 %` das aceitas:

```
rendimento composto = 0.70 × 0.80 × 0.85 = 0.476        [DERIVADO]
50 gerações/semana → ~23,8 aprovadas/semana
400 aprovadas → 400 / 23,8 ≈ 16,8 semanas               [DERIVADO]
```

Não 8 semanas. E `400 / 0.476 ≈ 840` gerações — não 400.

**Correção normativa.** Toda meta neste RFC é declarada em **uma das duas unidades, sempre
nomeada**: `candidatas geradas` ou `faixas aprovadas`. O piloto da onda 2 é de **50 gerações**
(§14), explicitamente **não** 50 aprovadas. O rendimento `1/k` é a variável central de §10.

### C10 — Faixas de entropia de repetição deixam duas regiões sem regra

`QUALITY-PROCESS §7`: alvo `entropia 0.4–0.8`, reprova `< 0.25`. Fica sem definição o intervalo
`[0.25, 0.40)` e tudo acima de `0.8`.

**Correção normativa.** Três bandas exaustivas, sem lacuna: reprova `< 0.30`; sinaliza para escuta
`0.30 ≤ e < 0.42` **e** `e > 0.82`; aceita no meio. `ESTIMADO`, e a métrica precisa ser fixada em
implementação (janela, normalização) antes de qualquer limiar significar algo.

### C11 — Ferramentas citadas que não podem entrar

`QUALITY-PROCESS §6` cita "local MusicGen" como gerador e `§15` cita "MusicLM embeddings". As duas
mudaram de estado nesta passagem:

- **MusicGen: resolvido, e é descarte.** `PÚBLICO` — o AudioCraft distingue as duas licenças no
  próprio README: código MIT, e "The models weights in this repository are released under the
  CC-BY-NC 4.0 license as found in the `LICENSE_weights` file." [43]. A licença dos pesos define
  `NonCommercial` como "not primarily intended for or directed towards commercial advantage or
  monetary compensation" e concede reprodução/compartilhamento, inclusive de material adaptado,
  **"for NonCommercial purposes only"** [44]. Um catálogo comercial não cabe nisso. Descarte por
  R7 (D12, §7.7) — não risco gerenciado, e o MIT do código não neutraliza os pesos.
- **MusicLM embeddings: continua `NÃO VERIFICADO`.** É lacuna residual L4 de §20.2. **Não usar até
  haver fonte primária** sobre disponibilidade pública e licença.

**Correção normativa:** remover "local MusicGen" da lista de geradores do `QUALITY-PROCESS` (PR-0)
e substituir "MusicLM embeddings" por "embedder a definir, com licença conferida" — o embedder é
decidido no PR-8, com o par (modelo, revisão) registrado no manifesto (§13.3).

---

## 7. Alternatives matrix

> **Integridade desta seção.** Toda célula marcada `PÚBLICO` sai de fonte primária verificada em
> 2026-08-22 (§0.2), com citação inline. Onde a fonte é repositório ou model card, a citação
> aponta para **permalink de commit/revisão**, não para `main` — porque `main` muda e a alegação,
> não. Onde a fonte oficial se contradiz, a contradição está **registrada como contradição**
> (§7.2.1, §7.6.2), não resolvida por escolha do autor.
>
> **Quatro objetos jurídicos, nunca confundidos:** licença do **código**, licença dos **pesos**,
> termos sobre os **outputs**, e **termos de serviço** do fornecedor. §7.4 é a tabela dedicada a
> eles, e existe porque "o projeto é MIT" é uma frase que esconde três perguntas sem resposta.

### 7.1 Separação explícita: fato × decisão

| | Fato (verificado 2026-08-22) | Decisão |
| --- | --- | --- |
| **ACE-Step 1.5** | Código MIT [7]; pesos marcados MIT [8][9]; uso comercial dos outputs afirmado no model card [8][9]; Apple Silicon oficial via `mps` + `mlx` [3][6]; REST headless `acestep-api` [2][3] | **Candidato local principal, condicionado ao spike** (D7) |
| **DiffRhythm2** | Código **e** pesos Apache-2.0 [16][22][23]; até 210 s [25]; device é `cuda if available else cpu` [17]; instrumental-only é TODO [16]; sem REST local documentada [16][23] | **Challenger de baixo fit no Mac** — pesquisa/CPU/Linux-CUDA (D10) |
| **Lyria 3 Pro** | US$ 0,08/geração [34]; 184 s [33]; instrumental suportado [33]; sem reference audio [33]; SynthID [35]; Pre-GA sem SLA/indenização [36] | **Fallback + gerador de faixas-âncora** (D8) |
| **MiniMax Music 1.5 (oficial)** | Ausente do catálogo e da tabela de preços atuais [38][39]; APIs pagas de música fechadas a novos usuários desde 2026-08-20 [38] | **Não é integração nova** (D11) |
| **MiniMax Music 1.5 (Replicate)** | US$ 0,03/arquivo, até 240 s [41]; schema e README se contradizem em reference audio [41] | **Host terceiro comparativo**, com risco documental declarado (D11) |
| **MusicGen** | Código MIT, **pesos CC BY-NC 4.0** [43][44] | **Descartado** por R7 (D12) |

### 7.2 Matriz — geradores locais

`PÚBLICO` em toda célula citada. `TBD` significa "só a onda 1 responde", **não** "não pesquisado".

| Critério | ACE-Step 1.5 (local) | DiffRhythm2 (local) |
| --- | --- | --- |
| Papel proposto | **Principal, se o spike aprovar** (D7) | Challenger de pesquisa (D10) |
| Já integrado no repo | ❌ | ❌ |
| Snapshot verificado | `14c0211d5a0653b0f63e27686f4c3f151b4d8629` [1] | `7804f821b797b4f276090e1a9dcd37e97d9915d5` [16] — a página oficial do projeto aponta para `ASLP-lab/DiffRhythm2` [26], mas o **tracker de issues em uso é o espelho Xiaomi** [30][31][32]: código e issues vivem em repositórios diferentes |
| Custo marginal por candidata | energia + tempo (§16.2) | energia + tempo |
| Duração máxima contínua | matriz de benchmark oficial cobre 30/60/120/240 s [6]; **teto não publicado como número único** | **210 s** — "can generate complete songs up to 210 seconds in length" [25]; CLI `--max-secs` default `210.0` [17] |
| macOS / Apple Silicon | ✅ oficial: "macOS scripts use the **MLX backend** for native Apple Silicon acceleration (M1/M2/M3/M4)" [3] | ⚠️ só `brew install espeak-ng` é documentado; launcher simples apresentado como Linux [16] |
| MPS / MLX | ✅ ambos, e distintos: "MPS (Apple Silicon) \| `--device mps`" vs "MLX \| `--lm-backend mlx`" [6]; `pyproject.toml` instala `mlx>=0.25.2` e `mlx-lm>=0.20.0` em `darwin/arm64` [2] | ❌ **nenhum** — o seletor de device é `cuda if available else cpu`; no Mac o caminho oficial é **CPU** [17] |
| Variantes / tamanho de pesos | DiT ~2B (`base`/`sft`/`turbo`) e XL ~4B (`xl-base`/`xl-sft`/`xl-turbo`); LM `0.6B`/`1.7B`/`4B` [1]. XL: "~4B" params, "~18.8 GB" bf16 em disco [9] — **contradiz** o README (§7.2.1) | DiT + decoder, VAE a 5 Hz [25]; pesos baixados no primeiro run [16][17]; **encoder do Music VAE não consta nos checkpoints** (issue aberta) [24][32] |
| Instalação | `uv sync` após clone; Python `>=3.11,<3.13` [2][3] — receita exata em §9 | `pip install -r requirements.txt` com `torch==2.7`, `torchaudio==2.7`, `transformers==4.47.1`, `muq==0.1.0` [19] |
| API headless | ✅ **REST**: `uv run acestep-api`, porta padrão 8001; entry point `acestep-api = "acestep.api_server:main"` [2][3] | ❌ nenhuma REST local documentada. Só CLI `python inference.py …` [17][18] e o Space Gradio hospedado [27][29] |
| Batch | ✅ tensor batch: `batch_size` default 2, **máx 8** [4]; README promete "Generate up to 8 songs simultaneously" [1]; runtime tem VRAM guard e pode reduzir [15] | ⚠️ **fila, não tensor**: JSONL multi-linha iterado um a um (`for i in tqdm(...)`) [17][20] |
| Modo instrumental | ✅ REST principal: `lyrics` vazio ou `[inst]`/`[instrumental]` [14]; `GenerationParams.instrumental` na API Python [5]. **`instrumental:true` não existe no schema de `/release_task`** [14] | ❌ **TODO declarado** no README; `[inst]` é seção sem letra dentro da canção, não modo instrumental-only [16][17] |
| `reference_audio` / força | ✅ `reference_audio` = referência de **estilo**; `src_audio` = áudio-**fonte** de cover/repaint; `audio_cover_strength` 0–1, default 1.0, com "Lower values (0.2) for style transfer" [4][5] | ✅ `style_prompt` vira áudio quando aponta para arquivo existente; ≥1 s, e ">10 seconds will be randomly clipped into 10 seconds" [17][27] |
| Streaming | não avaliado nesta pesquisa | ❌ existe `inference_stream()` no Space, mas desativado: "Due to issues with Gradio's streaming audio output, we will update the streaming feature in the future." [27][28] |
| Licença do **código** | ✅ **MIT** [7] | ✅ **Apache-2.0** [22] |
| Licença dos **pesos** | ✅ cards oficiais marcam `license: mit` [8][9] | ✅ "DiffRhythm 2 (code and weights) is released under the Apache License 2.0" [16]; card marca `apache-2.0` [23] |
| Termos sobre **outputs** | ⚠️ uso comercial **afirmado no card** — "You can strictly use the generated music for commercial purposes." [8] — **sem licença autônoma de outputs**; README mantém obrigações do usuário [1] | ❌ **nenhuma licença/termo autônomo de output localizado**; Apache-2.0 não licencia outputs por si [16][23] |
| Proveniência / watermark | não documentado nas fontes verificadas — trate como **ausente até prova**; o manifesto (§8.6) passa a ser a única proveniência | idem |
| Known issues de memória | mitigação VAE MLX **mesclada** (#1042 [10], #1059 [11]); Autoscore + XL + LM 4B em 32 GB **continua risco** (#1081 fechada por inatividade [12], #1097 aberta [13]) — §7.5 | dtype `Half`/`Float` (#5), detecção de `espeak` (#7), encoder do VAE ausente (#11) — todas **abertas e sem resposta de maintainer** [30][31][32] |
| Limitação reconhecida pelos autores | contradição documental de tamanho do XL (§7.2.1) | "The low-frame-rate VAE imposes an upper bound on the fidelity of reconstructed audio, making it difficult to match real audio quality" [25] |
| Risco dominante | pressão de memória em combinações XL + LM 4B; performance no nosso hardware `TBD` | **não roda acelerado no Mac** + sem instrumental-only + sem REST |

#### 7.2.1 Contradição oficial no tamanho do XL — registrada, não resolvida

`PÚBLICO`, e as duas fontes são do mesmo projeto: o README diz que o XL precisa de "~9GB VRAM for
weights" [1], enquanto o model card do XL declara "Total params | ~4B" e "Weights size (bf16) |
~18.8 GB" [9]. A documentação **não explica** a diferença.

Regra deste RFC: para planejamento de disco e memória, usar **~18,8 GB bf16 em disco** [9], e
tratar os ~9 GB como possível claim de residência/VRAM associado a quantização ou offload que a
documentação não descreve. Planejar pelo número menor seria escolher a fonte mais conveniente.

### 7.3 Por que ACE-Step 1.5 é o candidato principal — e o que "condicionado ao spike" significa

Três razões, todas `PÚBLICO`, e uma ressalva que não é negociável:

1. **É o único candidato local com Apple Silicon como caminho oficial de primeira classe.** Não é
   inferência de compatibilidade: há launchers macOS dedicados (`start_gradio_ui_macos.sh`,
   `start_api_server_macos.sh`), a documentação separa `--device mps` de `--lm-backend mlx`, e o
   `pyproject.toml` instala `mlx`/`mlx-lm` no marcador `darwin/arm64` [2][3][6]. DiffRhythm2, no
   mesmo critério, escolhe device com `cuda if available else cpu` [17].
2. **É o único com REST headless publicada e batch de tensor.** `uv run acestep-api` na porta 8001
   é entry point declarado no `pyproject.toml` [2][3], e `batch_size` aceita até 8 [4]. Isso casa
   com a fronteira `MusicGenerationProvider` de D2 sem wrapper nosso. DiffRhythm2 exigiria que
   **nós** escrevêssemos o servidor em volta do CLI.
3. **Licença é a mais limpa das duas em relação a output.** Código MIT [7], pesos marcados MIT
   [8][9], e o card afirma uso comercial da música gerada [8][9]. DiffRhythm2 é Apache-2.0 em
   código e pesos [16][22][23] — igualmente permissivo para *rodar* — mas **não** tem nenhuma
   declaração sobre outputs.

**A ressalva, e ela é a parte importante.** "O model card afirma uso comercial" **não é garantia
jurídica**. O que existe é uma frase num card — "You can strictly use the generated music for
commercial purposes." [8] — e nenhuma licença autônoma de outputs, nenhuma cessão de titularidade,
nenhuma indenização. O README do mesmo projeto continua pedindo verificação de originalidade,
disclosure de uso de IA e permissão ao adaptar estilos ou material protegido [1]. Ou seja: o risco
de terceiros **permanece com o Lofiever**. Este RFC trata isso como **remoção do bloqueador de
licença de pesos**, não como clearance jurídico — e §15.1 repete a distinção onde ela importa.

**Condicionado ao spike** quer dizer exatamente: os critérios 3, 5, 7 e 8 de §2.3 estão `TBD`, e
uma reprovação em qualquer um deles derruba D7 sem derrubar o resto do RFC — a fronteira de
provider (D2) e a fila por capability (§8.2) existem para que o fallback seja uma troca de
configuração.

### 7.4 Código × pesos × outputs × termos — a tabela que não pode ser resumida

`PÚBLICO`. As quatro colunas são **independentes**. A armadilha clássica desta categoria é código
permissivo com pesos restritos (MusicGen é o exemplo vivo, §7.7); a armadilha menos óbvia é pesos
permissivos com **silêncio** sobre outputs (DiffRhythm2).

| Opção | Código | Pesos | Outputs | Termos de serviço / estágio |
| --- | --- | --- | --- | --- |
| **ACE-Step 1.5** | MIT — inclui usar, modificar, distribuir, sublicenciar e vender cópias [7] | marcados `license: mit` nos cards oficiais [8][9] | uso comercial **afirmado no card**, sem licença autônoma; obrigações de originalidade/disclosure ficam com o usuário [1][8][9] | N/A — software local, sem contrato de serviço |
| **DiffRhythm2** | Apache-2.0 [22] | Apache-2.0, explicitamente: "code and weights" [16][23] | **nenhum termo autônomo localizado.** Apache-2.0 **não** licencia outputs; o disclaimer só alerta sobre similaridade/copyright e exige verificação [16][23] | N/A — software local |
| **Lyria 3 Pro** | N/A | N/A | "Generated Output is Customer Data. As between Customer and Google, Google does not assert any ownership rights in any new intellectual property created in the Generated Output." [36]; outputs semelhantes podem ir a outros clientes [36] | Pre-GA: "Customers may elect to use it for production or commercial purposes, or disclose Generated Output to third-parties" [33], porém **"AS IS"**, sem SLA e **sem indenização** [36]; proibido usar output para substituir/contornar ou treinar modelo similar ao do Google [36] |
| **MiniMax (oficial)** | N/A | N/A | "you retain your ownership rights in Client input and generated content" [40]; a MiniMax pode usar input/output para prestar e melhorar os serviços [40] | APIs pagas de música **fechadas a novos usuários** desde 2026-08-20 [38] |
| **MiniMax via Replicate** | N/A | N/A | Replicate cede o que tiver, "including your use of Output for commercial purposes such as sale or publication", **"subject to any Third Party Terms"** [42] | **dois contratos empilhados**: Replicate + MiniMax [41][42] |
| **MusicGen** | MIT [43] | **CC BY-NC 4.0** [43][44] | irrelevante para o descarte: a restrição já morde no uso dos **pesos** [44] | N/A |

**Regra permanente de licenciamento** (independe de qualquer verificação futura): licença de
**código**, licença de **pesos** e termos de **output** são coisas separadas e frequentemente
diferentes no mesmo projeto. O gate de §2.3 pergunta pelas três, sempre, e a resposta vai para o
manifesto de cada candidata (§8.6, campo `provenance`).

### 7.5 ACE-Step 1.5 — known issues de memória, com nuance

`PÚBLICO`, e a nuance é o ponto: parte do problema **já tem mitigação oficial mesclada**, e parte
**não**. Tratar como "resolvido" ou como "quebrado" são os dois erros disponíveis.

**Já mesclado — pressão de memória do VAE MLX:**

- **PR #1042** reduziu o chunk de decode do VAE MLX de 2048 para 512 e adicionou `mx.clear_cache()`,
  descrito como "cutting peak GPU memory by ~56% on unified-memory Macs" [10]. O benchmark do PR,
  em **M4 Pro 48 GB com áudio de 600 s** — `PÚBLICO` **sobre hardware de terceiro, não medição
  deste projeto** (§0.1 regra 2) — reporta pico MLX de 31,08 → 13,44 GB, VAE de 68 → 78 s, e
  output byte-a-byte idêntico [10].
- **PR #1059**, também mesclada, tornou o chunk automático por memória unificada: ≤16 GB → 256;
  ≤36 GB → 512; ≤64 GB → 1024; >64 GB → 2048; com override por `ACESTEP_MLX_VAE_CHUNK` [11].

Consequência de desenho: **`ACESTEP_MLX_VAE_CHUNK` é o botão oficial de memória do VAE**, e é o
primeiro a mexer sob pressão — antes de qualquer receita de comunidade. Nas nossas duas máquinas o
default automático cairia em faixas diferentes (128 GB → 2048; 24 GB → 512), o que é mais uma razão
para não comparar as duas sem registrar o chunk efetivo no manifesto do spike (§19.2).

**Não resolvido no snapshot verificado — Autoscore + XL + LM 4B em Mac de 32 GB:**

- **Issue #1081** relata crescimento de memória e crash nessa combinação com MLX; ela foi
  **fechada automaticamente por inatividade, não por correção** [12].
- **PR #1097** propõe corrigir uma segunda cópia PyTorch do LM 4B (~8 GB), e permanece
  **aberta/não mesclada** [13].

Regra operacional: **Autoscore + XL + LM 4B é combinação de alto risco de memória** e não entra na
matriz do spike como default. O M4 Pro de 24 GB fica **abaixo** dos 32 GB do relato, o que agrava,
não atenua.

⚠️ **Sobre `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0`.** Essa receita circula em fóruns como cura de
OOM em MPS. Este RFC **não a recomenda como solução universal**, por dois motivos: (a) ela **não
aparece** como mitigação oficial em nenhuma das fontes verificadas do projeto [10][11][12][13] —
o botão oficial é `ACESTEP_MLX_VAE_CHUNK` [11]; (b) `NÃO VERIFICADO` — o efeito exato dessa
variável na versão de PyTorch que o `uv sync` instalar não foi conferido nesta pesquisa. Remover
um teto de alocador não reduz demanda de memória; no melhor caso troca uma falha explícita por
comportamento pior de diagnosticar. A mitigação primária deste RFC continua sendo **reduzir `B`**
(§10.6) e, para o VAE MLX, o chunk oficial.

### 7.6 APIs — Lyria, MiniMax e a distinção fornecedor × host

#### 7.6.1 Lyria 3 — por que não é o principal da campanha, e por que continua no desenho

`DERIVADO`, com uma entrada `PÚBLICO` (US$ 0,08 por geração [34]) e o resto declarado:

```
US$ 0,08 × N_candidatas:
  900 → US$ 72      1200 → US$ 96      1500 → US$ 120      2000 → US$ 160
```

O default de `AI_MUSIC_MONTHLY_BUDGET_USD` é **100** (`config.ts:108`), e o gate de orçamento de
`service.ts:190` é **um só, mensal, somando todas as origens**. Uma campanha de 1200 candidatas
pela API consome ~US$ 96 e **zera a cota dos ouvintes** no mesmo mês. Daí D9 (orçamento separado)
e o interesse pelo caminho local: o custo marginal local é energia + tempo, não US$/faixa.

Ficha atual do Lyria, `PÚBLICO` e relevante para o desenho:

| Item | Lyria 3 Pro Preview | Lyria 3 Clip Preview |
| --- | --- | --- |
| Model ID | `lyria-3-pro-preview` [33] | `lyria-3-clip-preview` [33] |
| Preço | **US$ 0,08 / 1 count** [34] | **US$ 0,04 / 1 count** [34] |
| Duração | música completa, máx. técnico **184 s** [33] | **30 s** [33][34] |
| Inputs | texto e imagem, "Input only" [33] | idem [33] |
| Áudio | **"Output only"** — não aceita áudio de referência [33] | idem [33] |
| Instrumental | "Instrumental mode — Supported" [33] | idem [33] |
| Negative prompt | não suportado [33] | não suportado [33] |
| Saída | `audio/mp3`, 44,1 kHz, 192 kbps, 1 clip por prompt [33] | idem [33] |
| Proveniência | watermark de áudio e C2PA suportados [33]; "All of our tracks are imperceptibly watermarked with SynthID technology" [35] | idem |
| Estágio | Preview / Pre-GA: uso em produção autorizado [33], mas "AS IS", sem SLA nem indenização [36] | idem |

Duas notas de precisão que este RFC exige:

- **Usar 184 s, não 180.** A ficha técnica do endpoint diz "Maximum audio clip length: 184
  seconds" [33]; a página de marketing da DeepMind resume Lyria como "now up to 3 minutes long"
  [35]. Para implementação vale o limite do endpoint — daí a janela de C3.
- **O limite de taxa publicado é ambíguo, e fica registrado como ambíguo.** A seção se chama
  "Regional online prediction requests per minute per base model" e o valor publicado é
  literalmente "10 tokens per minute" [33]. Unidade inconsistente. **Não** reescrever como 10 RPM
  sem confirmação — para capacity planning, tratar como **limite publicado ambíguo** (lacuna L1 de
  §20.2).

Lyria fica no desenho por dois motivos que o local não substitui: (a) é a única rota **hoje
funcionando**, e portanto o fallback honesto se o spike reprovar; (b) `PÚBLICO` [33][35] — todo
output leva SynthID e suporta C2PA, o que faz dele a fonte natural das **faixas-âncora**: um
conjunto pequeno de faixas de proveniência conhecida para calibrar os thresholds de §13 e servir
de controle na escuta cega.

#### 7.6.2 MiniMax Music 1.5 — a distinção que este RFC exige que não se apague

O ponto **estrutural** vale independente de qualquer preço: **uma plataforma de hosting de
terceiros que sirva um modelo MiniMax não é "a API oficial da MiniMax".** São dois fornecedores,
dois contratos, dois conjuntos de termos e dois donos do dado enviado. A pesquisa de 2026-08-22
respondeu os dois lados **separadamente**, e as respostas divergem:

**Lado fornecedor (MiniMax oficial) — `PÚBLICO`, e é um não:**

- O modelo foi anunciado em 2025-09-11: "Extending song generation to a full 4 minutes, it
  delivers four groundbreaking advancements: unprecedented creative control, stunningly natural
  vocals, rich layered instrumentals, and coherent song structures." [37]
- O catálogo atual lista `music-3.0`, `music-2.6`, `music-cover` e, como legacy, `music-2.0`.
  **Music 1.5 não consta** [38]. A tabela PayGo atual também não o lista: ela traz Music-3.0 e
  Music-2.6 a "$0.15/up-to-5 minutes music" e Music-2.0 a US$ 0,03 [39].
- E o acesso fechou: "Starting August 20, 2026, the paid APIs (Music Generation and Lyrics
  Generation) will no longer be available to new users; existing paying users can continue to use
  the current API services." [38]

Conclusão precisa, sem extrapolar: **novos usuários não conseguem contratar** a API oficial paga
de música desde 2026-08-20 [38]; clientes pagantes preexistentes seguem nos serviços atuais, mas a
documentação **não identifica Music 1.5** entre os modelos atuais ou legados [38][39]. O anúncio
de 2025 prova disponibilidade **histórica**, não operacional. **Preço oficial vigente do 1.5:
N/D** — omitido da tabela atual; e não se deve inferir US$ 0,03 só porque Music-2.0 aparece nessa
faixa [39]. Daí D11: **não é integração nova.**

**Lado host (Replicate) — `PÚBLICO`, disponível, e com um defeito documental:**

- US$ 0,03 por arquivo de áudio de output; duração máxima 240 s [41].
- Schema executável atual: `prompt` obrigatório (10–300 caracteres) e `lyrics` obrigatório
  (10–600 caracteres, com tags `[intro]`, `[verse]`, `[chorus]`, `[bridge]`, `[outro]`); MP3/WAV/PCM;
  sample rates 16/24/32/44,1 kHz; bitrates 32/64/128/256 kbps [41].
- **Sem instrumental-only:** o schema não expõe `is_instrumental`, e como `lyrics` é **obrigatório**
  não há modo sem letra documentado no endpoint atual [41].
- **Contradição schema × README, registrada:** o README da mesma página anuncia "Upload reference
  music for style analysis (optional, supports WAV, MP3, M4A; max 60MB, 5-30 seconds)" e menciona
  força de estilo 0,0–1,0 (default 0,8), mas **o schema da versão executável atual não tem campo
  de reference audio nem `style_strength`** [41]. Decisão deste RFC: tratar reference audio como
  **indisponível até prova por chamada real**, e não construir nada que dependa dele. (Irrelevante
  na prática: R4/§15.2 proíbe enviar referência a API de terceiro de todo modo.)
- Termos empilhados: o Replicate cede o que tiver no output, "including your use of Output for
  commercial purposes such as sale or publication", **"subject to any Third Party Terms"** [42] —
  isto é, os termos MiniMax continuam valendo [40][41], e o Replicate não garante que um modelo de
  terceiro siga disponível [42].

**Papel final:** comparativo de custo/qualidade apenas, via host, com risco documental e de
descontinuação declarado. Nenhum documento do Lofiever deve citar um host de terceiro como fonte
oficial do fornecedor do modelo.

### 7.7 Descartes

| Candidato | Motivo | Etiqueta |
| --- | --- | --- |
| **MusicGen** (pesos) | Pesos oficiais em **CC BY-NC 4.0** [43]; `NonCommercial` é definido como "not primarily intended for or directed towards commercial advantage or monetary compensation", com reprodução e material adaptado permitidos "for NonCommercial purposes only" [44]. Código MIT não neutraliza os pesos. Descarte por R7, não risco gerenciado | `PÚBLICO` — **resolvido** (D12) |
| **MiniMax Music 1.5 (API oficial)** | Fora do catálogo e da tabela de preços atuais; novos usuários bloqueados desde 2026-08-20 [38][39] | `PÚBLICO` — descartado como integração nova (D11) |
| **Suno** (via wrapper) | Não foi localizada API pública oficial; os termos proíbem robôs, scraping e acesso por meios não disponibilizados intencionalmente · `PÚBLICO (2026-07-18, não reconferido)` [47] | Descartado |
| **ElevenLabs Music** self-service | `Media Rights` exclui **radio** em todos os planos self-service e no Enterprise Lite; só Enterprise Music cobre todos os usos · `PÚBLICO (2026-07-18, não reconferido)` [48] | Bloqueado contratualmente |
| **Qualquer modelo com pesos não comerciais** (`*-NC-*`) | R7 | Descartado por regra |
| **MusicLM embeddings** | Disponibilidade pública e licença **não verificadas** — lacuna residual L4 (§20.2) | `NÃO VERIFICADO` |
| **Lyria 2 (`lyria-002`)** | Clipes de 32,8 s; não sustenta faixa contínua · `PÚBLICO (2026-07-18, não reconferido)` [49] | Não serve ao caso |

---

## 8. Arquitetura

### 8.1 Princípio

Um control plane, dois data planes. O control plane é o que já existe — Node/Prisma/BullMQ/Redis.
O data plane novo é local (Macs) e entra pela mesma fronteira de provider que a API usa hoje.

```
                       ┌──────────────────────── CONTROL PLANE (já existe) ────────────────────────┐
                       │                                                                           │
  Chat (usuário) ──────┼──▶ MusicGenerationService ──▶ queue: lofiever-music-generation ──▶ Worker ─┼──▶ Lyria (API)
                       │        (cotas, budget, idempotência — INALTERADO)                          │
  Editorial scheduler ─┘                                                                           │
                       │                                                                           │
  Campaign (NOVO) ─────┼──▶ CampaignPlanner ──▶ queue: music-gen:local-m5   ──▶ CampaignWorker ────┼──┐
                       │                   └──▶ queue: music-gen:local-m4   ──▶ CampaignWorker ────┼──┤
                       │                   └──▶ queue: music-gen:api        ──▶ CampaignWorker ────┼──┤
                       │                                                                           │  │
                       │        Postgres/Prisma (source of truth)   Redis (fila + pub/sub)          │  │
                       └───────────────────────────────────────────────────────────────────────────┘  │
                                                                                                      │
        ┌─────────────────────────── DATA PLANE LOCAL (novo) ────────────────────────────────────┐    │
        │  MacBook Pro M5 Max 128GB          Mac Mini M4 Pro 24GB                                │    │
        │  ┌──────────────────────┐          ┌──────────────────────┐                            │◀───┘
        │  │ lofigen-server /v1   │          │ lofigen-server /v1   │   HTTP versionado + HMAC    │
        │  │  health capabilities │          │  health capabilities │                            │
        │  │  jobs  artifact      │          │  jobs  artifact      │                            │
        │  └──────────┬───────────┘          └──────────┬───────────┘                            │
        │      staging local                     staging local                                   │
        └─────────────┼──────────────────────────────────┼──────────────────────────────────────┘
                      └──────────────┬───────────────────┘
                                     ▼
                     Analysis workers (ffmpeg/embeddings/fingerprint)
                                     ▼
                      R2 (candidatas + masters + manifests)
                                     ▼
                       ╔═════════════════════════════════╗
                       ║  PUBLISH GATE (explícito, D3)   ║  ← nenhuma candidata passa sozinha
                       ╚═════════════════════════════════╝
                                     ▼
                          Track (sourceType='s3') → rotação
```

### 8.2 Roteamento: fila por capability

**Decisão:** uma fila BullMQ **por capability**, não uma fila com filtro no consumidor.

Motivo: BullMQ entrega o próximo job disponível ao worker que pedir; não há seleção do lado do
consumidor por atributo do payload. Um worker que puxasse um job destinado a outra máquina
precisaria devolvê-lo, produzindo *thrash* e contabilidade de tentativas falsa. Fila por
capability transforma roteamento em endereçamento, e dá de graça: backpressure por fila
(`getWaitingCount` por máquina), pausa por máquina, e concorrência por máquina.

| Fila | Consumidor | Uso |
| --- | --- | --- |
| `lofiever-music-generation` | worker atual | **inalterada** — pedido de usuário + editorial |
| `music-gen:local-m5` | worker do MacBook | geração local, batch grande |
| `music-gen:local-m4` | worker do Mac Mini | geração local, batch pequeno + análise |
| `music-gen:api` | worker de API | faixas-âncora, fallback, degradação |
| `music-analysis` | qualquer host com ffmpeg | análise/embedding/fingerprint (CPU) |
| `music-master` | idem | masterização de aprovadas |

`jobId` = chave de idempotência da candidata (§8.5), reusando exatamente o truque que
`queue.ts:35` já usa (`jobId: generationId`): enfileirar duas vezes é um no-op.

### 8.3 Protocolo do worker local — HTTP versionado

O servidor local é um processo Python separado, **fora** do Node. A fronteira é HTTP, versionada
no path, e o Node fala com ele por um `LocalMusicProvider` que implementa
`MusicGenerationProvider` (`types.ts:56`). O campo `onOperationId` **já existe** naquela interface
e serve exatamente para persistir o id do job remoto — é o mesmo padrão do `lyria-provider.ts:101`.

| Método | Rota | Semântica |
| --- | --- | --- |
| `GET` | `/v1/health` | vivo, modelo carregado, memória livre, jobs em curso. Sem autenticação, sem dado sensível |
| `GET` | `/v1/capabilities` | modelos disponíveis + revisão, device, batch máximo, janela de duração, se aceita referência |
| `POST` | `/v1/jobs` | cria job de **batch**. `Idempotency-Key` obrigatório. `202` + `jobId` |
| `GET` | `/v1/jobs/{id}` | estado, progresso, `leaseExpiresAt`, lista de artefatos prontos |
| `GET` | `/v1/jobs/{id}/artifacts/{n}` | bytes de **um** artefato + `Content-Digest` |
| `POST` | `/v1/jobs/{id}/cancel` | cancelamento cooperativo, idempotente |
| `POST` | `/v1/admin/drain` | para de aceitar job novo, termina os em curso (kill switch, §16.5) |

Regras do contrato:

- **Versão no path.** Quebra de contrato = `/v2`. O `capabilities` traz
  `protocolVersion` e o Node **recusa** o worker se a major não for a esperada — falha explícita
  em vez de campo silenciosamente ignorado.
- **Autenticação HMAC-SHA256** sobre `método + path + timestamp + nonce + sha256(body)`, chave
  compartilhada, janela de ±300 s, nonce guardado em Redis para barrar replay. O repo já usa
  `createHmac` (`service.ts:44`), então é o mesmo idioma. `HIPÓTESE` quanto a ser suficiente sem
  mTLS; ver §15.4.
- **Bind em loopback por padrão.** Exposição só via Tailscale, nunca `0.0.0.0` na LAN.
- **Artefato é buscado por id, um a um** — nunca por caminho vindo da resposta. Isso fecha *path
  traversal* pelo lado do cliente por construção (§15.5).
- **O worker local nunca escreve no Postgres nem no R2.** Ele produz bytes; o control plane
  persiste. Um worker comprometido não consegue publicar nada.

### 8.4 Domínio: o que precisa ser criado

`HIPÓTESE` no detalhe dos campos; o **shape** é o que importa. Nada aqui altera `MusicGeneration`
ou `Track` de forma destrutiva — é aditivo, o que mantém a migration reversível.

```prisma
// PROPOSTA — não aplicado por este RFC.
model Campaign {
  id                String   @id @default(uuid())
  name              String   @unique
  targetApproved    Int              // 300 ou 400  — faixas APROVADAS
  candidatesPerTrack Int             // k = 3 ou 5   — razão de candidatas
  status            String   @default("planned") // planned|running|paused|halted|completed
  publishGate       String   @default("manual")  // manual|auto_after_review  (D3)
  budgetUsdCap      Float    @default(0)         // D9: teto próprio, separado do estúdio
  createdAt         DateTime @default(now())
}

model StyleCard {
  id           String   @id @default(uuid())
  campaignId   String
  version      Int                    // C1: threshold só vale para uma versão de card
  slug         String
  spec         Json                   // o style card abstrato (QUALITY-PROCESS §5)
  specHash     String                 // entra na chave de idempotência
  referenceIds String[]               // ReferenceProfile.id — nunca áudio, nunca nome de artista
  @@unique([campaignId, slug, version])
}

model Candidate {
  id             String   @id @default(uuid())
  campaignId     String
  styleCardId    String
  candidateKey   String   @unique     // §8.5 — a chave de retomada
  status         String   @default("planned")
  attempt        Int      @default(0)

  // execução
  capability     String?              // local-m5 | local-m4 | api
  workerId       String?
  leaseExpiresAt DateTime?            // §8.7
  modelId        String?
  modelRevision  String?              // pin real, não "latest"
  seed           BigInt?
  paramsHash     String?

  // artefatos
  rawObjectKey       String?
  masterObjectKey    String?
  rawSha256          String?
  masterSha256       String?
  manifestObjectKey  String?

  // avaliação
  analysis       Json?                // §13.2 medições, com unidade e ferramenta
  embedding      Json?                // vetor + modelo + revisão (pgvector em PR posterior)
  gates          Json?                // {tecnico, similaridade, fingerprint} pass/fail/notRun
  qualityScore   Float?               // só definido se todos os gates = pass (C2)
  humanReviews   Json?

  trackId        String?  @unique     // preenchido SÓ na promoção (D3)
  failureCode    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([campaignId, status])
  @@index([capability, status, leaseExpiresAt])
}

model ReferenceProfile {           // §12 — atributos, JAMAIS o áudio, JAMAIS nome de artista
  id           String   @id @default(uuid())
  localPathHash String  @unique       // sha256 do caminho+conteúdo; o áudio não entra no banco
  contentSha256 String  @unique
  licenseNote   String                // "própria" | "licenciada:<ref>" — obrigatório
  attributes    Json                  // BPM, key, LUFS, textura, estrutura (medidos)
  embedding     Json?
  createdAt     DateTime @default(now())
}
```

**Por que `Candidate` não é `MusicGeneration`:** `MusicGeneration.trackId` é `@unique` e o worker
publica ao criar a `Track`. Reaproveitar aquela tabela exigiria afrouxar a unicidade e desarmar o
caminho de publicação que hoje serve os usuários — mexer no que funciona para acomodar o que não
existe. Tabela nova é aditiva, isolada e deletável.

### 8.5 Idempotência por hash

```
candidateKey = sha256( canonicalJson({
  campaignId, styleCardId, styleCardVersion, specHash,
  modelId, modelRevision,          // revisão real dos pesos, não uma tag móvel
  promptHash,                      // já produzido por prompt-policy.ts:127
  durationSeconds, seed,
  paramsHash,                      // sampler/steps/guidance/etc, canonicalizado
  referenceProfileHash | null      // null quando não há referência
}) )
```

Propriedades, e o que cada uma compra:

- **Retomada** é um `SELECT`: candidata com `candidateKey` existente e status terminal é pulada.
  Interromper a campanha no meio não custa nada além do batch em curso.
- **`jobId = candidateKey`** na fila: reenfileirar é no-op (mesmo mecanismo de `queue.ts:35`).
- **`modelRevision` dentro da chave** é deliberado: trocar de revisão de pesos gera chaves novas,
  porque a saída antiga **não é comparável** com a nova. Um pin móvel (`main`, `latest`) tornaria
  a chave uma mentira. Foi por isso que §9 exige pin por commit/tag.
- `canonicalJson` = chaves ordenadas, sem espaço, floats com precisão fixa. Sem isso, a mesma
  entrada produz hashes diferentes e a idempotência é decorativa.

### 8.6 Manifesto de evidência — JSON versionado

Um manifesto por candidata, escrito no staging e subido ao R2 ao lado dos artefatos. É o que torna
qualquer alegação deste pipeline auditável depois. Schema completo em §19.1.

Invariantes: `schemaVersion` explícito; **toda medição carrega ferramenta + versão + unidade**;
gate registra `pass|fail|notRun` (e `notRun` **conta como reprovado** — fail-closed, como
`audio-validator.ts` já faz); nenhum segredo, nenhum caminho absoluto de `$HOME`, nenhum PII.

### 8.7 Estados, lease e heartbeat

```
planned ─▶ claimed ─▶ generating ─▶ generated ─▶ analyzing ─▶ scored ─┬─▶ auto_rejected ─▶ archived
   ▲          │            │                                          ├─▶ pending_review ─┬─▶ approved ─▶ mastered ─╗
   │          │            │                                          │                   └─▶ rejected ─▶ archived  ║
   └──────────┴────────────┴── lease expirado / cancelado ────────────┘                                             ║
                                                                                            ╔═══════════════════════╝
   failed (terminal após N tentativas)   ·   quarantined (violação de política, §15)         ║  PUBLISH GATE (D3)
                                                                                            ╚═▶ published ─▶ Track
```

- **Lease.** `claimed` grava `workerId` + `leaseExpiresAt`. O worker faz *heartbeat* (renova o
  lease) a cada 30 s; um *reaper* devolve a `planned` toda candidata com lease vencido.
  `ESTIMADO`: 30 s de heartbeat e 10 min de lease para batch — o lease precisa ser maior que o
  batch mais longo, e o batch mais longo só é conhecido depois do spike. Calibrar na onda 1.
- **Por que lease e não `lockDuration`:** o `lockDuration: 15 * 60 * 1000` de `worker.ts:231` é
  do BullMQ e protege o *job*. Aqui a unidade de trabalho é o **batch** numa máquina que pode
  dormir, perder rede ou ser fechada. O lease é do control plane, visível em SQL, e sobrevive a
  reinício do Redis.
- **`generated` ≠ aprovada.** É o estado que faltava em §3.2/P1: bytes existem, nada foi julgado.
- **`quarantined` é terminal e não reciclável.** Candidata que violou política (§15) não volta
  para a fila por retentativa.

### 8.8 Staging local e R2

| Camada | Onde | Conteúdo | Retenção |
| --- | --- | --- | --- |
| Staging | disco local do Mac, fora de `$HOME`-versionado | WAV bruto do batch | até upload confirmado + verificação de digest |
| R2 `campaign/{id}/candidates/{key}/raw.wav` | R2 | bruto | até fim da campanha + janela de auditoria |
| R2 `.../master.wav` | R2 | master de aprovada | permanente |
| R2 `.../streaming.mp3` | R2 | derivado tocável | permanente |
| R2 `.../manifest.json` | R2 | manifesto | permanente |

Convive com o layout já usado por `worker.ts:139` (`music/generated/{id}/…`) num prefixo separado,
sem colisão. `Track.sourceId` continua sendo a chave do derivado de streaming, como hoje.

**Volume de staging** — `DERIVADO` (WAV 48 kHz/24 bit estéreo = 288 000 B/s; 180 s ⇒ ~51,8 MB;
MP3 192 kbps ⇒ ~4,3 MB, consistente com os ~4,4 MB registrados em
`docs/features/ai-original-music.md`):

| N candidatas | WAV bruto | MP3 streaming |
| --- | --- | --- |
| 900 | ~46,7 GB | ~3,9 GB |
| 1200 | ~62,2 GB | ~5,2 GB |
| 1500 | ~77,8 GB | ~6,5 GB |
| 2000 | ~103,7 GB | ~8,6 GB |

Consequência operacional: staging **não** cabe confortavelmente no Mac Mini de 24 GB de RAM se o
disco for pequeno; o upload+prune tem de ser contínuo, não no fim da campanha. E o teto de disco
livre é um sinal de backpressure de primeira classe (§10.4).

---

## 9. Setup reproduzível — ACE-Step 1.5

> **Integridade desta seção.** Todo comando, flag, porta e nome de parâmetro de terceiro abaixo é
> **citado do arquivo oficial que o define**, no snapshot
> `14c0211d5a0653b0f63e27686f4c3f151b4d8629`. Nada foi inventado, e onde uma flag **não existe**
> o texto diz que não existe.
>
> **`NADA NESTA SEÇÃO FOI EXECUTADO, INSTALADO OU TESTADO.`** É uma receita verificada na fonte,
> não um relato de execução. Nenhuma linha desta seção autoriza afirmar que o ambiente existe em
> qualquer das duas máquinas.
>
> DiffRhythm2 **não tem seção de setup neste RFC** por decisão (D10): sem MPS e sem
> instrumental-only, ele não é caminho de produção no Mac. A receita oficial dele está citada em
> §7.2 caso o spike de pesquisa o inclua em CPU.

### 9.1 Pré-requisitos (idênticos nos dois Macs)

| Item | Requisito | Verificação | Etiqueta |
| --- | --- | --- | --- |
| macOS | Apple Silicon (M1/M2/M3/M4 nomeados na doc oficial [3]) | `uname -m` → `arm64` | `PÚBLICO` [3] |
| Xcode CLT | instalado | `xcode-select -p` | comando padrão macOS |
| `ffmpeg`/`ffprobe` | presentes e no `PATH` | `ffprobe -version` | já **exigido pelo repo** (`audio-validator.ts:35`) |
| Python | **`>=3.11,<3.13`** — `requires-python` do `pyproject.toml` [2]; o guia traduz como 3.11–3.12 estável [3] | `python3 --version` | `PÚBLICO` [2][3] |
| `uv` | gerenciador de ambiente. **Nenhuma versão mínima de `uv` é fixada pelo projeto** [3] | `uv --version` | `PÚBLICO` [3] |
| Disco livre | ≥ §8.8 + 30 %, **mais** os pesos (§9.3) | `df -h` | `DERIVADO` |
| Rede | Tailscale entre os Macs | — | já em uso na frota |

O instalador do `uv` publicado no guia oficial do ACE-Step [3]:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 9.2 Layout de diretórios

```
~/lofigen/                       # fora de qualquer repo git versionado
  ACE-Step-1.5/                  # clone do upstream, em COMMIT pinado (§9.3)
  models/<modelId>/<revision>/   # pesos, por REVISÃO — nunca "latest"
  hf-cache/                      # cache de download isolado (não o cache global do usuário)
  staging/<campaignId>/          # WAV bruto, efêmero
  logs/                          # sem áudio, sem PII, sem segredo
  run/                           # pid, socket, lock
  server/                        # o lofigen-server (código NOSSO, versionado no repo)
```

Três escolhas com razão: (a) `models/<modelId>/<revision>/` torna o pin verificável por inspeção
de diretório, e é o que a chave de idempotência de §8.5 promete; (b) cache de download **isolado**
evita que a campanha envenene ou dependa do cache global do usuário; (c) tudo sob uma árvore torna
o uninstall de §9.15 uma remoção de árvore, não uma caça a arquivos.

O ambiente Python **não** ganha diretório próprio: `uv sync` gerencia o `.venv` dentro do clone
[3], e forçá-lo para outro lugar seria divergir da receita oficial sem ganho.

### 9.3 Pin de versão — regra dura

**Pin por commit SHA ou tag imutável**, nunca por branch. Sem isso, `candidateKey` (§8.5) mente: a
mesma chave descreveria saídas de pesos diferentes, e a retomada reusaria resultado incomparável.

| O que | Pin | Origem |
| --- | --- | --- |
| Código ACE-Step | `14c0211d5a0653b0f63e27686f4c3f151b4d8629` | snapshot verificado desta pesquisa (§0.2) |
| Pesos DiT | `modelId` + revisão do repo de pesos, registrada no manifesto | escolha do spike entre as variantes de §9.5 |
| Pesos LM | idem | idem |
| `lofigen-server` | git sha do nosso repo | manifesto (§8.6) |

**Espaço em disco dos pesos** — `PÚBLICO`, e é aqui que a contradição de §7.2.1 morde: o model card
do XL declara "Weights size (bf16) | ~18.8 GB" [9]. Planejar o disco do M4 Pro por ~9 GB (o número
do README [1]) é planejar pelo número conveniente. Para a variante ~2B a documentação verificada
não publica um tamanho equivalente — medir no download e registrar no manifesto.

### 9.4 Instalação — comandos exatos, citados da fonte

Os comandos abaixo são os do guia oficial [3], com **uma** adição nossa marcada como tal: o
`git checkout` do commit pinado, que o guia não faz porque ele não pina versão.

```bash
# 1. árvore de §9.2
mkdir -p ~/lofigen/{models,hf-cache,staging,logs,run}

# 2. clone (comando do guia oficial [3])
cd ~/lofigen
git clone https://github.com/ACE-Step/ACE-Step-1.5.git
cd ACE-Step-1.5

# 3. PIN — adição NOSSA (§9.3), não consta do guia oficial
git checkout 14c0211d5a0653b0f63e27686f4c3f151b4d8629

# 4. dependências (comando do guia oficial [3])
uv sync
```

O que `uv sync` resolve em `darwin/arm64`, `PÚBLICO` pelo `pyproject.toml` [2]: PyTorch com MPS,
`mlx>=0.25.2` e `mlx-lm>=0.20.0`. Em plataforma não-`arm64` o mesmo projeto cai no caminho PyTorch
sem MLX [3] — o que é irrelevante aqui, mas explica por que a receita não é portável.

### 9.5 Variantes de modelo — o que existe, para o spike escolher

`PÚBLICO` [1]. O spike (§11.2) escolhe; este RFC não escolhe por ele.

**DiT padrão (~2B):**

| Modelo | Steps | CFG | Escopo |
| --- | ---: | ---: | --- |
| `acestep-v15-base` | 50 | sim | todas, incluindo extract/lego/complete |
| `acestep-v15-sft` | 50 | sim | padrão/reference/cover/repaint |
| `acestep-v15-turbo` | 8 | não | padrão/reference/cover/repaint |

**DiT XL (~4B):** `acestep-v15-xl-base` (50 steps, CFG), `acestep-v15-xl-sft` (50, CFG),
`acestep-v15-xl-turbo` (8, distilled, sem CFG) [1][9].

**LM:** `acestep-5Hz-lm-0.6B`, `acestep-5Hz-lm-1.7B`, `acestep-5Hz-lm-4B` [1].

⚠️ **`acestep-v15-xl-*` + `acestep-5Hz-lm-4B` + Autoscore é a combinação de alto risco de memória
de §7.5**, com issue fechada por inatividade [12] e correção ainda aberta [13]. Ela **não** entra
como default da matriz do spike, e menos ainda no M4 Pro de 24 GB.

### 9.6 Servidor headless e portas — **dois** processos, não um

Distinção que precisa ficar explícita para ninguém confundir as portas:

| Processo | O que é | Porta | Origem |
| --- | --- | --- | --- |
| `acestep-api` | **REST do próprio ACE-Step.** Entry point declarado no `pyproject.toml`: `acestep-api = "acestep.api_server:main"` | **8001** (padrão) | `PÚBLICO` [2][3] |
| `acestep` | Gradio UI do próprio ACE-Step (`acestep = "acestep.acestep_v15_pipeline:main"`) | **7860** (padrão) | `PÚBLICO` [2][3] |
| `lofigen-server` | **Código nosso** (§8.3): HMAC, `/v1/capabilities`, lease, `drain`, artefato por id | **8787** (nossa escolha) | proposta deste RFC |

**Por que os dois.** O `acestep-api` entrega geração; ele não entrega autenticação HMAC,
`protocolVersion`, lease/heartbeat, nem `POST /v1/admin/drain` — que são requisitos de §8.3, §8.7 e
§16.5. O `lofigen-server` é o adaptador fino que fala com `127.0.0.1:8001` e expõe o contrato `/v1`
para o Node. `HIPÓTESE` apenas na fronteira interna (quais campos o adaptador traduz); o fato de
`acestep-api` existir na 8001 é `PÚBLICO` [2][3].

Subida do REST oficial, nas duas formas publicadas [3]:

```bash
# forma genérica
uv run acestep-api        # REST API, porta padrão 8001
uv run acestep            # Gradio UI, porta padrão 7860  (não usado pela campanha)

# forma macOS (launcher oficial, headless)
chmod +x start_api_server_macos.sh
./start_api_server_macos.sh
```

**Backend Apple Silicon — e a diferença entre duas flags que se parecem.** `PÚBLICO`, e confundir
as duas é o erro fácil aqui:

- Os launchers macOS configuram `ACESTEP_LM_BACKEND=mlx` e passam **`--backend mlx`** [3], com
  fallback PyTorch fora de `arm64`.
- O `profile_inference.py` usa **`--lm-backend mlx`** [6], junto de `--device mps`.
- A documentação trata os dois eixos como distintos: "MPS (Apple Silicon) | `--device mps`" versus
  "MLX | `--lm-backend mlx` | Optimized for Apple Silicon" [6].

Ou seja: **device** (`mps`) e **backend do LM** (`mlx`) são escolhas separadas, e o nome da flag
**muda por entry point**. Não assumir que `--backend` e `--lm-backend` são intercambiáveis — usar
a que o entry point invocado documenta.

### 9.7 Batch — "máx 8" é limite funcional, não garantia

`PÚBLICO`, com a leitura correta explicitada:

- O README promete "Generate up to 8 songs simultaneously" [1].
- Na REST, `batch_size` tem **default 2 e máximo 8**: "`batch_size` | int | `2` | Batch generation
  count (max 8)." [4]
- O runtime tem VRAM guard e **pode reduzir o batch automaticamente** por memória [15].

**Portanto 8 é o teto que a API aceita, não uma promessa de que 8 caiba.** Depende de memória
unificada, duração, variante de DiT/LM e do VAE. Consequência normativa, coerente com §10.6:
**começar em `B=1`** nas duas máquinas e subir por degraus medidos (§10.6, auto-tuning). Registrar
no manifesto do spike o `batch_size` **pedido** e o **efetivo**, porque o runtime pode tê-los
divergido sem erro.

### 9.8 Instrumental no REST — a forma correta, e a que não existe

`PÚBLICO`, e esta é a distinção operacionalmente mais importante de §9 para o Lofiever, porque R2
faz de vocal uma reprovação:

- **API Python:** `GenerationParams.instrumental: bool = False` existe, e `create_sample(...,
  instrumental=False)` também [5]. O `profile_inference.py` expõe `--instrumental` **no modo
  `create_sample`** [6].
- **REST `/release_task`:** o schema principal **não declara um booleano `instrumental`**. O
  servidor classifica a geração como instrumental quando `lyrics` está **vazio** ou é
  `[inst]`/`[instrumental]` [14].

Forma REST portátil, que é a que a campanha usa:

```json
{
  "prompt": "ambient electronic soundscape",
  "lyrics": "[Instrumental]"
}
```

⚠️ **Não documentar nem enviar `instrumental: true` como parâmetro de `/release_task`.** Ele
pertence à API Python e a outro endpoint, não ao schema dessa rota [14] — um campo desconhecido
silenciosamente ignorado produziria faixas com vocal passando por "instrumental pedido", que é
exatamente a falha que R2 e o gate de vocal existem para pegar.

### 9.9 `reference_audio` × `src_audio` × `audio_cover_strength`

`PÚBLICO`, e são **três** coisas diferentes com nomes parecidos. Trocá-las não dá erro — dá
resultado errado.

| Papel | Nome por interface | Semântica |
| --- | --- | --- |
| Referência de **estilo** | Python `GenerationParams.reference_audio`; REST com arquivo no servidor `reference_audio_path`; multipart `reference_audio` ou `ref_audio` [4][5] | condicionamento de estilo, opcional |
| Áudio-**fonte** de cover/repaint | `src_audio` ou `src_audio_path` [4][5] | a música que está sendo coberta/repintada |
| Força do cover | `audio_cover_strength`, intervalo **0–1**, **default 1.0** [4][5] | quanto do fonte é preservado |

Para cover, a música coberta entra em **`src_audio`**; `reference_audio` é referência de estilo
opcional [4][5]. Confundir os dois campos é a diferença entre "inspirado em" e "regravação de".

**Sobre `audio_cover_strength=0.2`:** a documentação oficial sugere valores baixos para
transferência de estilo — "Lower values (0.2) for style transfer." [4][5]. Isso é `PÚBLICO` **como
sugestão do fornecedor**, e este RFC a registra como tal. **O uso no Lofiever continua `HIPÓTESE`**
e será calibrado: §12.4 restringe referência a força baixa e só como fator do spike, e a força
efetiva tem de ser validada contra o gate de similaridade de C1 antes de virar default de
produção. Adotar 0,2 porque a doc do modelo o sugere seria importar um número de outro contexto —
o número que vale para nós é o que a onda 2 mostrar que mantém a similaridade abaixo da banda de
reprova.

### 9.10 Cache, download de pesos e pin

O download acontece na primeira execução. Para manter o pin verificável e o uninstall trivial, a
campanha redireciona o cache para a árvore de §9.2 (`~/lofigen/hf-cache/`) em vez de usar o cache
global do usuário, e registra no manifesto o `modelId`, a `revision` e o digest dos arquivos de
peso (§8.6, §19.1).

⚠️ `NÃO VERIFICADO` — **o nome exato da variável de ambiente que redireciona o cache** não foi
confirmado nas fontes desta pesquisa (lacuna residual L2, §20.2). O que este RFC afirma é o
**requisito** (cache isolado, pin registrado), não a variável. Resolver no PR-1, lendo a
configuração do snapshot pinado; até então, tratar o diretório de cache como **não isolado** e não
prometer que `rm -rf ~/lofigen/` remove tudo.

Para o VAE MLX existe um botão oficial de memória, e este sim é `PÚBLICO`:
**`ACESTEP_MLX_VAE_CHUNK`** [11], com default automático por memória unificada (≤16 GB → 256;
≤36 GB → 512; ≤64 GB → 1024; >64 GB → 2048) [11]. Registrar o valor efetivo no manifesto do spike:
sem ele, comparar M5 Max com M4 Pro é comparar duas configurações diferentes (§7.5).

### 9.11 Comandos de benchmark que **já existem** no projeto

`PÚBLICO` [1][6]. O `profile_inference.py` existe no repositório e é documentado como ferramenta
de profiling/benchmark de LM, DiT e VAE. Modos publicados: `profile`, `benchmark`, `tier-test`,
`understand`, `create_sample`, `format_sample` [6].

```bash
python profile_inference.py
python profile_inference.py --mode benchmark
python profile_inference.py --device mps --lm-backend mlx
python profile_inference.py --mode benchmark --benchmark-output results.json
```

A **matriz default** do modo `benchmark` cobre durações 30/60/120/240 s, batch 1/2/4, `thinking`
true/false e 8/16 steps, com clamping por memória [6].

⚠️ Essa matriz é **do fornecedor**, e não é a matriz do Lofiever. §11.2 explica por que a nossa é
150/180/184 s: a janela que o `audio-validator.ts` já reprova fora (C3) não aparece na matriz
oficial, e medir 120 s ou 240 s não responde se 180 s cabe na janela noturna. O harness próprio de
§11 continua obrigatório — ele é a fonte de wall time, RTF amortizado, memória e energia.

### 9.12 Variáveis de ambiente (sem segredo)

```bash
# ~/lofigen/lofigen.env   — chmod 600, NÃO versionado, sem valor real de segredo aqui
LOFIGEN_BIND=127.0.0.1
LOFIGEN_PORT=8787                   # o lofigen-server (NOSSO); o acestep-api fica na 8001
LOFIGEN_PROTOCOL_VERSION=1
LOFIGEN_ACESTEP_URL=http://127.0.0.1:8001   # REST oficial do ACE-Step (§9.6)
LOFIGEN_ACESTEP_REPO_COMMIT=14c0211d5a0653b0f63e27686f4c3f151b4d8629
LOFIGEN_MODEL_ID=<variante de §9.5, escolhida pelo spike>
LOFIGEN_MODEL_REVISION=<commit ou tag imutável dos pesos>
LOFIGEN_MODEL_DIR=/Users/<user>/lofigen/models
LOFIGEN_CACHE_DIR=/Users/<user>/lofigen/hf-cache
LOFIGEN_STAGING_DIR=/Users/<user>/lofigen/staging
LOFIGEN_DEVICE=mps                  # PÚBLICO como caminho oficial [3][6]; execução TBD (onda 1)
LOFIGEN_LM_BACKEND=mlx              # idem — ver §9.6 sobre --backend vs --lm-backend
LOFIGEN_MAX_BATCH=1                 # conservador por decisão (§9.7, §10.6); auto-tuning depois
LOFIGEN_MAX_CONCURRENT_JOBS=1
LOFIGEN_HMAC_KEY_FILE=/Users/<user>/lofigen/.hmac    # o ARQUIVO, nunca o valor
LOFIGEN_LOG_LEVEL=info
```

No lado Node, seguindo o padrão de `config.ts` (variáveis `AI_MUSIC_*`, valor default explícito):

```bash
AI_MUSIC_LOCAL_ENABLED=false            # kill switch, desligado por default
AI_MUSIC_LOCAL_M5_URL=http://127.0.0.1:8787
AI_MUSIC_LOCAL_M4_URL=http://<tailscale-host>:8787
AI_MUSIC_LOCAL_HMAC_KEY_FILE=/path/to/key
AI_MUSIC_CAMPAIGN_ENABLED=false         # kill switch da campanha
AI_MUSIC_CAMPAIGN_BUDGET_USD=0          # D9 — separado de AI_MUSIC_MONTHLY_BUDGET_USD
AI_MUSIC_CAMPAIGN_PUBLISH_GATE=manual   # D3
```

Nenhum valor de segredo em arquivo versionado. Chave HMAC referenciada **por caminho**. Backups de
config vão para o scratchpad da sessão com `chmod 600`, nunca para o lado do original.

### 9.13 Healthcheck

```
GET /v1/health  →  { status, protocolVersion, modelId, modelRevision,
                     device, lmBackend, vaeChunk, jobsInFlight,
                     freeStagingBytes, uptimeSeconds }
```

O control plane trata o worker como **indisponível** quando: `protocolVersion` major diferente,
`modelRevision` diferente da esperada pela campanha, `freeStagingBytes` abaixo do piso, ou 3
healthchecks consecutivos falhos. Indisponível ⇒ fila daquela capability é pausada, não drenada
para outra máquina (senão a mistura de revisões contamina a comparação).

`device`, `lmBackend` e `vaeChunk` estão no health por causa de §7.5 e §9.6: duas máquinas com
chunk de VAE diferente ou backend diferente não produzem números comparáveis, e essa divergência
precisa ser visível antes do batch, não descoberta na análise.

### 9.14 launchd (opcional)

`HIPÓTESE`, **opcional de propósito** e **não testado**: no MacBook interativo, um serviço que sobe
no login é um processo pesado disputando com o trabalho do dono. Preferência: início manual, ou
agendado só na janela noturna (§10.5). No Mac Mini, um `LaunchAgent` faz mais sentido. Esqueleto em
§19.3, com `RunAtLoad=false` por default.

**Nenhum `LaunchAgent` foi instalado ou carregado em qualquer máquina.** O plist de §19.3 é
proposta; a única afirmação verificável sobre ele é a de que existe como texto neste documento.

### 9.15 Uninstall / rollback

Rollback é uma propriedade que se projeta antes, não depois:

1. `AI_MUSIC_LOCAL_ENABLED=false` e `AI_MUSIC_CAMPAIGN_ENABLED=false` — efeito imediato, sem
   deploy;
2. `POST /v1/admin/drain` nos dois Macs — termina o que está em curso, não aceita novo;
3. parar o `acestep-api` (e o `lofigen-server`) pelo pid em `~/lofigen/run/`;
4. descarregar o `LaunchAgent`, se existir (`launchctl unload`);
5. `rm -rf ~/lofigen/` — remove clone, `.venv`, pesos, cache e staging **de uma vez**, porque §9.2
   os manteve numa só árvore. ⚠️ Com a ressalva de L2 (§9.10): enquanto o redirecionamento de cache
   não estiver confirmado, **assumir que restou cache fora da árvore** e conferir antes de declarar
   a máquina limpa;
6. revogar a chave HMAC;
7. no repo: a migration é aditiva; reverter é `migrate resolve` + drop das tabelas novas. Nenhuma
   `Track` publicada é afetada, e nenhuma coluna de `MusicGeneration`/`Track` foi alterada.

**Nada disso foi testado.** O teste de rollback é entregável da onda 1 (§11.6) — e o passo 5 é o
que mais precisa dele, porque `rm -rf` de uma árvore incompleta dá a **impressão** de uninstall.

---

## 10. Paralelismo e capacidade

> Nenhuma célula desta seção contém tempo de parede medido. Todas as conversões de "quantas
> candidatas" para "quanto tempo" passam por `RTF`, que é `TBD`. Não há benchmark publicado de
> M5 Max ou M4 Pro citado ou assumido.

### 10.1 Notação

| Símbolo | Significado | Valor |
| --- | --- | --- |
| `N_ap` | faixas **aprovadas** alvo | 300 ou 400 |
| `k` | candidatas por faixa aprovada | 3 ou 5 |
| `N_c` | candidatas a gerar = `N_ap × k` | `DERIVADO` |
| `D` | duração de áudio alvo, s | 180 (§C3) |
| `B` | tamanho do batch numa máquina | `TBD` |
| `RTF(dev, m, B)` | **RTF amortizado por candidata** = `T_batch / (B × D)` | **`TBD` — MEDIDO na onda 1** |
| `θ(dev,B)` | vazão = `1 / (RTF × D)` candidatas/s | `DERIVADO` de `RTF` |
| `u(dev)` | duty-cycle: fração do tempo em que a máquina pode gerar | `ESTIMADO`, §10.5 |
| `Θ` | vazão agregada = `Σ_dev θ(dev,B_dev) × u(dev)` | `DERIVADO` |
| `W` | horas úteis por noite | `ESTIMADO`, §10.5 |

`RTF < 1` = mais rápido que tempo real. `RTF` **amortizado** (dividido por `B`) é a grandeza certa
aqui: é ela que o batching melhora, e é ela que entra na vazão.

### 10.2 Fórmulas

```
(1)  N_c        = N_ap × k
(2)  θ(dev,B)   = 1 / ( RTF(dev,m,B) × D )                      [candidatas/s]
(3)  Θ          = Σ_dev  θ(dev,B_dev) × u(dev)
(4)  T_gen      = N_c / Θ                                       [s de parede]
(5)  noites     = ceil( T_gen / (W × 3600) )
(6)  η(B)       = θ(dev,B) / ( B × θ(dev,1) )                    [eficiência do batch]
(7)  T_post     = N_c × t_post / P_post   (+ N_ap × t_master)     [pipeline de análise]
(8)  T_total    ≈ max( T_gen , T_post ) + T_rampa                 [se pipelinado, §10.3]
```

Nada em (2)–(8) é computável hoje: `RTF`, `t_post`, `η` e `B` são todos `TBD`. **É esse o ponto** —
a estrutura está pronta para receber a medição, e não há número inventado ocupando o lugar dela.

### 10.3 Cenários — `ESTIMADO`, com `RTF` como variável livre

`N_c` é `DERIVADO` de (1). As colunas de tempo são **fórmulas**, não valores:

| `N_ap` | `k` | `N_c` | `T_gen` (uma máquina, `u=1`) | Rendimento implícito `1/k` |
| --- | --- | --- | --- | --- |
| 300 | 3 | **900** | `900 × RTF × 180 s` | 33,3 % |
| 400 | 3 | **1200** | `1200 × RTF × 180 s` | 33,3 % |
| 300 | 5 | **1500** | `1500 × RTF × 180 s` | 20,0 % |
| 400 | 5 | **2000** | `2000 × RTF × 180 s` | 20,0 % |

Para leitura de sensibilidade — **`ESTIMADO`, hipotético, não é predição de nenhuma máquina**:

| `RTF` hipotético | `T_gen` p/ 900 | 1200 | 1500 | 2000 |
| --- | --- | --- | --- | --- |
| 0,10 | 4,5 h | 6,0 h | 7,5 h | 10,0 h |
| 0,25 | 11,3 h | 15,0 h | 18,8 h | 25,0 h |
| 0,50 | 22,5 h | 30,0 h | 37,5 h | 50,0 h |
| 1,00 | 45,0 h | 60,0 h | 75,0 h | 100,0 h |
| 2,00 | 90,0 h | 120,0 h | 150,0 h | 200,0 h |

Cada célula é `N_c × RTF × 180 / 3600` — aritmética de (4) com `Θ = 1/(RTF×D)`. **A escolha de
`RTF` é arbitrária e ilustra a faixa de decisão, não a máquina.** A ordem de grandeza muda 20× do
topo à base da tabela, e é exatamente por isso que a campanha não pode ser planejada antes do
spike: com `RTF = 0,10` a campanha inteira é uma noite; com `RTF = 2,0`, são semanas, e a resposta
correta passa a ser a API.

### 10.4 Batch × múltiplos processos × memória unificada

Três formas de paralelizar, com trade-offs diferentes:

| Estratégia | Ganho esperado | Custo | Etiqueta |
| --- | --- | --- | --- |
| **Batch dentro de um processo** | amortiza carga do modelo e overhead por passo | pico de memória cresce com `B`; um OOM perde o batch todo | `HIPÓTESE` |
| **Múltiplos processos** | isola falha; usa CPU ociosa | **cada processo carrega os pesos de novo** — em memória unificada isso compete com a GPU | `HIPÓTESE` |
| **Pipeline entre estágios** | análise de um batch roda durante a geração do próximo | complexidade de escalonamento | `HIPÓTESE` |

Sobre memória unificada em Apple Silicon: CPU e GPU compartilham a **mesma** memória física. A
consequência prática que rege o desenho: `B` grande e "mais um processo" competem pelo **mesmo**
recurso, então as duas estratégias **não** compõem linearmente, e o teto não é a RAM total mas o
que o backend de GPU consegue manter residente. O MacBook (128 GB) tem folga estrutural que o Mac
Mini (24 GB) não tem — daí `B_m4 < B_m5` por default e a divisão de papéis de §10.6.

Que isso não é teoria abstrata, `PÚBLICO` [10][11]: o próprio ACE-Step trata a decodificação do
VAE MLX como o consumidor dominante em Mac de memória unificada, e a mitigação mesclada é
**reduzir o chunk** — de 2048 para 512, descrita como "cutting peak GPU memory by ~56% on
unified-memory Macs" [10] — hoje escalonada automaticamente por tamanho de memória e ajustável por
`ACESTEP_MLX_VAE_CHUNK` [11]. É o mesmo princípio de `B`: sob pressão, **diminuir a unidade de
trabalho**, não remover o limite.

**Três alavancas de memória, em ordem de preferência:**

| Ordem | Alavanca | Custo | Privilégio | Etiqueta |
| --- | --- | --- | --- | --- |
| 1 | reduzir `B` (§10.6) | tempo | nenhum | decisão deste RFC |
| 2 | reduzir `ACESTEP_MLX_VAE_CHUNK` abaixo do default automático [11] | tempo no VAE (68 → 78 s no benchmark do PR [10]) | nenhum | `PÚBLICO` [10][11] |
| 3 | evitar a combinação XL + LM 4B + Autoscore (§7.5) | qualidade/capacidade | nenhum | `PÚBLICO` [12][13] |

**O que este RFC recusa como alavanca:**

- O ajuste de `sysctl` para elevar o limite de memória *wired* da GPU no macOS: `NÃO VERIFICADO`,
  **exige `sudo`**, altera o sistema, e **não é passo de nenhuma seção** — fica em §19.5 como
  conhecimento marcado. Nenhum passo obrigatório deste RFC usa `sudo`.
- `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0`: **não recomendado como solução universal**, pelos motivos
  de §7.5 — não consta como mitigação oficial nas fontes verificadas [10][11][12][13], e remover o
  teto de um alocador não reduz a demanda que causou a pressão.

**Backpressure**, quatro sinais, cada um com ação definida:

| Sinal | Fonte | Ação |
| --- | --- | --- |
| Profundidade da fila por capability | `Queue.getWaitingCount()` | parar de planejar candidatas novas |
| Disco livre no staging | `/v1/health` | pausar a capability; forçar upload+prune |
| Pressão de memória / erro de alocação | worker local | reduzir `B` pela metade, reenfileirar, **nunca** repetir com o mesmo `B` |
| Máquina interativa em uso | §10.5 | drain imediato |

### 10.5 Escalonamento noturno sem saturar a máquina interativa

R3 é uma restrição, não uma preferência. O MacBook é a máquina de trabalho do dono.

| Guarda | Regra | Etiqueta |
| --- | --- | --- |
| Janela | `W` = horas da janela noturna (proposta inicial: 6, 00:00–06:00 local) | `ESTIMADO` |
| Duty-cycle | `u(m5) = 0,8` dentro da janela, `0` fora dela | `ESTIMADO` |
| Detecção de uso | sinal de atividade do usuário ⇒ `drain` em ≤ 60 s | `HIPÓTESE` |
| Energia | pausar quando fora da tomada, ou bateria < 40 % | `HIPÓTESE` |
| Térmico | reduzir `B` sob throttling sustentado | `HIPÓTESE` |
| Prioridade | processo em nice baixa; nunca competir com o app em foreground | `HIPÓTESE` |

O Mac Mini não é interativo: `u(m4)` pode ser alto, limitado por térmica e pelos 24 GB. Divisão
natural de papéis — o Mini é o que roda **contínuo**, o MacBook é o que roda **em rajada**.

### 10.6 Limites iniciais conservadores + auto-tuning depois

Começar restrito é a escolha certa quando não há medição: `B` grande demais custa um OOM que
perde o batch inteiro e envenena a medição; `B` pequeno demais custa só tempo.

| Parâmetro | Valor inicial | Justificativa |
| --- | --- | --- |
| `LOFIGEN_MAX_BATCH` (M5) | 1 | sem `RTF` nem pico de memória medidos, `B>1` é aposta |
| `LOFIGEN_MAX_BATCH` (M4) | 1 | 24 GB unificados |
| `LOFIGEN_MAX_CONCURRENT_JOBS` | 1 por máquina | evita competição por memória unificada |
| Concorrência BullMQ por capability | 1 | espelha o worker atual (`worker.ts:230`) |
| `u(m5)` fora da janela | 0 | R3 |
| Retentativas por candidata | 2 | espelha `AI_MUSIC_MAX_ATTEMPTS` (`config.ts:109`) |

**Auto-tuning pós-spike** (`HIPÓTESE`): subir `B` em degraus, aceitando o degrau só se
`η(B) ≥ 0,75` (fórmula 6) **e** o pico de memória ficar abaixo de um teto configurado; primeira
falha de alocação volta ao último degrau bom e **fixa** o limite. Auto-tuning nunca sobe sozinho
acima do teto que o operador configurou.

---

## 11. Spike (onda 1) — obrigatório antes de qualquer produção

O spike existe para preencher `MEDIDO`. Sem ele, §10 é só álgebra. **Nenhuma execução do spike
aconteceu; toda tabela de resultado abaixo está vazia por ser o estado correto.**

### 11.1 Gate de entrada — **satisfeito para ACE-Step 1.5**

O gate de entrada era: licença compatível confirmada e suporte a macOS/Apple Silicon confirmado.
Os dois estão respondidos por §0.2/§7 e **não bloqueiam mais**:

| Gate de entrada | ACE-Step 1.5 | DiffRhythm2 |
| --- | --- | --- |
| Licença do código | ✅ MIT [7] | ✅ Apache-2.0 [22] |
| Licença dos pesos + output comercial | ✅ pesos MIT, uso comercial afirmado no card [8][9] (ressalva de §7.3) | ⚠️ pesos Apache-2.0 [16][23]; **sem termo de output** |
| macOS Apple Silicon documentado | ✅ `mps` + `mlx`, launchers próprios [3][6] | ❌ `cuda if available else cpu` [17] |

**Consequência:** ACE-Step 1.5 entra no spike como candidato de produção. DiffRhythm2 entra
**apenas** como controle de pesquisa, e **em CPU** — porque é o único caminho que o código oficial
lhe dá no Mac [17]. Medir DiffRhythm2 em "MPS" seria medir algo que não existe.

### 11.2 Matriz experimental — a matriz **do Lofiever**, e por que ela difere da oficial

O ACE-Step publica sua própria matriz default de benchmark: durações 30/60/120/240 s, batch 1/2/4,
`thinking` true/false, 8/16 steps, com clamping por memória [6]. Ela pode ser **citada e até
executada** como sanidade — é código que já existe (§9.11) —, mas **não substitui** a matriz
abaixo, por uma razão concreta: 120 s e 240 s estão fora da janela que o `audio-validator.ts` já
reprova (C3: 145–190 s). Medir onde não vamos gerar não responde à pergunta da onda 1.

| Fator | Níveis (Lofiever) | Por quê |
| --- | --- | --- |
| Modelo | ACE-Step 1.5 nas variantes de §9.5 que passarem §11.1; DiffRhythm2 só como controle de pesquisa | D7/D10 |
| Device | `mps` + `--lm-backend mlx` [6]; `cpu` como controle (mostra se a aceleração vale) | §9.6 |
| Máquina | M5 Max 128 GB, M4 Pro 24 GB | §10.5 |
| `D` (s) | **150, 180, 184** | a janela de C3, não a matriz oficial |
| `B` | **1, 2, 4** — **parar de escalar na primeira falha de alocação** e registrar o teto | §9.7: 8 é o máximo que a API aceita [4], não o que cabe |
| `ACESTEP_MLX_VAE_CHUNK` | default automático, e um degrau abaixo | §7.5, §10.4 |
| Referência | sem referência; com referência em força baixa (§12.4) | fator, não default |

Cada célula: **3+ repetições** e **1 warmup descartado** (a primeira execução paga carga de modelo
e compilação de kernel; misturá-la com as medidas contamina o `RTF`). Isso vale inclusive quando o
`profile_inference.py` for usado como executor — o warmup e as repetições são exigência **nossa**.

**Combinações excluídas por decisão, não por esquecimento:** XL + LM 4B + Autoscore, pelos motivos
de §7.5 e §9.5 (issue de memória fechada por inatividade [12], correção aberta [13], e o M4 Pro tem
menos memória que o hardware do relato).

### 11.3 O que capturar por execução — e por que o harness continua sendo nosso

| Métrica | Como | Nota |
| --- | --- | --- |
| Wall time | monotônico, no servidor local | por batch **e** por candidata |
| Duração real do áudio | `ffprobe` | nunca a duração *pedida* |
| **RTF amortizado** | `T_batch / (B × D_real)` | a saída principal |
| RSS de pico | amostragem do processo | inclui memória unificada |
| `batch_size` pedido × efetivo | resposta do `acestep-api` | o runtime pode reduzir sozinho [15] |
| `ACESTEP_MLX_VAE_CHUNK` efetivo | env + health (§9.13) | sem ele, M5 × M4 não é comparável |
| Erros/retries | contador + código | falha de alocação é destacada |
| Energia | `powermetrics` **quando disponível** | **exige `sudo`** — ver §11.5 |
| Qualidade | gates de §13 na candidata | taxa de aprovação automática é comparativo, não gate |
| Determinismo | mesma seed 2× → digest igual? | decide se `seed` na chave de §8.5 significa algo |

**Divisão de trabalho com o `profile_inference.py`.** Ele existe, é oficial e é útil [1][6] — mas
ele é um profiler do fornecedor, e a onda 1 precisa de quatro coisas que não são o objetivo dele:

| Precisamos de | Quem entrega |
| --- | --- |
| Wall time e **RTF amortizado por candidata** na janela 150/180/184 s | **harness nosso** |
| Pico de memória do processo e teto de `B` na nossa máquina | **harness nosso** |
| Energia (`powermetrics`, degradando para `null`) | **harness nosso** |
| Taxa de aprovação automática pelos gates de §13 | **harness nosso** (os gates são nossos) |
| Sanidade de LM/DiT/VAE e comparação com a matriz do fornecedor | `profile_inference.py` [6] |

Regra: o `profile_inference.py` pode ser **invocado** pelo harness, e sua saída
(`--benchmark-output results.json` [6]) anexada ao manifesto como evidência auxiliar. O que **não**
pode é a decisão de §2.3 sair da matriz oficial — ela mede outras durações, em outra máquina, com
outro objetivo.

### 11.4 Manifesto de evidência do spike

Um JSON por execução (schema §19.2), com: identidade de hardware, `modelId` + `modelRevision` +
digest dos pesos, commit pinado do ACE-Step, `commit` do `lofigen-server`, `device`, `lmBackend`,
`vaeChunk`, versões de ferramentas, matriz de fatores, as 3+ repetições **individualmente** (não só
a média), e o que **falhou**. Sem os individuais não há variância; sem variância, `RTF` é um número
sem barra de erro.

### 11.5 Sudo: explícito, nunca silencioso

`powermetrics` exige privilégio elevado. Regra: o harness **detecta** a disponibilidade, e se não
houver, **registra `energy: null` com o motivo** e segue. Não pede senha no meio de um batch, não
falha por isso, e não deixa a ausência parecer zero. Energia é métrica desejável; a decisão de
§2.3 não depende dela.

### 11.6 Entregáveis e go/no-go

Entregáveis: tabela `RTF × (modelo, device, D, B)` com variância; teto de `B` por máquina; pico de
memória; `batch_size` efetivo × pedido; taxa de aprovação automática por modelo; resultado de
determinismo; teste de rollback de §9.15 executado; e `PILOT_HARNESS.md` reprodutível.

**Go para a onda 2** se, para ao menos um modelo: §2.3 critérios 1–6 aprovados; `RTF` medido
tornando `T_gen` de (4) compatível com a janela noturna de §10.5 para o cenário escolhido; teto de
`B` ≥ 1 estável sem falha de alocação em 3 repetições; taxa de aprovação automática ≥ 40 %
(`ESTIMADO` — recalibrar com a distribuição real); rollback testado.

**No-go** se: nenhum modelo passa 1–6; `RTF` exige mais noites que o prazo tolera; falha de
alocação em `B=1`; ou aprovação automática < 20 % (`ESTIMADO`), que indica prompt/modelo errado, e
não pipeline errado.

---

## 12. Referências musicais — governança

### 12.1 Regra de admissão

Só entra como referência arquivo **local** que seja: de autoria própria, **ou** licenciado com
comprovante registrado. Nada de link de streaming, nada de rip, nada de "achei no YouTube".
`QUALITY-PROCESS §3` aceita hoje URL de Spotify/YouTube como fonte de referência: **esta regra
substitui aquela** para a campanha. Sem comprovante de licença, o arquivo não entra —
`ReferenceProfile.licenseNote` é `String` não-nulo por isso.

### 12.2 O áudio de referência nunca sai da máquina

R4/D6. O áudio de referência **não** vai para R2, **não** vai para o Postgres, **não** vai para
API de terceiro. O que circula são **atributos** e **embedding**. Enviar áudio a qualquer API
exige opt-in **por artefato**, registrado, com a finalidade declarada — e o default é não.

Motivo de ser das duas únicas exceções desta regra: é irreversível. Um upload indevido não se
desfaz apagando depois; o dado pode já estar cacheado, indexado ou usado. Por isso esta é a única
decisão de §2.1 marcada como parcialmente **irreversível** (§18.3).

### 12.3 Análise de atributos → style card abstrato

Mantém a espinha de `QUALITY-PROCESS §4-5`, com três emendas:

1. **`ReferenceProfile` guarda medição, não opinião**: BPM, tonalidade + confiança, LUFS, true
   peak (C4), faixa dinâmica, centroide/largura espectral, fronteiras de estrutura, escore de
   repetição — cada um com ferramenta e versão.
2. **O style card é o único artefato que toca o prompt.** Ele é abstrato por construção: gênero,
   BPM, tonalidade, mood, instrumentos, estrutura, textura, exclusões. **Zero** nome próprio.
3. **Validador de style card é bloqueante**, não conselho. Além dos padrões de imitação que
   `prompt-policy.ts:4` já tem, a campanha precisa da lista de tokens banidos que
   `QUALITY-PROCESS §12.1` pressupõe existir e que **não existe no código** (§13.5). Card que
   não passa não gera.

### 12.4 `reference_audio` / força de referência

O suporte existe e os nomes são conhecidos — `PÚBLICO` (§9.9): `reference_audio` é referência de
**estilo**, `src_audio` é o áudio-**fonte** de cover/repaint, e `audio_cover_strength` vai de 0 a 1
com default **1.0** [4][5]. A documentação sugere "Lower values (0.2) for style transfer" [4][5].

O **uso no Lofiever continua `HIPÓTESE`**, e propositalmente restrito:

1. **Força baixa, e só como fator do spike** (§11.2) — nunca como default de produção antes de
   medir o efeito na similaridade de C1. Força alta é o caminho mais curto para produzir derivado
   da referência, que é exatamente o que o gate de similaridade existe para impedir. O default do
   parâmetro é `1.0` [4][5], isto é, o **oposto** do que queremos: quem não configurar
   explicitamente pede o máximo de preservação do fonte.
2. **`0.2` é sugestão do fornecedor, não threshold nosso.** Ela entra na matriz do spike como
   ponto de partida citável, e o valor que vale para a campanha é o que a onda 2 mostrar que mantém
   a similaridade abaixo da banda de reprova de C1 — com o par (modelo, revisão) do embedder
   registrado (§13.3, §13.7).
3. **Nunca `src_audio` na campanha.** Cover/repaint parte de uma gravação existente; o objetivo
   aqui é obra autoral. Usar `src_audio` seria pedir ao modelo o derivado que R1 e C1 existem para
   evitar. O campo fica fora do `LocalMusicProvider`, não apenas ausente do default.
4. Se a força não for controlável de forma verificável no caminho que a campanha usa, **não usar**.

Nada disso afrouxa R4/§12.2: o áudio de referência é **local**, e nada disso o autoriza a sair da
máquina.

---

## 13. Quality factory

Herda a estrutura de `QUALITY-PROCESS §7-12` com as correções de §6 aplicadas. **Todo threshold
numérico é `ESTIMADO` e calibrado na onda 2** (§13.7) — nenhum é apresentado como verdade
universal.

### 13.1 Ordem dos gates (mais barato primeiro)

```
raw ─▶ [decodifica?] ─▶ [duração] ─▶ [silêncio] ─▶ [vocal] ─▶ [LUFS/TP] ─▶ [BPM/key]
       ─▶ [repetição] ─▶ [fingerprint] ─▶ [embedding: ref] ─▶ [embedding: catálogo]
       ─▶ [escuta humana / amostragem] ─▶ [master] ─▶ [REVALIDA pós-master] ─▶ publish gate
```

Ordenar por custo crescente é o que torna 2000 candidatas viável: reprovar em `ffprobe` custa
milissegundos, reprovar em escuta humana custa minutos de pessoa. **Fail-closed em toda a cadeia**:
gate que não executou = `notRun` = reprovado, exatamente como `audio-validator.ts` já se comporta.

### 13.2 Gates técnicos

| Gate | Medição | Aceita | Reprova | Etiqueta |
| --- | --- | --- | --- | --- |
| Decodificação | `ffprobe` | codec/sample rate/canais esperados | qualquer falha | alinhado a `audio-validator.ts:249` |
| Duração | `ffprobe` | 150–184 s | `<145` ou `>190` | §C3 |
| Silêncio cabeça/cauda | detector dedicado | ≤ 2 s cada | > 5 s | §C6, `ESTIMADO` |
| Silêncio total | razão | ≤ 0,20 | > 0,20 | herdado de `audio-validator.ts:15` |
| Vocal | transcrição fail-closed | sem fala confiante | ≥3 palavras confiantes | já implementado, `audio-validator.ts:214` |
| LUFS integrado | `ebur128` | −14 ± 1,0 | fora de −16..−12 | §C5, `ESTIMADO` |
| True peak | `ebur128` (dBTP) | ≤ −1,0 dBTP | > −1,0 dBTP | §C4 |
| Clipping | contagem de amostras consecutivas em fundo de escala | 0 | > 0 | `ESTIMADO` |
| BPM medido × pedido | detector no **áudio** | ±3 | > ±5 | §C7 |
| Tonalidade | detector + confiança | conf ≥ 0,6 | conf < 0,4 | `ESTIMADO` |
| Repetição | entropia (§C10) | 0,42–0,82 | < 0,30 | §C10, `ESTIMADO` |

### 13.3 Embeddings e similaridade

- **Um** modelo de embedding para referência, catálogo e candidata — comparação entre modelos
  diferentes não tem significado. `modelId` + `revision` do embedder vão no manifesto, e **um
  threshold só é válido para o par (modelo, revisão) que o produziu**.
- Escala e bandas: exatamente C1. Similaridade de cosseno, três bandas, sem lacuna.
- Índice de vizinho mais próximo sobre catálogo **publicado + aprovado desta campanha** — senão
  duas candidatas do mesmo lote passam ambas por não se verem.
- `pgvector` é o destino natural (o Postgres já está no stack). PR próprio; até lá, índice em
  processo. `HIPÓTESE`.

### 13.4 Fingerprint e dedupe

Dois mecanismos, papéis distintos (§C8):

1. **Digest exato** (`sha256`) — já existe para `MusicGeneration` (`worker.ts:124`). Pega
   bit-identidade. Barato, mantém.
2. **Fingerprint acústico** — detector de **duplicata/vazamento**: a candidata é, na prática, a
   mesma gravação de algo conhecido. **Não** é detector de plágio melódico, e o documento não deve
   prometer que é.

**Dedupe determinístico** — `QUALITY-PROCESS §9` diz "para cada par sinalizado, mantenha o de
maior `qualityScore`", o que é **dependente de ordem** e pode cascatear (A remove B, mas B teria
removido C, que agora sobrevive). Correção:

```
1. construir grafo: aresta entre candidatas com similaridade ≥ limiar de reprova (C1)
2. para cada componente conexa:
     ordenar por (qualityScore desc, candidateKey asc)   # desempate determinístico
     manter o primeiro; arquivar o resto com motivo "dedupe:<key do mantido>"
```

Componente conexa + desempate por chave torna o resultado **independente da ordem de
processamento** e reproduzível.

### 13.5 Bloqueio de nomes — lacuna real de código

`QUALITY-PROCESS §12.1` pressupõe um `BANNED_TOKENS`. `prompt-policy.ts` tem
`IMITATION_PATTERNS`, `VOCAL_PATTERNS` e `UNSAFE_PATTERNS` — e **nenhuma lista de nomes de
artista, banda, música, álbum ou gravadora**. Hoje "faça algo como Nujabes" é barrado pelo padrão
`no estilo de`/`sounds like`; **"Nujabes" sozinho passa**. Para a campanha (onde o style card é
gerado por ferramenta, e não digitado por um humano que se autocensura) isso é gate faltando.

Proposta: lista versionada, mantida em dado e não em código, aplicada a prompt **e** style card
**e** título, com normalização (minúsculas, sem acento, sem separador) para não ser burlada por
grafia. Bloqueio é *fail-closed*: lista indisponível ⇒ nada gera. `HIPÓTESE` na forma.

### 13.6 Escuta humana

Mantém a estratégia de amostragem de `QUALITY-PROCESS §8` com quatro emendas:

1. **Escuta cega.** O ouvinte não vê style card, prompt, `qualityScore` nem se a faixa é local ou
   de API. Sem cegamento, a nota mede a expectativa.
2. **Controles no lote.** Cada sessão inclui faixas-âncora (D8) e ao menos uma reprovada
   conhecida. Sessão em que o controle passa é sessão descartada — é o único jeito de saber se a
   escuta está calibrada.
3. **Nota vira `humanRating01`** normalizada (C2), e ausência de escuta é `0,5` neutro, nunca
   bônus.
4. **Amostragem estratificada** por style card e por banda de score, com 100 % de escuta na
   primeira leva de cada card novo, 100 % de tudo que foi sinalizado, e auditoria aleatória sobre
   auto-aprovadas. Percentuais: `ESTIMADO`.

### 13.7 Calibração (por que os números são `ESTIMADO`)

Um limiar de similaridade só significa algo contra uma distribuição. O procedimento da onda 2:

1. gerar as 50 candidatas do piloto (§14) e medir **tudo**, sem reprovar por similaridade;
2. plotar a distribuição de cada métrica;
3. escolher o corte por percentil + inspeção humana dos casos de fronteira, não por número
   redondo;
4. registrar limiar **com** o par (modelo, revisão) do embedder e o `styleCardVersion`;
5. reavaliar ao trocar qualquer um dos dois — trocar o embedder **invalida** os limiares.

---

## 14. Ondas

| Onda | Nome | Unidade | Escopo | Saída | Publica? |
| --- | --- | --- | --- | --- | --- |
| **1** | Spike | execuções | §11 | `RTF` medido, tetos, go/no-go | ❌ |
| **2** | Piloto | **50 gerações** | 5 style cards × ~10 candidatas; **100 % de escuta**; sem reprovar por similaridade (§13.7) | limiares calibrados, `PILOT_REPORT.md` | ❌ |
| **3** | Lote inicial | ~200 gerações | pipeline completo com limiares calibrados | rendimento real `1/k` medido | ❌ até revisão |
| **4** | Campanha | `N_c` de §10.3 | 900–2000 candidatas | 300–400 aprovadas | ❌ (gera; publicação é onda 5) |
| **5** | Publicação progressiva | faixas | promoção em tranches | catálogo crescente | ✅ **gated** |
| **6** | Feedback de ouvintes | — | sinal real de rotação | recalibração | ✅ |

**Onda 2 é 50 gerações, não 50 faixas aprovadas** (§C9). Com o rendimento composto que
`QUALITY-PROCESS` implica (0,476, `DERIVADO`), 50 gerações rendem ~24 aprovadas. Prometer 50
aprovadas do piloto seria repetir o erro que C9 corrige.

**Publicação progressiva (onda 5):** tranches (por exemplo 25 faixas), com janela de observação
entre tranches, `Track.origin = 'generated_editorial'` (`schema.prisma:23`, já existe), respeitando
o limite de proporção de faixas geradas na rotação que
`docs/features/ai-original-music.md` já definiu. Tranche pode ser revertida despublicando as
`Track` daquela tranche — é o que D3 compra.

### 14.1 Stop conditions (param a campanha, não "sinalizam")

| Condição | Ação |
| --- | --- |
| Qualquer match de fingerprint contra gravação comercial conhecida | **halt total** + revisão humana antes de qualquer retomada |
| Aprovação automática < 20 % em 100 candidatas consecutivas | halt; o problema é upstream (prompt/modelo), não downstream |
| Reprovação humana > 30 % das que passaram os gates automáticos | halt; os gates estão calibrados errado |
| Dedupe arquivando > 25 % das aprovadas | halt; os style cards colapsaram |
| Vocal detectado em > 5 % | halt; o modo instrumental não está funcionando |
| Orçamento da campanha atingido | pausa automática (mecanismo de `service.ts:190`, com contador próprio, D9) |
| Máquina interativa degradada (R3) | drain imediato daquela capability |
| Qualquer dúvida de licença que apareça depois | **halt** — R7 não expira |

---

## 15. Direitos, privacidade e segurança

### 15.1 Licenças por artefato e por versão

Todo artefato carrega, no manifesto (§8.6): licença do **código** gerador, licença dos **pesos**,
`modelId` + `modelRevision`, e — para artefato de API — provedor, modelo e termos aplicáveis na
data.

Quatro afirmações que este RFC faz questão de deixar por escrito:

1. **Não existe garantia jurídica sobre o output — em nenhuma das rotas.** Para Lyria, `PÚBLICO`
   [36]: "Generated Output is Customer Data. As between Customer and Google, Google does not assert
   any ownership rights in any new intellectual property created in the Generated Output." — e o
   Pre-GA é fornecido **"AS IS"**, sem SLA e **sem indenização** [36]. Outputs semelhantes podem ser
   entregues a outros clientes [36]. Nada disso é promessa de copyright ou exclusividade.
   (O registro de serviços indenizados do Google [46] permanece como referência de proveniência
   2026-07-18, não reconferida; a cláusula Pre-GA de [36] já basta para a conclusão.)
2. **"Uso comercial permitido" não é a mesma coisa em cada rota, e a diferença é material:**

   | Rota | O que a fonte diz | O que isso **não** dá |
   | --- | --- | --- |
   | ACE-Step 1.5 (local) | "You can strictly use the generated music for **commercial purposes**." [8]; o card XL repete a permissão [9] | licença autônoma de outputs; cessão de titularidade; indenização. O README continua exigindo verificação de originalidade, disclosure de IA e permissão ao adaptar estilo protegido [1] |
   | DiffRhythm2 (local) | **nada** — não há termo de output; Apache-2.0 cobre código e pesos [16][22][23] | qualquer conclusão sobre output. Apache-2.0 não licencia outputs |
   | Lyria 3 Pro (API) | uso em produção/comercial autorizado no Preview [33]; output é Customer Data [36] | SLA, indenização, exclusividade [36] |
   | MiniMax (oficial / Replicate) | ownership do cliente preservada [40]; Replicate cede o que tiver, "subject to any Third Party Terms" [42] | independência de dois contratos empilhados [41][42] |

3. **Licença de código ≠ licença de pesos ≠ termos de output.** Verificar as três, sempre (§7.4).
   MusicGen é o caso demonstrativo: código MIT e pesos CC BY-NC 4.0 no mesmo repositório [43][44].
4. **Este RFC não é parecer jurídico.** Publicação comercial de catálogo gerado por IA precisa de
   revisão jurídica — o que `docs/features/ai-original-music.md:130` já registra. A afirmação do
   model card de ACE-Step **remove o bloqueador de licença de pesos** (§2.2) e **não** substitui
   essa revisão.

**Proveniência — e a assimetria entre as duas rotas.**

- **Lyria:** `PÚBLICO` [33][35] — a ficha Cloud marca watermark de áudio e C2PA como suportados
  [33], e a página oficial da DeepMind é explícita: "All of our tracks are imperceptibly
  watermarked with SynthID technology, allowing you to detect whether music has been created or
  edited using AI." [35]. Não há indicação de que seja opcional ou desligável: planejar assumindo
  watermark em **todo** output. Preservar o original é o que mantém isso verificável; é por isso
  que `worker.ts:142` guarda o `original.mp3` além do derivado, e a campanha faz o mesmo.
- **Modelos locais (ACE-Step 1.5, DiffRhythm2):** **nenhuma marca de proveniência documentada** nas
  fontes verificadas desta pesquisa. Tratar como **ausente até prova em contrário** — o que faz do
  manifesto (§8.6) a **única** proveniência da faixa local.

Isso é uma diferença material entre as rotas e tem duas consequências operacionais: (a) a
disclosure de faixa gerada localmente não pode se apoiar em watermark, só no manifesto; (b) perder
o manifesto de uma faixa local a torna anônima de forma irreversível (§18.3) — para uma faixa Lyria,
o watermark ainda responderia.

### 15.2 Referências e privacidade

§12.2, resumido: referência é local; áudio nunca sai; opt-in por artefato; default é não.
Irreversível se violado (§18.3).

### 15.3 Bloqueio de nomes

§13.5. Aplicado a prompt, style card e título. Fail-closed. Alinhado ao que as fontes dos
fornecedores exigem — filtros de recitação e semelhança vocal no próprio Lyria [33]; proibição
explícita de nome de artista/título/gravadora nos termos da ElevenLabs [50]; e pedido de
verificação de originalidade e de permissão ao adaptar estilo protegido nos READMEs dos dois
modelos locais [1][16] — e ao que `prompt-policy.ts` já começou.

Nota: para o caminho local **não há fornecedor filtrando nada**. Onde o Lyria aplica prompt
rewriter e filtros de recitação/semelhança vocal do lado dele [33], o ACE-Step apenas **pede** ao
usuário que verifique [1]. O gate de §13.5 deixa de ser redundância e passa a ser a única barreira
— mais uma razão para ser fail-closed.

### 15.4 Segurança do worker e dos logs

| Vetor | Mitigação |
| --- | --- |
| **Prompt injection** via style card/metadado/nome de arquivo de referência | Style card é JSON validado por schema, não texto livre concatenado. Metadado de referência é tratado como **dado**, nunca como instrução. Nome de arquivo nunca entra em prompt |
| **SSRF** | O control plane só fala com URLs de worker de uma **allowlist** de config. Nunca com URL vinda de payload, manifesto ou resposta de worker |
| **Path traversal** | Artefato é buscado por **id**, nunca por caminho (§8.3). No worker, todo caminho é resolvido e verificado como descendente de `LOFIGEN_STAGING_DIR` antes de qualquer I/O |
| **Autenticação do worker** | HMAC-SHA256 com timestamp + nonce anti-replay; loopback por default; Tailscale para cruzar máquinas; `0.0.0.0` nunca |
| **Escalada via worker** | O worker local **não** tem credencial de Postgres nem de R2 (§8.3). Comprometê-lo dá bytes, não publicação |
| **Logs** | Sem áudio, sem PII, sem segredo, sem caminho absoluto de `$HOME`. Prompt em log só como `promptHash`. Segue o que `service.ts:44` já faz com IP (HMAC, nunca claro) |
| **Segredos** | Chave HMAC por **arquivo**, `chmod 600`, fora de repo. Backup de config vai para o scratchpad da sessão, nunca para o lado do original (`*.bak-*` é gitignored e escaparia do `git status`) |

### 15.5 Retenção

| Dado | Retenção | Motivo |
| --- | --- | --- |
| WAV bruto de reprovada | até fim da campanha + 30 d | auditoria de calibração |
| WAV bruto de aprovada | permanente | reprocessar master sem regenerar |
| Master + streaming | permanente | é o catálogo |
| Manifesto | permanente | proveniência |
| Áudio de referência | permanente, **local** | R4 |
| Log de execução | 90 d | debug |
| Nota de escuta humana | permanente, pseudonimizada | calibração |

---

## 16. Custos, observabilidade, rollback, runbook

### 16.1 Custo de API — fórmula e cenários

```
C_api = N_c_api × preço_por_geração
```

Com `preço_por_geração = US$ 0,08` para Lyria 3 Pro — "$0.08 / 1 count", música completa ·
`PÚBLICO` [34]:

| `N_c` | Custo se **toda** a campanha for API | vs. `AI_MUSIC_MONTHLY_BUDGET_USD` default = 100 |
| --- | --- | --- |
| 900 | **US$ 72** | 72 % do orçamento mensal **inteiro** |
| 1200 | **US$ 96** | 96 % |
| 1500 | **US$ 120** | **estoura** |
| 2000 | **US$ 160** | **estoura** |

`DERIVADO`. Consequência que D9 existe para resolver: o gate de `service.ts:190` soma **todas** as
origens num único teto mensal. Sem orçamento separado, a campanha consome a cota dos ouvintes e o
estúdio fecha para eles — uma regressão de produto causada por uma tarefa de catálogo.

**Comparativo de referência, para dimensionar a alternativa hospedada** — `DERIVADO` sobre US$ 0,03
por arquivo de output no Replicate [41]: 900 → US$ 27; 1200 → US$ 36; 1500 → US$ 45; 2000 → US$ 60.
Mais barato que Lyria, e **não** é recomendação: o endpoint exige `lyrics` de 10–600 caracteres e
não expõe modo instrumental [41], o que colide de frente com R2 e com o gate de vocal
(`audio-validator.ts:215`). Fica registrado como número de comparação, não como rota disponível.
Preço oficial MiniMax para o 1.5: **N/D** — omitido da tabela atual [39], acesso novo encerrado
[38].

### 16.2 Custo local

```
C_local ≈ (P_média_W × T_gen_h / 1000) × preço_kWh   +   custo de operação humana
```

`P_média_W` é `TBD` (§11.3, e `null` quando `powermetrics` não estiver disponível, §11.5).
`T_gen_h` vem de (4) e depende de `RTF`, também `TBD`. **Não há número aqui**, e o comparativo
local × API de §2.3 só fecha depois da onda 1. O que se pode afirmar estruturalmente: o custo
local é **marginal por hora de máquina**, não por faixa, então ele melhora com `k` alto enquanto o
custo de API piora linearmente.

### 16.3 Armazenamento

§8.8. `DERIVADO`: R2 cresce de ~3,9 GB (900 MP3) a ~103,7 GB (2000 WAV brutos) conforme a política
de retenção de §15.5.

### 16.4 Observabilidade e SLOs

| Métrica | Alvo | Etiqueta |
| --- | --- | --- |
| Candidatas geradas por noite | ≥ meta da onda | `TBD` até `RTF` |
| Taxa de aprovação automática | tendência estável, sem queda >10 pp entre lotes | `ESTIMADO` |
| Rendimento real `1/k` | dentro de ±20 % do `k` planejado | `ESTIMADO` |
| Candidatas órfãs (lease vencido) | < 1 % | `ESTIMADO` |
| Falha de upload no R2 | 0 sem retentativa bem-sucedida | — |
| Erro de alocação de memória | 0 depois do auto-tuning fixar `B` | — |
| Gasto da campanha | ≤ `AI_MUSIC_CAMPAIGN_BUDGET_USD` | hard gate |
| Faixas publicadas × aprovadas | publicadas ≤ aprovadas, sempre | invariante, não meta |

O último é um **invariante**: se publicadas > aprovadas, o publish gate falhou e é incidente.

### 16.5 Kill switch

Três níveis, do mais barato ao mais completo:

1. **Flag** — `AI_MUSIC_CAMPAIGN_ENABLED=false`: para o planejamento. Efeito imediato, sem deploy.
2. **Drain** — `POST /v1/admin/drain`: para a geração, preserva o que está em curso.
3. **Pause de fila** — `Queue.pause()` por capability: para o consumo sem perder job.

Nenhum deles despublica nada. Reverter publicação é a ação separada de §14 (tranche), de propósito
— misturar "pare de gerar" com "tire do ar" produz o botão que ninguém aperta na hora certa.

### 16.6 Runbook

| Sintoma | Diagnóstico | Ação |
| --- | --- | --- |
| Fila cresce, nada gera | `/v1/health` nos dois Macs | destravar worker; verificar `protocolVersion` e `modelRevision` |
| Candidatas presas em `claimed` | lease vencido | reaper devolve a `planned`; investigar por que o heartbeat parou |
| Aprovação automática caiu | por style card e por gate | se concentrada num gate, é calibração; se espalhada, é modelo/revisão |
| Erro de alocação | log do worker | reduzir `B` pela metade, refixar teto, reenfileirar |
| Disco de staging cheio | `/v1/health` | forçar upload+prune; pausar capability |
| Orçamento estourando | contador da campanha | pausar fila `music-gen:api` |
| Máquina interativa lenta | R3 | drain do M5; investigar duty-cycle |
| Match de fingerprint | manifesto da candidata | **halt total** (§14.1); revisão humana |
| Vocal em muitas candidatas | taxa por style card | halt; revisar prompt e modo instrumental |

---

## 17. Plano de implementação (PRs pequenos)

Nenhum destes PRs é aberto por este RFC. Cada um tem *acceptance* (observável) e *verification*
(comando).

| PR | Escopo | Acceptance | Verification |
| --- | --- | --- | --- |
| **Concluído neste RFC** | Corrigir no `docs/QUALITY-PROCESS.md` os achados do review: C1 semântica de similaridade, C2 gates não compensáveis, provider MusicGen incompatível, duração alinhada ao validador, capacidade por rendimento e dedupe determinístico | Playbook não inverte proximidade, não permite score compensar gate, não recomenda pesos NC e não contradiz os invariantes operacionais do RFC | duas rodadas de review Codex + `git diff --check` |
| **PR-1** | `lofigen-server` esqueleto: `/v1/health`, `/v1/capabilities`, HMAC, **sem modelo**. Resolve Q14 (adaptar `acestep-api` na 8001 vs reimplementar) e Q15 (variável de isolamento de cache, L2/§9.10) lendo o snapshot pinado | Servidor sobe; health responde com `device`/`lmBackend`/`vaeChunk`; requisição sem assinatura é rejeitada | testes do servidor |
| **PR-2** | `LocalMusicProvider` implementando `MusicGenerationProvider`; aceitar `provider = 'local'` em `provider.ts:11` | Provider registrado atrás de flag; caminho Lyria intocado | `npm run lint && npm run typecheck && npm test` |
| **PR-3** | Migration aditiva: `Campaign`, `StyleCard`, `Candidate`, `ReferenceProfile` | `migrate dev` sobe e reverte; nenhuma tabela existente alterada | `npx prisma generate` + `npm run typecheck` |
| **PR-4** | `candidateKey` + canonical JSON + testes de idempotência | Mesma entrada ⇒ mesma chave; ordem de campo irrelevante; revisão diferente ⇒ chave diferente | testes unitários |
| **PR-5** | Filas por capability + lease/heartbeat + reaper | Lease vence ⇒ candidata volta a `planned`; reenfileirar é no-op | testes de integração com Redis |
| **PR-6** | Benchmark harness do spike (§11.3) + schema de manifesto de evidência; opcionalmente invoca `profile_inference.py` e anexa `results.json` como evidência auxiliar | Harness roda a matriz **do Lofiever** (150/180/184 s, `B` 1/2/4, warmup + 3 repetições) e emite manifesto válido com repetições individuais | executar em `B=1` |
| **PR-7** | Análise: LUFS/TP corretos (C4/C5), silêncio cabeça/cauda (C6), BPM/key medidos (C7) | Medições no manifesto com ferramenta+versão+unidade | testes com fixtures de áudio |
| **PR-8** | Embeddings + similaridade com bandas de C1 | Similaridade computada e bandada; limiar versionado com o embedder | testes |
| **PR-9** | Fingerprint + dedupe determinístico por componente conexa | Mesmo conjunto ⇒ mesmo resultado, independente da ordem | teste de permutação |
| **PR-10** | Lista de tokens banidos (§13.5) aplicada a prompt/card/título, fail-closed | Nome de artista é bloqueado; lista ausente ⇒ nada gera | testes, estendendo `prompt-policy.test.ts` |
| **PR-11** | Masterização 2 passadas + **revalidação pós-master** | Master dentro da banda de LUFS/TP, verificado após | testes |
| **PR-12** | UI/CLI de escuta cega com controles | Ouvinte não vê metadado; sessão com controle reprovado é descartada | revisão humana |
| **PR-13** | Publish gate + promoção `Candidate → Track` + reversão de tranche | Nenhuma `Track` sem promoção explícita; tranche revertível | testes de integração |
| **PR-14** | Orçamento separado da campanha (D9) + kill switch 3 níveis | Campanha não consome o teto dos usuários; flag para tudo | testes |
| **PR-15** | Observabilidade de §16.4 + runbook | Métricas expostas; invariante publicadas ≤ aprovadas alarmado | revisão |
| **PR-16** | Unificar o custo por tentativa (§3.2/P7) numa única fonte | Preço em um lugar só | `npm run typecheck` |

Cada PR fecha com `npm run lint && npm run typecheck && npm test` (e `npx prisma generate` antes,
quando tocar schema), conforme `CLAUDE.md`.

---

## 18. Riscos, open questions, reversibilidade

### 18.1 Riscos

| # | Risco | Impacto | Mitigação |
| --- | --- | --- | --- |
| K1 | ~~Licença dos pesos incompatível com uso comercial~~ → **residual:** a afirmação de uso comercial de ACE-Step vive num model card [8][9], não numa licença de output; uma mudança de card ou uma leitura jurídica adversa reabre o tema | Campanha local inviável | Gate 1 de §2.3 **respondido** (§11.1). Residual: registrar no manifesto o card e a revisão que sustentam a permissão (§19.1); revisão jurídica antes de publicação comercial (§15.1) |
| K2 | Nenhum modelo local **entrega performance** em Apple Silicon (o *suporte* já é `PÚBLICO` [3][6]; a *performance* é `TBD`) | Idem | Spike decide; fallback API já funciona |
| K2b | Pressão de memória específica de ACE-Step: Autoscore + XL + LM 4B, com issue fechada por inatividade [12] e correção aberta [13] | Batches perdidos, ou variante XL indisponível no M4 Pro | Combinação **excluída** da matriz do spike (§11.2); `ACESTEP_MLX_VAE_CHUNK` como botão oficial [11]; reduzir `B` como mitigação primária (§10.4) |
| K3 | `RTF` tão alto que a campanha não cabe na janela | Prazo | Fórmulas de §10 tornam isso visível na onda 1, não na onda 4 |
| K4 | Pressão de memória unificada abortando batches | Desperdício | `B=1` inicial; auto-tuning só sobe com `η≥0,75`; reduzir `B` é a mitigação primária |
| K5 | Similaridade alta demais contra referência (style cards literais) | Risco jurídico | Bandas de C1; força de referência baixa ou nenhuma; escuta cega |
| K6 | Colapso de diversidade (todo card soa igual) | Catálogo ruim | Dedupe determinístico + cobertura por card + stop condition |
| K7 | Campanha degrada a máquina do dono | R3 | Janela noturna, duty-cycle, drain por atividade |
| K8 | Publicação acidental em massa | Reputação | D3, e o invariante de §16.4 alarmado |
| K9 | Lyria é Pre-GA: "AS IS", sem SLA nem indenização, e "may be changed, suspended or discontinued at any time" · `PÚBLICO` [33][36] | Fallback quebra | Fronteira de provider já isola; monitorar GA |
| K10 | Thresholds calibrados no piloto não generalizam | Rendimento cai na escala | Recalibrar por onda; stop conditions de §14.1 |
| K11 | ~~Este RFC ser aprovado com §7/§9 não verificadas~~ → **fechado**: a pesquisa obrigatória está completa (§0.2) e §20.2 é registro, não backlog | — | Substituído por K12 |
| K12 | **Este RFC ser aprovado como se a onda 1 tivesse acontecido.** A pesquisa fechou; a medição não. Um leitor apressado pode ler §9 (receita exata, citada) como "já instalado" | Compromisso de prazo/custo sobre `RTF` inexistente | Avisos no cabeçalho, em §0.2, no topo de §9 e em §11; `MEDIDO` vazio em todo o documento; `null` explícito em §19.2 |
| K13 | Dependência de fornecedor de host para o comparativo (Replicate), que pode descontinuar o modelo · `PÚBLICO` [42] | Perde o comparativo de custo | Comparativo não é caminho de produção (D11); a decisão de §2.3 não depende dele |

### 18.2 Open questions

**Fechadas por esta passagem** (§0.2), e registradas aqui para que ninguém as reabra por hábito:

| # | Pergunta original | Resposta |
| --- | --- | --- |
| ~~Q1~~ | ACE-Step 1.5 existe, roda em Apple Silicon, e sua licença de pesos permite uso comercial? | **Sim, sim (na documentação) e sim (afirmado em card).** MPS + MLX oficiais [3][6]; código MIT [7]; pesos MIT e uso comercial dos outputs afirmado [8][9]. Ressalva de §7.3 |
| ~~Q2~~ | Mesmas perguntas para DiffRhythm2 | **Existe, Apache-2.0 código+pesos [16][22][23], mas não roda acelerado no Mac** — `cuda if available else cpu` [17]. Sem instrumental-only [16]. Vira challenger de pesquisa (D10) |
| ~~Q3~~ | Preço/limites/termos da API **oficial** da MiniMax, separados de host de terceiro | **Respondido, e é um não:** 1.5 ausente do catálogo/preço atuais [38][39]; novos usuários bloqueados desde 2026-08-20 [38]. Replicate separado em §7.6.2 [41][42] |
| ~~Q4~~ | Licença dos pesos do MusicGen | **CC BY-NC 4.0** [43][44] → descarte (D12) |
| ~~Q10~~ | Existe marca de proveniência em output de modelo local? | **Nenhuma documentada** nas fontes verificadas → tratar como ausente; o manifesto é a única proveniência (§15.1) |

**Abertas:**

| # | Pergunta | Bloqueia | Resolve em |
| --- | --- | --- | --- |
| Q5 | `k` = 3 ou 5? | `N_c`, prazo, custo | Onda 2 (rendimento real) |
| Q6 | `N_ap` = 300 ou 400? | Escopo | Decisão do dono, pós-onda 3 |
| Q7 | Qual modelo de embedding, em qual revisão? | Todo threshold de §13.3 | PR-8 (e lacuna L4 de §20.2 sobre licença do embedder) |
| Q8 | pgvector agora ou índice em processo? | Complexidade | PR-8 |
| Q9 | O modelo escolhido é determinístico por seed? | Se `seed` na chave de §8.5 significa algo | Onda 1 |
| Q11 | Referência de áudio entra na produção, ou só no spike? E com que `audio_cover_strength`? | §12.4 | Onda 2 |
| Q12 | Quem faz a escuta humana em escala de 900–2000? | Capacidade da onda 4 | Antes da onda 3 |
| Q13 | Qual variante de §9.5 (2B vs XL, LM 0.6B/1.7B/4B) por máquina? | `B`, memória, `RTF` | Onda 1 |
| Q14 | O `lofigen-server` adapta o `acestep-api` (§9.6) ou reimplementa a chamada? | PR-1/PR-2 | PR-1 |
| Q15 | Qual variável isola o cache de download (L2, §9.10)? | Uninstall completo de §9.15 | PR-1, lendo o snapshot pinado |

### 18.3 Reversível × irreversível

**Reversível** (baratas de desfazer): escolha do modelo local; `B`, concorrência, duty-cycle;
todos os thresholds; fila por capability; schema aditivo; publicação por tranche; setup local
inteiro (§9.15).

**Irreversível** (exigem decisão consciente antes):

| Ação | Por que não volta |
| --- | --- |
| **Enviar áudio de referência a uma API externa** | O dado saiu. Pode estar cacheado, indexado ou usado. Apagar depois não desfaz. **Default é nunca; opt-in por artefato** (D6/§12.2) |
| **Publicar faixa que gere reclamação de terceiro** | Despublicar não apaga o alcance. Por isso §14.1 é *halt*, não *warn* |
| **Vazar a chave HMAC do worker** | Exige rotação e auditoria de tudo que a chave assinou |
| **Perder o WAV bruto de uma aprovada** | Remasterizar exige regenerar, e regenerar pode não reproduzir (Q9). Daí a retenção permanente de §15.5 |
| **Descartar o manifesto** | A proveniência era a única prova; sem ela a faixa é anônima |

---

## 19. Apêndices

> Todo apêndice é **proposta**. Nenhum comando aqui foi executado. Nenhum segredo real aparece.
> Onde a ferramenta externa não foi verificada, o item diz `NÃO VERIFICADO`. Os comandos de
> terceiro verificados na fonte estão em §9 e §11, com citação; os deste apêndice são **nossos**.

### 19.1 Manifesto de candidata (schema proposto)

```json
{
  "schemaVersion": "1.0.0",
  "candidateKey": "<sha256 hex — §8.5>",
  "campaignId": "<uuid>",
  "styleCard": { "id": "<uuid>", "slug": "warm-vinyl-evening", "version": 1, "specHash": "<sha256>" },
  "generation": {
    "capability": "local-m5",
    "engine": "ace-step-1.5",
    "engineRepoCommit": "14c0211d5a0653b0f63e27686f4c3f151b4d8629",
    "modelId": "<variante de §9.5 — TBD, spike>",
    "modelRevision": "<commit ou tag imutável dos pesos>",
    "weightsDigest": "sha256:<...>",
    "device": "mps",
    "lmBackend": "mlx",
    "vaeChunk": null,
    "seed": 123456789,
    "paramsHash": "<sha256 do canonical json dos parâmetros>",
    "batchSizeRequested": 1,
    "batchSizeEffective": null,
    "instrumentalMode": "empty_lyrics_or_tag",
    "requestedDurationSeconds": 180,
    "serverCommit": "<git sha do lofigen-server>",
    "startedAt": "<ISO-8601 UTC>",
    "finishedAt": "<ISO-8601 UTC>",
    "wallTimeSeconds": null
  },
  "audio": {
    "rawSha256": "<...>", "rawObjectKey": "campaign/<id>/candidates/<key>/raw.wav",
    "masterSha256": null, "masterObjectKey": null,
    "actualDurationSeconds": 179.4, "sampleRate": 48000, "channels": 2
  },
  "measurements": [
    { "metric": "integrated_lufs", "value": -14.2, "unit": "LUFS", "tool": "ffmpeg/ebur128", "toolVersion": "<...>" },
    { "metric": "true_peak",       "value": -1.3,  "unit": "dBTP",  "tool": "ffmpeg/ebur128", "toolVersion": "<...>" },
    { "metric": "bpm_measured",    "value": 71.8,  "unit": "bpm",   "tool": "<TBD>", "confidence": 0.82 },
    { "metric": "silence_head",    "value": 0.4,   "unit": "s",     "tool": "<TBD>" },
    { "metric": "silence_tail",    "value": 1.1,   "unit": "s",     "tool": "<TBD>" },
    { "metric": "silence_ratio",   "value": 0.03,  "unit": "ratio", "tool": "ffmpeg/silencedetect" }
  ],
  "embedding": { "modelId": "<TBD>", "modelRevision": "<TBD>", "dim": 512, "vectorRef": "<key>" },
  "similarity": { "maxVsReference": 0.71, "maxVsCatalog": 0.66, "scale": "cosine_similarity", "bandVersion": "c1-v1" },
  "gates": {
    "decode": "pass", "duration": "pass", "silence": "pass", "vocal": "pass",
    "loudness": "pass", "truePeak": "pass", "bpm": "pass", "repetition": "pass",
    "fingerprint": "pass", "similarityReference": "pass", "similarityCatalog": "pass"
  },
  "qualityScore": 0.71,
  "humanReviews": [],
  "provenance": {
    "licenseCode": "MIT",
    "licenseCodeSource": "ace-step/ACE-Step-1.5@14c0211d/LICENSE",
    "licenseWeights": "MIT",
    "licenseWeightsSource": "<model card URL + revisão que declarou license: mit>",
    "outputTermsBasis": "model_card_statement",
    "outputTermsSource": "<model card URL + revisão que afirmou uso comercial>",
    "outputLicenseAutonomous": false,
    "legalReviewCompleted": false,
    "watermark": null,
    "references": [ { "referenceProfileId": "<uuid>", "contentSha256": "<...>", "strength": 0.0 } ]
  },
  "status": "generated",
  "notes": []
}
```

Invariantes: `gates` com valor `notRun` **conta como reprovado**; `qualityScore` é `null` se
qualquer gate não for `pass` (C2); nenhum caminho absoluto de `$HOME`; nenhum prompt em claro
(só hash); nenhum segredo.

Sobre o bloco `provenance`, e por que ele mudou de forma nesta passagem: o campo antigo
`commercialUseConfirmed: boolean` era uma **conclusão jurídica travestida de flag**. Foi trocado
por `outputTermsBasis` + `outputTermsSource` + `outputLicenseAutonomous`, que registram **em que a
permissão se apoia** e apontam para a revisão exata da fonte. Para ACE-Step 1.5, `PÚBLICO`: a base
é uma afirmação de model card [8][9], **não** uma licença autônoma de outputs (§7.3, §7.4) — e
`legalReviewCompleted` existe para que a ausência de parecer jurídico (§15.1) seja um dado do
artefato, não uma omissão.

O `vaeChunk`, o `batchSizeEffective` e o `lmBackend` são obrigatórios porque duas máquinas com
valores diferentes não produzem faixas comparáveis (§7.5, §9.13), e o runtime pode reduzir o batch
sozinho sem erro [15]. `null` neles significa **não capturado**, e conta como lacuna do manifesto,
não como zero.

### 19.2 Manifesto de execução do spike (schema proposto)

```json
{
  "schemaVersion": "1.0.0",
  "runId": "<uuid>",
  "host": { "machine": "m5max-128gb", "chip": "<sysctl -n machdep.cpu.brand_string>",
            "memoryBytes": 0, "osVersion": "<sw_vers -productVersion>" },
  "engine": { "name": "ace-step-1.5", "repoCommit": "14c0211d5a0653b0f63e27686f4c3f151b4d8629" },
  "model": { "id": "<TBD>", "revision": "<TBD>", "weightsDigest": "<TBD>",
             "device": "mps", "lmBackend": "mlx", "vaeChunk": null },
  "toolchain": { "python": "<TBD — 3.11.x ou 3.12.x, dentro de >=3.11,<3.13>",
                 "uv": "<uv --version>", "ffmpeg": "<ffmpeg -version>",
                 "serverCommit": "<git sha>" },
  "factors": { "durationSeconds": 180, "batchSizeRequested": 1, "batchSizeEffective": null,
               "referenceStrength": 0.0 },
  "vendorProfilerOutput": null,
  "warmup": { "discarded": true, "wallTimeSeconds": 0.0 },
  "repetitions": [
    { "index": 1, "wallTimeSeconds": 0.0, "audioDurationSeconds": 0.0, "rtfAmortized": null,
      "peakRssBytes": 0, "errors": [], "energy": null },
    { "index": 2, "wallTimeSeconds": 0.0, "audioDurationSeconds": 0.0, "rtfAmortized": null,
      "peakRssBytes": 0, "errors": [], "energy": null },
    { "index": 3, "wallTimeSeconds": 0.0, "audioDurationSeconds": 0.0, "rtfAmortized": null,
      "peakRssBytes": 0, "errors": [], "energy": null }
  ],
  "summary": { "rtfMean": null, "rtfStdDev": null, "allocationFailures": 0,
               "autoApprovalRate": null, "deterministicBySeed": null },
  "energyAvailable": false,
  "energyUnavailableReason": "powermetrics requires elevated privileges; not requested"
}
```

`rtfAmortized: null` e `rtfMean: null` são **o estado correto hoje**. Nenhuma medição existe.

### 19.3 `launchd` (opcional, `HIPÓTESE`)

Esqueleto proposto para o Mac Mini. `RunAtLoad=false` de propósito: subir sozinho no login é
comportamento de servidor, e o MacBook não é servidor (§9.14).

```xml
<!-- ~/Library/LaunchAgents/dev.lofiever.lofigen.plist — PROPOSTA, não instalado -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>              <string>dev.lofiever.lofigen</string>
  <key>ProgramArguments</key>   <array><string>/bin/sh</string>
                                       <string>-lc</string>
                                       <string>exec "$HOME/lofigen/server/run.sh"</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>LOFIGEN_ENV_FILE</key> <string>/Users/&lt;user&gt;/lofigen/lofigen.env</string>
  </dict>
  <key>RunAtLoad</key>          <false/>
  <key>KeepAlive</key>          <false/>
  <key>StandardOutPath</key>    <string>/Users/&lt;user&gt;/lofigen/logs/stdout.log</string>
  <key>StandardErrorPath</key>  <string>/Users/&lt;user&gt;/lofigen/logs/stderr.log</string>
  <key>ProcessType</key>        <string>Background</string>
  <key>Nice</key>               <integer>10</integer>
</dict>
</plist>
```

Nenhum segredo no plist — só o **caminho** do arquivo de env.

### 19.4 Pseudocomandos do harness

Verificados como padrão do repo (`audio-validator.ts` já os usa em produção): `ffprobe -v error
-show_entries format=duration:stream=codec_name,codec_type,sample_rate,channels -of json <file>`
e `ffmpeg -hide_banner -i <file> -af silencedetect=noise=-50dB:d=4 -f null -`.

`NÃO VERIFICADO` (lacuna residual L5, §20.2; a confirmar no PR-6/PR-7 contra a documentação do
ffmpeg da versão instalada, antes de escrever no harness): a invocação exata para obter **LUFS
integrado e true peak em dBTP** — a família `ebur128`/`loudnorm` do ffmpeg fornece essas grandezas,
mas o conjunto exato de flags e o formato de saída variam por versão e **não foram conferidos**.
C4/C5 dependem disso, e o harness deve *falhar* se não conseguir extrair as duas grandezas, em vez
de cair para o `volumedetect` (que é pico de amostra, §C4).

Também `NÃO VERIFICADO`, e por isso `<TBD>` no schema de §19.1: a ferramenta de BPM/tonalidade
(C7), a de embedding (§13.3, com a licença a conferir — L4) e a de fingerprint (§13.4). Nenhuma é
nomeada como decidida aqui.

Comandos **verificados na fonte** para o ACE-Step estão em §9.4, §9.6 e §9.11, com citação. Este
apêndice não os repete para não criar uma segunda cópia que possa divergir.

### 19.5 Memória unificada — conhecimento marcado, não passo

Duas receitas que circulam e que este RFC **registra para recusar**, de propósito — para que
ninguém as "descubra" no meio de um incidente e as aplique sem avaliação:

1. **`sysctl` para elevar o limite de memória *wired* da GPU no macOS.** `NÃO VERIFICADO`, **exige
   `sudo`**, altera comportamento do sistema, **não é passo obrigatório de nenhuma seção**.
2. **`PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0`.** `NÃO VERIFICADO` quanto ao efeito na versão de
   PyTorch que o `uv sync` instalar, e **não recomendado como solução universal** (§7.5): não
   aparece como mitigação oficial em nenhuma das fontes verificadas do ACE-Step [10][11][12][13].
   Remover o teto de um alocador não reduz a demanda que causou a pressão.

**Alternativas seguras, e as que este RFC adota** (§10.4): reduzir `B` (§10.6) e, para o VAE MLX,
reduzir `ACESTEP_MLX_VAE_CHUNK` — que é o botão **oficial**, com default automático por memória
unificada [11]. Nenhuma das duas exige privilégio nem altera o sistema, e o custo é tempo — que
§10 já modela.

### 19.6 Uninstall / rollback (referência rápida)

§9.15. Resumo: duas flags para `false` → `drain` nos dois Macs → parar `acestep-api`/`lofigen-server`
pelo pid → descarregar `LaunchAgent` se existir → `rm -rf ~/lofigen/` → revogar chave HMAC →
reverter migration aditiva. Nenhuma `Track` publicada é afetada. **Não testado** (§11.6), e o passo
`rm -rf` carrega a ressalva de cache de §9.10 (L2).

---

## 20. Fontes

### 20.1 Citações usadas neste RFC

**Regra de citação deste RFC.** Fonte primária oficial apenas: repositório oficial, model card
oficial, documentação/preço do fornecedor, arquivo de licença, paper. Para repositório e model
card, **link permanente** de commit/revisão — nunca `main`, que muda sem avisar. Nenhum snippet de
busca, blog de terceiro, nem host de hospedagem no lugar do fornecedor.

**Duas camadas de proveniência**, e a diferença está no número (§0.1):

- **`[1]`–`[44]`: verificadas em 2026-08-22**, nesta passagem, contra a fonte primária.
- **`[45]`–`[50]`: transcritas de `docs/research/ai-music-generation-providers.md`**, consulta de
  **2026-07-18**, e **não reconferidas**. Onde uma delas é a única evidência, o texto diz
  `PÚBLICO (2026-07-18, não reconferido)`.

#### ACE-Step 1.5 — snapshot de código `14c0211d5a0653b0f63e27686f4c3f151b4d8629`

| # | Título | URL | Sustenta |
| --- | --- | --- | --- |
| [1] | ACE-Step 1.5 — README (variantes DiT/LM; "Generate up to 8 songs simultaneously"; "~9GB VRAM for weights" do XL; pedido de verificação de originalidade e disclosure) | https://github.com/ace-step/ACE-Step-1.5/blob/14c0211d5a0653b0f63e27686f4c3f151b4d8629/README.md | §5/R1, §7.2, §7.2.1, §7.4, §9.5, §11.3, §15.1, §15.3 |
| [2] | ACE-Step 1.5 — `pyproject.toml` (`requires-python = ">=3.11,<3.13"`; `mlx>=0.25.2`, `mlx-lm>=0.20.0` em `darwin/arm64`; entry points `acestep` e `acestep-api`) | https://github.com/ace-step/ACE-Step-1.5/blob/14c0211d5a0653b0f63e27686f4c3f151b4d8629/pyproject.toml | §2.3, §7.2, §7.3, §9.1, §9.4, §9.6 |
| [3] | ACE-Step 1.5 — Installation Guide ("macOS scripts use the **MLX backend** for native Apple Silicon acceleration (M1/M2/M3/M4)"; `uv sync`; `uv run acestep-api`; `start_api_server_macos.sh`; `ACESTEP_LM_BACKEND=mlx` / `--backend mlx`) | https://github.com/ace-step/ACE-Step-1.5/blob/14c0211d5a0653b0f63e27686f4c3f151b4d8629/docs/en/INSTALL.md | §2.1/D7, §2.3, §7.2, §7.3, §9.1, §9.4, §9.6, §11.1, K2 |
| [4] | ACE-Step 1.5 — API Client Documentation (`batch_size` default 2, "max 8"; `reference_audio_path` / `ref_audio`; `src_audio`; `audio_cover_strength` 0–1 default 1.0, "Lower values (0.2) for style transfer") | https://github.com/ace-step/ACE-Step-1.5/blob/14c0211d5a0653b0f63e27686f4c3f151b4d8629/docs/en/API.md | §2.3, §7.2, §9.7, §9.9, §12.4 |
| [5] | ACE-Step 1.5 — Inference API Documentation (`GenerationParams.instrumental`; `reference_audio`; `src_audio_path`; `audio_cover_strength`) | https://github.com/ace-step/ACE-Step-1.5/blob/14c0211d5a0653b0f63e27686f4c3f151b4d8629/docs/en/INFERENCE.md | §2.3, §7.2, §9.8, §9.9, §12.4 |
| [6] | ACE-Step 1.5 — Benchmark & Profiling Guide (modos `profile`/`benchmark`/`tier-test`/`understand`/`create_sample`/`format_sample`; `--device mps --lm-backend mlx`; matriz default 30/60/120/240 s, batch 1/2/4, `thinking`, 8/16 steps; `--instrumental` em `create_sample`) | https://github.com/ace-step/ACE-Step-1.5/blob/14c0211d5a0653b0f63e27686f4c3f151b4d8629/docs/en/BENCHMARK.md | §2.3, §6/C3, §7.2, §7.3, §9.6, §9.11, §11.1, §11.2, §11.3, K2 |
| [7] | ACE-Step 1.5 — MIT License (código) | https://github.com/ace-step/ACE-Step-1.5/blob/14c0211d5a0653b0f63e27686f4c3f151b4d8629/LICENSE | §2.1/D7, §2.3, §7.1, §7.3, §7.4, §11.1, §19.1 |
| [8] | ACE-Step 1.5 — Model Card (`license: mit`; "You can strictly use the generated music for **commercial purposes**.") | https://huggingface.co/ACE-Step/Ace-Step1.5/blob/19671f406d603126926c1b7e2adc169acbcade22/README.md | §2.1/D7, §2.2, §2.3, §7.1, §7.3, §7.4, §11.1, §15.1, §19.1, K1 |
| [9] | ACE-Step 1.5 XL Turbo — Model Card ("Total params \| ~4B"; "Weights size (bf16) \| ~18.8 GB"; uso comercial do output) | https://huggingface.co/ACE-Step/acestep-v15-xl-turbo/blob/d4a0b288b83ebb7e25a8c0b32c573c22e134e8ee/README.md | §2.1/D7, §2.3, §7.2, §7.2.1, §7.4, §9.3, §9.5, §15.1, K1 |
| [10] | ACE-Step — PR #1042, *reduce MLX VAE decode chunk size* (**mesclada**; chunk 2048→512 + `mx.clear_cache()`; "cutting peak GPU memory by ~56% on unified-memory Macs"; benchmark em M4 Pro 48 GB / 600 s: pico 31,08→13,44 GB, VAE 68→78 s, output byte-a-byte idêntico) | https://github.com/ace-step/ACE-Step-1.5/pull/1042 | §0.1, §7.2, §7.5, §10.4, §19.5 |
| [11] | ACE-Step — PR #1059, *configurable MLX VAE chunk size* (**mesclada**; chunk automático ≤16→256, ≤36→512, ≤64→1024, >64→2048; override `ACESTEP_MLX_VAE_CHUNK`) | https://github.com/ace-step/ACE-Step-1.5/pull/1059 | §7.2, §7.5, §9.10, §10.4, §19.5, K2b |
| [12] | ACE-Step — Issue #1081, *Autoscore on macOS MLX drains memory* (**fechada por inatividade, não por correção**) | https://github.com/ace-step/ACE-Step-1.5/issues/1081 | §7.2, §7.5, §9.5, §10.4, §11.2, §19.5, K2b |
| [13] | ACE-Step — PR #1097, correção proposta para a segunda cópia PyTorch do LM 4B (~8 GB) (**aberta, não mesclada**) | https://github.com/ace-step/ACE-Step-1.5/pull/1097 | §7.2, §7.5, §9.5, §10.4, §11.2, §19.5, K2b |
| [14] | ACE-Step 1.5 — utilitários do servidor de API (classificação de instrumental por `lyrics` vazio ou `[inst]`/`[instrumental]`; **`/release_task` não expõe booleano `instrumental`**) | https://github.com/ace-step/ACE-Step-1.5/blob/14c0211d5a0653b0f63e27686f4c3f151b4d8629/acestep/api/server_utils.py | §2.3, §7.2, §9.8 |
| [15] | ACE-Step 1.5 — GPU Compatibility Guide (VRAM guard; o runtime pode reduzir o batch por memória) | https://github.com/ace-step/ACE-Step-1.5/blob/14c0211d5a0653b0f63e27686f4c3f151b4d8629/docs/en/GPU_COMPATIBILITY.md | §7.2, §9.7, §11.3, §19.1 |

#### DiffRhythm2 — snapshot de código `7804f821b797b4f276090e1a9dcd37e97d9915d5`

| # | Título | URL | Sustenta |
| --- | --- | --- | --- |
| [16] | DiffRhythm2 — README ("DiffRhythm 2 (code and weights) is released under the Apache License 2.0"; instrumental-only e song extension como **TODO**; `brew install espeak-ng`; launcher simples apresentado como Linux) | https://github.com/ASLP-lab/DiffRhythm2/blob/7804f821b797b4f276090e1a9dcd37e97d9915d5/README.md | §2.1/D10, §2.3, §5/R1, §7.1, §7.2, §7.4, §11.1, §15.3 |
| [17] | DiffRhythm2 — `inference.py` (device = `cuda if available else cpu`; `--max-secs` default 210.0; laço sequencial `for i in tqdm(...)`; `style_prompt` áudio/texto com corte aleatório de 10 s; `decode_audio(overlap=5, chunk_size=20)`) | https://github.com/ASLP-lab/DiffRhythm2/blob/7804f821b797b4f276090e1a9dcd37e97d9915d5/inference.py | §2.1/D10, §2.3, §7.1, §7.2, §11.1, §18.2 |
| [18] | DiffRhythm2 — `inference.sh` (launcher oficial) | https://github.com/ASLP-lab/DiffRhythm2/blob/7804f821b797b4f276090e1a9dcd37e97d9915d5/inference.sh | §7.2 |
| [19] | DiffRhythm2 — `requirements.txt` (`torch==2.7`, `torchaudio==2.7`, `transformers==4.47.1`, `muq==0.1.0`) | https://github.com/ASLP-lab/DiffRhythm2/blob/7804f821b797b4f276090e1a9dcd37e97d9915d5/requirements.txt | §7.2 |
| [20] | DiffRhythm2 — exemplo de JSONL de batch (`lyrics`, `style_prompt`, `song_name`) | https://github.com/ASLP-lab/DiffRhythm2/blob/7804f821b797b4f276090e1a9dcd37e97d9915d5/example/test.jsonl | §2.3, §7.2 |
| [21] | DiffRhythm2 — código do decoder (chunking interno) | https://github.com/ASLP-lab/DiffRhythm2/blob/7804f821b797b4f276090e1a9dcd37e97d9915d5/bigvgan/model.py | §7.2 |
| [22] | DiffRhythm2 — Apache-2.0 LICENSE (código) | https://github.com/ASLP-lab/DiffRhythm2/blob/7804f821b797b4f276090e1a9dcd37e97d9915d5/LICENSE | §2.1/D10, §2.3, §7.1, §7.2, §7.4, §11.1, §18.2 |
| [23] | DiffRhythm2 — model card (`license: apache-2.0`; sem termo autônomo de output) | https://huggingface.co/ASLP-lab/DiffRhythm2/blob/9aa15742e4889c0eb2e198db6fdab1facf1b6761/README.md | §2.3, §7.1, §7.2, §7.4, §11.1, §18.2 |
| [24] | DiffRhythm2 — arquivos do repositório de modelo (decoder e DiT; **encoder do Music VAE não nomeado**) | https://huggingface.co/ASLP-lab/DiffRhythm2/tree/9aa15742e4889c0eb2e198db6fdab1facf1b6761 | §7.2 |
| [25] | DiffRhythm 2 — paper arXiv v3 ("can generate complete songs up to 210 seconds in length"; VAE a 5 Hz; "The low-frame-rate VAE imposes an upper bound on the fidelity of reconstructed audio, making it difficult to match real audio quality") | https://arxiv.org/abs/2510.22950v3 | §2.3, §6/C3, §7.1, §7.2 |
| [26] | DiffRhythm 2 — página oficial do projeto | https://aslp-lab.github.io/DiffRhythm2.github.io | §7.2 (contexto de fonte oficial) |
| [27] | DiffRhythm2 — Space oficial, `app.py` (chamada com `duration=240`, acima dos 210 s publicados; "Reference audio should be ≥ 1 second, Audio >10 seconds will be randomly clipped into 10 seconds"; apenas chinês e inglês; "Due to issues with Gradio's streaming audio output, we will update the streaming feature in the future.") | https://huggingface.co/spaces/ASLP-lab/DiffRhythm2/blob/0563fcec4bdf42ca33f6e76ebe9949429d07bf00/app.py | §2.3, §7.2 |
| [28] | DiffRhythm2 — Space oficial, `utils.py` (`inference_stream()` com o caminho gerador comentado) | https://huggingface.co/spaces/ASLP-lab/DiffRhythm2/blob/0563fcec4bdf42ca33f6e76ebe9949429d07bf00/diffrhythm2/utils.py | §7.2 |
| [29] | DiffRhythm2 — schema ao vivo da API Gradio do Space (endpoint `/infer_music`, `batch:false`) | https://aslp-lab-diffrhythm2.hf.space/gradio_api/info | §2.3, §7.2 |
| [30] | DiffRhythm2 — issue #5, *mat1 and mat2 must have the same dtype* (**aberta**, sem resposta de maintainer) | https://github.com/xiaomi-research/diffrhythm2/issues/5 | §7.2 |
| [31] | DiffRhythm2 — issue #7, *espeak not installed on your system* (**aberta**) | https://github.com/xiaomi-research/diffrhythm2/issues/7 | §7.2 |
| [32] | DiffRhythm2 — issue #11, *Access to Music VAE* (encoder ausente dos checkpoints; **aberta**) | https://github.com/xiaomi-research/diffrhythm2/issues/11 | §7.2 |

#### APIs — Google Lyria, MiniMax, Replicate, Meta

| # | Título | URL | Sustenta |
| --- | --- | --- | --- |
| [33] | Lyria 3 — página do modelo, Gemini Enterprise Agent Platform ("Maximum audio clip length: 184 seconds"; texto/imagem "Input only", áudio "Output only"; "Instrumental mode — Supported"; MP3 44,1 kHz 192 kbps, 1 clip por prompt; watermark de áudio e C2PA suportados; sem negative prompt; "Regional online prediction requests per minute per base model" com valor "10 tokens per minute"; "Customers may elect to use it for production or commercial purposes, or disclose Generated Output to third-parties") | https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-3 | §5/R1, §6/C3, §7.1, §7.4, §7.6.1, §15.1, §15.3, K9 |
| [34] | Preço — Agent Platform, Generative AI ("Lyria 3 Pro creates full-length musical compositions from multimodal inputs such as text or images"; "$0.08 / 1 count"; Clip "30 second music clip", "$0.04 / 1 count") | https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing | §7.1, §7.6.1, §16.1 |
| [35] | Lyria — Google DeepMind ("All of our tracks are imperceptibly watermarked with SynthID technology, allowing you to detect whether music has been created or edited using AI."; "now up to 3 minutes long") | https://deepmind.google/models/lyria | §7.1, §7.6.1, §15.1 |
| [36] | Service Specific Terms — Google Cloud ("Generated Output is Customer Data. As between Customer and Google, Google does not assert any ownership rights in any new intellectual property created in the Generated Output."; Pre-GA "AS IS", sem SLA nem indenização, podendo ser alterado/suspenso/descontinuado; restrição de uso do output para substituir ou treinar modelo similar) | https://cloud.google.com/terms/service-terms | §7.1, §7.4, §7.6.1, §15.1, K9 |
| [37] | Introducing MiniMax Music 1.5 — anúncio oficial ("Extending song generation to a full 4 minutes, it delivers four groundbreaking advancements: unprecedented creative control, stunningly natural vocals, rich layered instrumentals, and coherent song structures.") | https://www.minimax.io/news/minimax-music-15 | §7.6.2 |
| [38] | Models — MiniMax API Docs (catálogo atual: `music-3.0`, `music-2.6`, `music-cover`, legacy `music-2.0`; **Music 1.5 ausente**; "Starting August 20, 2026, the paid APIs (Music Generation and Lyrics Generation) will no longer be available to new users; existing paying users can continue to use the current API services.") | https://platform.minimax.io/docs/guides/models-intro.md | §2.1/D11, §7.1, §7.6.2, §16.1, §18.2 |
| [39] | Pay as You Go — MiniMax API Docs (Music-3.0 e Music-2.6 a "$0.15/up-to-5 minutes music"; Music-2.0 a US$ 0,03; **Music 1.5 omitido**) | https://platform.minimax.io/docs/guides/pricing-paygo.md | §2.1/D11, §7.1, §7.6.2, §16.1, §18.2 |
| [40] | MiniMax — Terms of Service ("As between you and us, and to the extent permitted by applicable laws, you retain your ownership rights in Client input and generated content.") | https://platform.minimax.io/protocol/terms-of-service | §7.4, §7.6.2, §15.1 |
| [41] | MiniMax Music 1.5 no Replicate — página do modelo (US$ 0,03 por arquivo de output; máx. 240 s; `prompt` 10–300 e `lyrics` 10–600 caracteres **obrigatórios**; sem `is_instrumental`; inglês e chinês; README anuncia "Upload reference music for style analysis (optional, supports WAV, MP3, M4A; max 60MB, 5-30 seconds)" que **o schema atual não expõe**) | https://replicate.com/minimax/music-1.5 | §7.1, §7.4, §7.6.2, §15.1, §16.1 |
| [42] | Terms of Service — Replicate ("Replicate hereby grants to you all right, title and interest, if any, in and to Output, including your use of Output for commercial purposes such as sale or publication, subject to any Third Party Terms (as determined by the Models you use to generate the Output) which may apply to such Output.") | https://replicate.com/terms | §7.4, §7.6.2, §15.1, K13 |
| [43] | AudioCraft — README, Meta ("The models weights in this repository are released under the CC-BY-NC 4.0 license as found in the LICENSE_weights file."; código MIT) | https://github.com/facebookresearch/audiocraft/blob/main/README.md | §2.1/D12, §6/C11, §7.1, §7.4, §7.7, §15.1 |
| [44] | AudioCraft — `LICENSE_weights`, CC BY-NC 4.0 ("NonCommercial means not primarily intended for or directed towards commercial advantage or monetary compensation."; reprodução e material adaptado "for NonCommercial purposes only") | https://github.com/facebookresearch/audiocraft/blob/main/LICENSE_weights | §2.1/D12, §6/C11, §7.1, §7.4, §7.7, §15.1 |

#### Camada `2026-07-18` — transcritas, **não reconferidas em 2026-08-22**

Proveniência: `docs/research/ai-music-generation-providers.md` (consulta declarada de 2026-07-18) e
`docs/features/ai-original-music.md`, ambos no repositório. São fontes primárias oficiais **na data
daquela consulta**. Reconferir antes de qualquer decisão de contrato, preço ou termo.

| # | Título | URL | Sustenta |
| --- | --- | --- | --- |
| [45] | Interactions API — referência (mecanismo que o `lyria-provider.ts` usa hoje) | https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/interactions-api | §3.1 (contexto do provider existente) |
| [46] | Serviços de IA generativa indenizados (Lyria **não** consta) | https://cloud.google.com/terms/generative-ai-indemnified-services | §15.1 (secundário; a conclusão se apoia na cláusula Pre-GA de [36]) |
| [47] | Suno — Terms of Service (proíbe robôs, scraping, acesso por meios não disponibilizados) | https://suno.com/terms | §7.7 |
| [48] | ElevenLabs — Eleven Music Model-Specific Terms (`Media Rights` exclui **radio** em self-service e Enterprise Lite) | https://elevenlabs.io/eleven-music-model-specific-terms | §7.7 |
| [49] | Lyria 2 (`lyria-002`) — página do modelo (clipes de 32,8 s) | https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-002 | §7.7 |
| [50] | ElevenLabs — Eleven Music Terms (proíbe nome de artista/compositor, título de música/álbum, gravadora/editora e trechos identificáveis de letra) | https://elevenlabs.io/music-terms | §5/R1, §15.3 |

**Nota sobre a restrição etária.** `service.ts:132` implementa um gate de 18+ para pedidos de
usuário. A cláusula que o motiva está nos Service Specific Terms [36] — cuja URL foi verificada em
2026-08-22 —, mas **a passagem específica sobre menores de 18 anos foi transcrita de
`docs/research/ai-music-generation-providers.md` (2026-07-18) e não reconferida nesta passagem**.
O gate no código não depende dessa reconferência para continuar valendo.

**Fontes internas do repositório** (lidas integralmente em 2026-08-22, e citadas por `path:line`,
sem URL, por serem locais): `CLAUDE.md` · `README.md` · `package.json` · `prisma/schema.prisma` ·
`src/lib/config.ts` · todo `src/services/music-generation/` · `docs/QUALITY-PROCESS.md` ·
`docs/ARCHITECTURE.md` · `docs/STORAGE.md` · `docs/research/ai-music-generation-providers.md` ·
`docs/features/ai-original-music.md`.

**Dossiês de pesquisa desta passagem** (no root do worktree, não versionados por este RFC):
`ace-step-1.5-official-dossier.md` · `diffrhythm2_official_dossier.md` ·
`dossier-lyria3-minimax-music15.md` · `dossier_sources.json` · `lyria_minimax_evidence.txt`.

### 20.2 Registro de verificação — **concluída em 2026-08-22**

Esta seção era um backlog de perguntas e virou um **registro**. Ela não é mais o gate de aprovação
do RFC: o gate passou a ser a execução da onda 1 (§11). O que está aqui é (a) o que foi verificado,
com o snapshot, e (b) as lacunas que **de fato** sobraram.

#### 20.2.1 O que foi verificado

| Tema | Resultado | Snapshot / revisão | Fontes |
| --- | --- | --- | --- |
| ACE-Step 1.5 — macOS, MPS, MLX | ✅ suporte oficial documentado; launchers macOS próprios; `--device mps` distinto de `--lm-backend mlx` | código `14c0211d` | [3][6] |
| ACE-Step 1.5 — Python, `uv`, instalação | ✅ `>=3.11,<3.13`; `uv sync`; sem versão mínima de `uv` fixada | código `14c0211d` | [2][3] |
| ACE-Step 1.5 — REST headless, portas | ✅ `uv run acestep-api` na 8001; Gradio na 7860; entry points declarados | código `14c0211d` | [2][3] |
| ACE-Step 1.5 — variantes e tamanho | ✅ DiT 2B/XL 4B, LM 0.6B/1.7B/4B; XL ~18,8 GB bf16, **com contradição documental registrada** (§7.2.1) | cards `19671f4`, `d4a0b28` | [1][9] |
| ACE-Step 1.5 — batch | ✅ default 2, máx 8, com VRAM guard que pode reduzir | código `14c0211d` | [1][4][15] |
| ACE-Step 1.5 — instrumental | ✅ REST via `lyrics` vazio/`[Instrumental]`; **sem booleano em `/release_task`** | código `14c0211d` | [5][6][14] |
| ACE-Step 1.5 — reference/cover | ✅ `reference_audio` vs `src_audio`; `audio_cover_strength` 0–1 default 1.0, sugestão 0.2 | código `14c0211d` | [4][5] |
| ACE-Step 1.5 — licenças | ✅ código MIT; pesos marcados MIT; uso comercial de output **afirmado em card**, sem licença autônoma | LICENSE + cards | [1][7][8][9] |
| ACE-Step 1.5 — memória | ✅ mitigação VAE MLX mesclada (#1042, #1059); Autoscore+XL+LM4B em 32 GB não resolvido (#1081 fechada por inatividade, #1097 aberta) | PRs/issues | [10][11][12][13] |
| ACE-Step 1.5 — benchmark existente | ✅ `profile_inference.py`, 6 modos, matriz default 30/60/120/240 s × batch 1/2/4 | código `14c0211d` | [1][6] |
| DiffRhythm2 — device | ✅ **negativo**: `cuda if available else cpu`; sem MPS | código `7804f82` | [17] |
| DiffRhythm2 — duração, chunking | ✅ 210 s publicados; block flow matching; decode chunk/overlap hard-coded | paper v3 + código | [17][21][25] |
| DiffRhythm2 — instrumental | ✅ **negativo**: TODO; `[inst]` é seção, não modo | código `7804f82` | [16][17] |
| DiffRhythm2 — automação | ✅ CLI + JSONL **sequencial**; sem REST local; Space com `batch:false` | código + Space | [17][20][27][29] |
| DiffRhythm2 — licenças | ✅ Apache-2.0 código **e** pesos; **sem** termo de output | LICENSE + card | [16][22][23] |
| DiffRhythm2 — issues abertas | ✅ #5, #7, #11 abertas, sem resposta de maintainer | tracker | [30][31][32] |
| Lyria 3 Pro / Clip — preço, duração, inputs | ✅ US$ 0,08 / US$ 0,04; 184 s / 30 s; texto+imagem, áudio output-only | páginas do fornecedor | [33][34] |
| Lyria — SynthID, C2PA, Pre-GA | ✅ SynthID em todas as faixas; C2PA suportado; Pre-GA "AS IS", sem SLA/indenização | fornecedor | [33][35][36] |
| MiniMax Music 1.5 — status atual | ✅ ausente do catálogo e da tabela de preços; novos usuários bloqueados desde 2026-08-20 | docs atuais | [37][38][39] |
| MiniMax — termos | ✅ ownership do cliente preservada | ToS atual | [40] |
| Replicate / Music 1.5 — host terceiro | ✅ US$ 0,03/arquivo, 240 s, `lyrics` obrigatório, **contradição schema × README** em reference audio | página do modelo + ToS | [41][42] |
| MusicGen — licenças | ✅ código MIT, **pesos CC BY-NC 4.0** → descarte | README + LICENSE_weights | [43][44] |

#### 20.2.2 Lacunas residuais reais

Cinco, e nenhuma delas bloqueia as decisões de §2. Cada uma diz **por que** não foi fechada e
**onde** fecha.

| ID | Lacuna | Por que continua aberta | Onde fecha |
| --- | --- | --- | --- |
| **L1** | **Limite de taxa do Lyria é publicado com unidade inconsistente** — a seção fala em "requests per minute per base model" e o valor é "10 tokens per minute" [33] | É o texto oficial; não há segunda fonte que desambigue. Reescrever como "10 RPM" seria inventar | confirmação com console/suporte Google, antes de qualquer capacity planning que dependa de RPM |
| **L2** | **Variável que isola o cache de download do ACE-Step** não foi confirmada nas fontes desta pesquisa (§9.10) | O requisito (cache isolado, pin registrado) é nosso e está afirmado; o **nome** da variável não | PR-1, lendo a configuração do snapshot pinado. Até então, não prometer que `rm -rf ~/lofigen/` limpa tudo (§9.15) |
| **L3** | **Serviço de identificação de gravação** para o papel de C8 (o `QUALITY-PROCESS` cita "Shazam API") | Fora do escopo da pesquisa de 2026-08-22, que cobriu geradores e licenças | pesquisa própria antes do PR-9; até então, **não prometer** o gate |
| **L4** | **Embedder de áudio**: disponibilidade e licença (o `QUALITY-PROCESS` cita "MusicLM embeddings") | Idem — nenhum embedder foi verificado | PR-8, que decide o par (modelo, revisão) **e** confere a licença |
| **L5** | **Invocação exata do ffmpeg** para LUFS integrado + true peak em dBTP na versão instalada (§19.4) | Depende da versão local do ffmpeg, que não foi inspecionada | PR-6/PR-7, contra `ffmpeg -version` da máquina. O harness deve **falhar** se não extrair as duas grandezas |

**Duas lacunas que são do mundo, não nossas** — registradas para não serem confundidas com
pendência de pesquisa:

- **Licença autônoma de output do DiffRhythm2 não existe.** Não é "não encontrada": não há
  documento a encontrar nas fontes oficiais examinadas [16][23]. Apache-2.0 cobre código e pesos e
  não licencia outputs. Só o projeto pode fechar isso.
- **Preço oficial vigente do MiniMax Music 1.5 não é publicado.** O modelo está omitido da tabela
  atual [39] e o acesso novo está encerrado [38]. **N/D** é a resposta correta — não US$ 0,03 por
  analogia com o Music-2.0.

#### 20.2.3 O que deve ser reconferido, e quando

Não é backlog de pesquisa faltante; é manutenção de fatos que envelhecem.

| O que | Gatilho de reconferência |
| --- | --- |
| Preço e estágio do Lyria 3 ([33][34][36]) | antes de qualquer compromisso de orçamento; e ao sair de Pre-GA |
| Camada `[45]`–`[50]` (2026-07-18) | antes de qualquer decisão de contrato que dependa dela |
| Model card de ACE-Step ([8][9]) | antes da publicação comercial — é a base da permissão de output (K1) |
| Snapshot de código pinado ([1]–[15]) | ao mover o pin de §9.3; um pin novo **invalida** as medições da onda 1 (§8.5) |
| PR #1097 / issue #1081 ([12][13]) | antes de habilitar XL + LM 4B em qualquer máquina |

---

## 21. Auto-revisão

### 21.1 Mandato original do RFC (14 requisitos + regras editoriais)

| Requisito | Estado | Onde / ressalva |
| --- | --- | --- |
| 1 · Status, owners, data, Work-Control-ID, resumo, decisão, critérios | ✅ | Cabeçalho, §1, §2 |
| 2 · Alternatives matrix, fato × decisão separados | ✅ | §7. Fato `PÚBLICO` com citação em toda célula; §7.1 separa fato de decisão; §7.4 separa código/pesos/outputs/termos. Contradições oficiais registradas como contradição (§7.2.1, §7.6.2) |
| 3 · Arquitetura integrada (BullMQ/Prisma/Redis, provider HTTP versionado, filas, manifests, R2, estados, lease, idempotência, retomada, publish gate, kill switch) | ✅ | §8 inteira, §16.5 |
| 4 · Setup reproduzível nos dois Macs | ✅ | §9. Comandos exatos para ACE-Step 1.5, citados dos arquivos oficiais no snapshot `14c0211d`. **Nada executado ou testado** — dito no topo de §9 e em §9.14/§9.15 |
| 5 · Paralelismo/capacidade, fórmulas para 900/1200/1500/2000, sem horas sem RTF | ✅ | §10. Fórmulas (1)–(8); tabela de sensibilidade rotulada `ESTIMADO`/hipotética; limites conservadores + auto-tuning |
| 6 · Spike com matriz, captura, 3+ repetições/warmup, manifesto, go/no-go, sudo explícito | ✅ | §11, §19.2. Matriz do Lofiever (150/180/184 s, `B` 1/2/4, warmup + 3 repetições) distinguida da matriz default do fornecedor (§11.2) |
| 7 · Referências locais/licenciadas, hash, style cards abstratos, proibição de nomes, força baixa como hipótese, sem envio a API | ✅ | §12, §13.5, §15.2. §12.4 agora nomeia os parâmetros reais e mantém o uso como `HIPÓTESE` |
| 8 · Quality factory + correção de distância/similaridade + thresholds `ESTIMADO` | ✅ | §6 (C1–C11), §13 |
| 9 · Ondas com piloto de **50 gerações** | ✅ | §14 e §C9 (o erro de unidade corrigido explicitamente) |
| 10 · Direitos/privacidade/segurança | ✅ | §15. §15.1 agora tabela por rota, com o que cada permissão **não** dá |
| 11 · Custos por fórmula, observabilidade/SLO, rollback, kill switch, runbook | ✅ | §16 |
| 12 · Plano de PRs pequenos com acceptance/verification, sem implementar | ✅ | §17. Nenhum código alterado |
| 13 · Apêndices: schemas, comandos, launchd, harness, uninstall, sem segredo | ✅ | §19. Placeholders `<...>`/`<TBD>`; nenhum valor real |
| 14 · Riscos, open questions, reversível × irreversível | ✅ | §18 |
| Classificação epistemológica visível | ✅ | §0.1, com as duas camadas de `PÚBLICO` explicitadas |
| `MEDIDO` vazio; nada de performance M5/M4 como medida | ✅ | §0.1 regras 1–2; `null`/`TBD` em §10 e §19.2. O benchmark de M4 Pro 48 GB do PR #1042 aparece rotulado como `PÚBLICO` **sobre hardware de terceiro** [10] |
| Nenhum snippet de busca citado | ✅ | §20.1: URLs primárias, permalinks de commit/revisão, proveniência declarada por camada |
| Nenhuma URL/comando/benchmark inventado | ✅ | Comandos de terceiro citados da fonte (§9, §11); lacunas reais em §20.2.2 |
| Distingue repo existente × proposta | ✅ | §3 é só o existente; §8+ é só proposta |
| Preserva `docs/QUALITY-PROCESS.md` | ✅ | Não modificado nesta passagem. Correções são normativas aqui e aplicadas ao arquivo no PR-0 |
| Documentação-only | ✅ | Só `docs/rfcs/0001-local-hybrid-music-factory.md` foi editado |
| Não remove nem reformata arquivo não relacionado | ✅ | Nenhum outro arquivo tocado |

### 21.2 Segunda passagem editorial (2026-08-22) — as 12 exigências

| # | Exigência | Estado | Onde |
| --- | --- | --- | --- |
| 1 | Remover a limitação falsa de pesquisa incompleta e os `NÃO VERIFICADO` resolvidos; status segue Draft/não implementado, com pesquisa completa | ✅ | Cabeçalho; §0.2 reescrita como "pesquisa concluída"; §0.1 com as duas camadas de `PÚBLICO`. **Todos** os `NÃO VERIFICADO` da primeira passagem sobre ACE-Step, DiffRhythm2, MiniMax, Lyria e MusicGen foram resolvidos. O que resta marcado, e por quê, está inventariado em §21.5 — nenhum deles é dos cinco fornecedores pesquisados |
| 2 | Atualizar a decisão: ACE-Step principal condicionado ao spike; DiffRhythm2 challenger de baixo fit; Lyria fallback/âncoras; MiniMax oficial fora; Replicate host comparativo; MusicGen descartado | ✅ | §2.1 (D7, D8, D10, D11, D12), §2.2, §2.3, §7.1, §7.6.2, §7.7 |
| 3 | Alternatives matrix com fato `PÚBLICO` e citação exata; distinguir código, pesos, outputs e termos | ✅ | §7.2 (matriz local), §7.4 (a tabela de quatro objetos), §7.6 (APIs) |
| 4 | §9 reproduzível e exata para ACE-Step, sem instalar nada; Python, `uv`, commit, `uv sync`, MPS+MLX, `acestep-api`, portas, cache/pin, benchmark; batch 8 é limite funcional e começar em `B=1`; instrumental por `lyrics`; `reference_audio` × `src_audio`; `0.2` como sugestão oficial e `HIPÓTESE` no uso; uninstall/rollback e launchd sem alegar teste | ✅ | §9.1–§9.15. Batch em §9.7; instrumental em §9.8; áudio em §9.9; cache/pin em §9.3/§9.10 (com L2 declarada); benchmark em §9.11; rollback em §9.15; launchd em §9.14/§19.3 |
| 5 | Spike com o `profile_inference.py` real e seus modos, mantendo harness próprio; matriz Lofiever 150/180/184, `B` 1/2/4, warmup + 3 repetições; nunca apresentar M5/M4 como `MEDIDO` | ✅ | §9.11 (comandos e modos), §11.2 (matriz nossa vs default oficial), §11.3 (divisão de trabalho), §19.2 (`null` em toda medição) |
| 6 | Known issues de ACE-Step com nuance: #1042/#1059 mescladas; #1081 fechada por inatividade e #1097 aberta; não recomendar `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` | ✅ | §7.5 (a nuance completa), §10.4 (alavancas em ordem), §19.5 (recusa registrada), K2b |
| 7 | DiffRhythm2: 210 s; CLI JSONL sequencial; reference áudio/texto; Apache-2.0 código+pesos; outputs sem licença autônoma; sem MPS → CPU; instrumental-only TODO; sem REST local; challenger de pesquisa | ✅ | §2.1/D10, §7.1, §7.2, §7.4, §11.1, §20.2.1 |
| 8 | Lyria/MiniMax/MusicGen atualizados: preço, duração, inputs, SynthID, Pre-GA; status atual MiniMax; corrigir claims antigas incompatíveis | ✅ | §7.6.1 (ficha Lyria), §7.6.2 (MiniMax + Replicate), §7.7, §15.1, §16.1. Claims antigas corrigidas: SynthID reancorado no DeepMind [35] em vez do blog do Vertex; "sem indenização" reancorado na cláusula Pre-GA [36] |
| 9 | Refazer §20 Fontes com numeração consistente e URLs primárias/permalinks; toda claim externa com `[n]`; sem citação desconhecida, duplicada ou errada | ✅ | §20.1, 50 fontes em quatro blocos, com a camada `[45]`–`[50]` marcada como não reconferida. Verificação mecânica em §21.3 |
| 10 | Converter o backlog §20.2 em registro de verificação concluída, com snapshot/revisões e lacunas residuais reais; sem perguntas já resolvidas | ✅ | §20.2.1 (o que foi verificado), §20.2.2 (L1–L5 + as duas lacunas que são do mundo), §20.2.3 (reconferência por gatilho). O antigo V1–V13 foi removido |
| 11 | Toda performance M5/M4 como TBD/`MEDIDO` vazio ou `ESTIMADO` | ✅ | §0.1 regra 1–2, §10 inteira, §11, §19.2. Nenhuma instalação ou teste aconteceu |
| 12 | Auto-revisar as 12 exigências e rodar `git diff --check` | ✅ | Esta seção; resultado do `git diff --check` em §21.3 |

### 21.3 Verificação mecânica desta passagem

| Verificação | Resultado |
| --- | --- |
| `git diff --check` | **executado, sem saída — e a ausência de saída aqui NÃO é evidência.** O arquivo está **untracked** (`?? docs/rfcs/`), e `git diff` não inspeciona untracked: o check foi vacuosamente limpo. Uma verificação real exige `git add -N docs/rfcs/0001-local-hybrid-music-factory.md` antes de `git diff --check` — o que não foi feito, para não mexer no index. **Rodar isso antes de commitar.** |
| Marcador de conflito de merge no arquivo | nenhum |
| Citações inline `[n]` distintas usadas no texto | **50** — `[1]`–`[50]`, todas com entrada em §20.1 e todas citadas fora da tabela de fontes |
| Toda citação inline tem entrada em §20.1 | ✅ |
| Toda entrada de §20.1 é referenciada no texto | ✅ — as 50 têm ao menos uma citação inline fora da tabela de fontes |
| URLs duplicadas entre entradas distintas | nenhuma |
| Referências internas (`D1`–`D12`, `C1`–`C11`, `K1`–`K13`, `Q5`–`Q15`, `L1`–`L5`, `P1`–`P7`, `R1`–`R8`, `PR-0`–`PR-16`) | íntegras; o antigo esquema `V1`–`V13` foi **removido junto** com todas as suas referências, sem deixar ponteiro órfão |
| Intervalos matemáticos e arrays JSON (`[-1, 1]`, `[0,1]`, `[0.25, 0.40)`, tags `[intro]`/`[Instrumental]`) | preservados; nenhuma substituição cega de colchete |
| Arquivos alterados | **1** — `docs/rfcs/0001-local-hybrid-music-factory.md` |
| `docs/QUALITY-PROCESS.md` | intocado |
| Código | intocado |

Também foi removido nesta passagem um artefato de edição da primeira: duas linhas de marcação
espúria (`</content>`, `</invoke>`) no fim do arquivo, que não faziam parte do documento.

### 21.4 Fraquezas conhecidas, ditas em voz alta

1. **Nenhum número de performance existe.** §10 é álgebra correta sobre uma variável ausente. A
   tabela de sensibilidade mostra que a decisão local × API muda de resposta em 20× de `RTF` — o
   que é justamente o argumento para o spike vir antes de qualquer compromisso. Este continua
   sendo o gate de aprovação real.
2. **A permissão de uso comercial do output de ACE-Step se apoia numa frase de model card**
   [8][9], não numa licença de output. É o suficiente para remover o bloqueador de licença de
   pesos (§2.2) e **não** é parecer jurídico (§15.1, K1). Um revisor que precise de garantia
   contratual não vai encontrá-la aqui — porque ela não existe na fonte.
3. **`[45]`–`[50]` não foram reconferidas.** São de 2026-07-18. Nenhuma decisão de §2 depende
   exclusivamente delas, mas os descartes de Suno e ElevenLabs (§7.7) sim — e esses descartes
   deveriam ser reconferidos antes de qualquer reconsideração daqueles fornecedores.
4. **Cinco lacunas residuais** (L1–L5, §20.2.2) seguem abertas. Nenhuma bloqueia §2; duas (L2, L5)
   bloqueiam entregáveis específicos de PR e estão amarradas a eles.

### 21.5 Inventário completo do que continua marcado `NÃO VERIFICADO`

Para que a contagem seja auditável em vez de afirmada. **Nenhum item abaixo pertence aos cinco
fornecedores que a pesquisa de §0.2 cobriu** — esses estão todos fechados (§20.2.1).

| Onde | O que | Categoria | Fecha em |
| --- | --- | --- | --- |
| §6/C8 | Serviço de identificação de gravação ("Shazam API") | lacuna residual **L3** | pesquisa própria antes do PR-9 |
| §6/C11, §7.7 | Embedder de áudio ("MusicLM embeddings"): disponibilidade e licença | lacuna residual **L4** | PR-8 |
| §9.10, §9.15 | Nome da variável que isola o cache de download | lacuna residual **L2** | PR-1 |
| §19.4 | Invocação exata do ffmpeg para LUFS integrado + true peak em dBTP | lacuna residual **L5** | PR-6/PR-7 |
| §7.6.1 | Unidade do limite de taxa do Lyria ("10 tokens per minute") | lacuna residual **L1** — fato **publicado**, porém ambíguo; não é ausência de fonte | confirmação com console/suporte Google |
| §19.4 | Ferramenta de BPM/tonalidade e de fingerprint | **escolha interna adiada**, não lacuna de pesquisa externa | PR-7, PR-9 |
| §7.5, §10.4, §19.5 | Efeito real de `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` | **conhecimento registrado para recusar** — não é passo de nenhuma seção | não precisa fechar; se alguém quiser usá-lo, é PR próprio com evidência |
| §10.4, §19.5 | `sysctl` de memória *wired* da GPU no macOS | idem — **exige `sudo`**, fora do escopo | idem |

Total: **5** lacunas residuais de pesquisa (L1–L5), **2** escolhas internas de ferramenta adiadas
para PR, e **2** receitas de comunidade registradas explicitamente para serem recusadas.
