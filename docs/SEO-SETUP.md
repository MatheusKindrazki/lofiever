# SEO Setup - Lofiever

Este documento descreve as configuracoes de SEO implementadas no Lofiever.

## Arquivos Criados/Modificados

### 1. Meta Tags e Open Graph
- **Arquivo:** `src/lib/seo.ts`
- **Descricao:** Configuracao centralizada de SEO com suporte a PT/EN
- **Inclui:**
  - Title, description, keywords por locale
  - Open Graph tags (og:title, og:description, og:image, etc.)
  - Twitter Cards (summary_large_image)
  - Canonical URLs
  - Hreflang alternates
  - Robots meta tags

### 2. Structured Data (JSON-LD)
- **Arquivo:** `src/components/seo/JsonLd.tsx`
- **Schemas implementados:**
  - Organization
  - WebSite
  - WebPage
  - RadioBroadcastService
  - WebApplication
  - BreadcrumbList

### 3. Sitemap
- **Arquivo:** `src/app/sitemap.ts`
- **URL:** `/sitemap.xml`
- **Descricao:** Sitemap dinamico com alternates para cada locale

### 4. Robots.txt
- **Arquivos:**
  - `public/robots.txt` (estatico)
  - `src/app/robots.ts` (dinamico)
- **URL:** `/robots.txt`
- **Configuracao:**
  - Allow: /
  - Disallow: /api/, /admin/, /_next/
  - Sitemap reference

### 5. Favicons e Icones
- **Arquivos em `/public/`:**
  - `icon.svg` - Icone principal SVG
  - `favicon.ico` - Favicon tradicional
  - `favicon-16x16.png`
  - `favicon-32x32.png`
  - `apple-touch-icon.png` (180x180)
  - `icon-192.png`
  - `icon-512.png`
  - `logo.png`

### 6. Open Graph Images
- **Arquivos:**
  - `og-image.svg` / `og-image.png` (1200x630)
  - `og-image-square.png` (600x600)

### 7. PWA Manifest
- **Arquivo:** `public/manifest.json`
- **Inclui:**
  - App name e short_name
  - Icons para diferentes tamanhos
  - Theme color e background color
  - Start URL e scope

### 8. Google Analytics
- **Arquivo:** `src/components/seo/GoogleAnalytics.tsx`
- **Variavel de ambiente:** `NEXT_PUBLIC_GA_MEASUREMENT_ID`
- **Eventos personalizados disponíveis:**
  - `lofieverEvents.playStream()`
  - `lofieverEvents.pauseStream()`
  - `lofieverEvents.requestSong(songName)`
  - `lofieverEvents.chatWithDJ()`
  - `lofieverEvents.changeLanguage(locale)`
  - `lofieverEvents.enterZenMode()`
  - `lofieverEvents.exitZenMode()`

## Variaveis de Ambiente Necessarias

```env
# URL base do app (obrigatorio para SEO)
NEXT_PUBLIC_APP_URL=https://lofiever.com

# Google Analytics (opcional)
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

## Proximos Passos Recomendados

### 1. Configurar Google Search Console
- Acesse: https://search.google.com/search-console
- Adicione a propriedade: https://lofiever.com
- O arquivo de verificacao ja existe: `public/google245f2abbe1c91eb6.html`
- Submeta o sitemap: https://lofiever.com/sitemap.xml

### 2. Configurar Google Analytics 4
- Crie uma propriedade GA4 em: https://analytics.google.com
- Copie o Measurement ID (G-XXXXXXXXXX)
- Adicione no .env: `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX`

### 3. Configurar Bing Webmaster Tools
- Acesse: https://www.bing.com/webmasters
- Adicione o site e submeta o sitemap

### 4. Redes Sociais
- Configure os perfis de @lofiever no Twitter/X, Instagram, YouTube
- Atualize os links em `src/lib/seo.ts` no schema Organization

### 5. Monitoramento
- Acompanhe o Search Console para erros de indexacao
- Monitore Core Web Vitals
- Verifique o ranking para keywords principais

## Testes de Validacao

### Validar Structured Data
- https://validator.schema.org/
- https://search.google.com/test/rich-results

### Validar Open Graph
- https://developers.facebook.com/tools/debug/
- https://cards-dev.twitter.com/validator

### Validar Sitemap
- https://www.xml-sitemaps.com/validate-xml-sitemap.html

### Validar Robots.txt
- https://www.google.com/webmasters/tools/robots-testing-tool

## Keywords Principais

### Portugues (PT-BR)
- lofi, radio lofi, musica lofi
- lofi para estudar, lofi para trabalhar
- musica relaxante, musica para foco
- DJ virtual, streaming lofi

### Ingles (EN)
- lofi, lofi radio, lofi music
- lofi for studying, lofi for work
- relaxing music, focus music
- virtual DJ, lofi streaming, study beats
