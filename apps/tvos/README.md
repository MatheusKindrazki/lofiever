# Lofiever para TV

Cliente Apple TV/tvOS do Lofiever, construído com Expo SDK 55 e `react-native-tvos`.

## Funcionalidades

- rádio lo-fi 24/7 usando a API publicada;
- reprodução sincronizada com o relógio da transmissão web;
- faixa atual e próximas músicas, sem exibir contagem de ouvintes;
- navegação e foco preparados para o Siri Remote;
- política de privacidade e suporte acessíveis dentro do app;
- áudio em segundo plano, sem permissão de microfone.

## Desenvolvimento

Instale as dependências e abra o Metro no modo TV:

```bash
npm ci
npm start
```

O endpoint padrão é `https://app.lofiever.dev`. Para usar o backend local, crie `.env.local`:

```bash
EXPO_PUBLIC_LOFIEVER_API_URL=http://localhost:3000
```

No simulador ou dispositivo conectado:

```bash
npm run ios
```

## Projeto nativo

Toda regeneração é explicitamente tvOS e reaplica o app icon em camadas:

```bash
npm run prebuild
```

Os diretórios nativos são versionados. Por isso o check de sincronização automática do Expo Doctor está desativado de forma intencional; `prebuild` é o comando obrigatório depois de alterar `app.json` ou plugins.

## Verificação

```bash
npm run verify
```

Esse gate executa lint, TypeScript, testes de sincronização, Expo Doctor e um bundle Release com a URL de produção.

## App Store

```bash
npm run release:archive
npm run release:export
```

Os comandos criam um archive Release e tentam exportá-lo com assinatura automática do Team `YFYB6NKC73`. Os metadados, textos de privacidade e checklist do App Store Connect ficam em `store/`.

O primeiro export de distribuição exige uma conta Apple Developer com permissão para criar o certificado Apple Distribution e o perfil `tvOS App Store Connect` do Bundle ID `com.matheuskindrazki.lofievertv`.

## Assets

Os ícones tvOS têm camadas Back, Middle e Front distintas para o efeito de parallax. Para regenerar as imagens a partir dos SVGs editoriais:

```bash
npm run store:generate
npm run store:assets
```

`store:generate` requer ImageMagick e librsvg no Mac. Os PNGs gerados ficam versionados, então isso não é necessário durante um build normal.
