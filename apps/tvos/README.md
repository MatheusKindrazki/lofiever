# Lofiever TV

Cliente Apple TV/tvOS do Lofiever usando Expo TV + React Native TV.

## O que essa base ja faz

- toca a stream em `/api/stream/audio-stream`
- mostra a faixa atual, ouvintes e proximas faixas
- atualiza metadata em polling
- usa uma interface preparada para navegacao por controle remoto

## Stack escolhida

Eu escolhi `Expo TV` com `react-native-tvos` porque o projeto principal ja e `TypeScript + React`.
Isso reduz o custo de manutencao e facilita reaproveitar contrato de API, tipos e regras de negocio do backend atual.

## Configuracao

Crie um arquivo `.env` em `apps/tvos`:

```bash
EXPO_PUBLIC_LOFIEVER_API_URL=http://localhost:3000
```

### Qual URL usar

- Apple TV Simulator no mesmo Mac: `http://localhost:3000`
- Apple TV fisica na rede: `http://SEU-IP-LOCAL:3000`

Exemplo:

```bash
EXPO_PUBLIC_LOFIEVER_API_URL=http://192.168.0.15:3000
```

## Rodando

Primeiro, suba o backend principal do Lofiever na raiz do repo:

```bash
npm run dev
```

Depois, neste diretório:

```bash
npm install
npm run prebuild:tv
npm run ios
```

## Abrindo na Apple TV

### Simulador

1. Rode `npm run prebuild:tv`
2. Rode `npm run ios`
3. Abra o workspace iOS no Xcode se quiser escolher explicitamente o destino Apple TV

### Apple TV fisica

Inferencia pratica: o fluxo e o mesmo de qualquer app Apple assinado.
Voce vai precisar de assinatura Apple Developer e apontar `EXPO_PUBLIC_LOFIEVER_API_URL` para o IP da sua maquina ou para um backend publicado.

Passo a passo:

1. `npm run prebuild:tv`
2. Abra `ios` no Xcode
3. Escolha seu Apple TV como destino
4. Ajuste Team/Signing
5. Build e install

## Proximos passos recomendados

- trocar polling por `Socket.IO` para sync mais fiel
- portar quick actions do DJ para TV
- adaptar Zen Mode para tvOS
- substituir os assets placeholder por arte do Lofiever
