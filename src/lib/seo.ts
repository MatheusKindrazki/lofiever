import { Metadata } from 'next';
import { routing } from '@/i18n/routing';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lofiever.com';

// SEO content by locale
export const seoContent = {
  pt: {
    title: 'Lofiever - Radio Lofi 24/7 com DJ Virtual e IA',
    description:
      'Lofiever e a radio lofi online 24 horas por dia, 7 dias por semana. Musica lofi perfeita para estudar, trabalhar, relaxar e focar. DJ virtual com inteligencia artificial que aceita pedidos de musica.',
    keywords: [
      'lofi',
      'radio lofi',
      'musica lofi',
      'lofi para estudar',
      'lofi para trabalhar',
      'musica relaxante',
      'musica para foco',
      'musica para concentrar',
      'lofi hip hop',
      'chillhop',
      'radio online',
      '24/7 lofi',
      'DJ virtual',
      'IA musica',
      'streaming lofi',
      'beats para estudar',
      'musica ambiente',
      'lo-fi',
    ],
    ogTitle: 'Lofiever - Radio Lofi 24/7 com DJ Virtual',
    ogDescription:
      'Sua radio lofi favorita online 24h. Musica perfeita para estudar, trabalhar e relaxar. Peca musicas para o DJ virtual!',
    twitterTitle: 'Lofiever - Radio Lofi 24/7',
    twitterDescription:
      'Radio lofi online 24h com DJ virtual. Musica para estudar, trabalhar e relaxar.',
  },
  en: {
    title: 'Lofiever - 24/7 Lofi Radio with Virtual DJ & AI',
    description:
      'Lofiever is an online lofi radio streaming 24 hours a day, 7 days a week. Perfect lofi music for studying, working, relaxing, and focusing. Virtual DJ powered by AI that takes music requests.',
    keywords: [
      'lofi',
      'lofi radio',
      'lofi music',
      'lofi for studying',
      'lofi for work',
      'relaxing music',
      'focus music',
      'concentration music',
      'lofi hip hop',
      'chillhop',
      'online radio',
      '24/7 lofi',
      'virtual DJ',
      'AI music',
      'lofi streaming',
      'study beats',
      'ambient music',
      'lo-fi',
      'lofi beats',
      'chill beats',
    ],
    ogTitle: 'Lofiever - 24/7 Lofi Radio with Virtual DJ',
    ogDescription:
      'Your favorite lofi radio streaming 24/7. Perfect music for studying, working, and relaxing. Request songs from the virtual DJ!',
    twitterTitle: 'Lofiever - 24/7 Lofi Radio',
    twitterDescription:
      '24/7 lofi online radio with virtual DJ. Music for studying, working, and relaxing.',
  },
} as const;

export type SupportedLocale = keyof typeof seoContent;

// Generate metadata for a specific locale
export function generateSeoMetadata(locale: SupportedLocale): Metadata {
  const content = seoContent[locale] || seoContent.en;
  const alternateLocales = routing.locales.filter((l) => l !== locale);

  return {
    metadataBase: new URL(BASE_URL),
    title: {
      default: content.title,
      template: `%s | Lofiever`,
    },
    description: content.description,
    keywords: content.keywords,
    authors: [{ name: 'Lofiever Team' }],
    creator: 'Lofiever',
    publisher: 'Lofiever',
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    alternates: {
      canonical: `${BASE_URL}/${locale}`,
      languages: Object.fromEntries([
        ...routing.locales.map((l) => [l, `${BASE_URL}/${l}`]),
        ['x-default', `${BASE_URL}/${routing.defaultLocale}`],
      ]),
    },
    openGraph: {
      type: 'website',
      locale: locale === 'pt' ? 'pt_BR' : 'en_US',
      alternateLocale: alternateLocales.map((l) =>
        l === 'pt' ? 'pt_BR' : 'en_US'
      ),
      url: `${BASE_URL}/${locale}`,
      siteName: 'Lofiever',
      title: content.ogTitle,
      description: content.ogDescription,
      images: [
        {
          url: `${BASE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: 'Lofiever - 24/7 Lofi Radio',
          type: 'image/png',
        },
        {
          url: `${BASE_URL}/og-image-square.png`,
          width: 600,
          height: 600,
          alt: 'Lofiever Logo',
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: content.twitterTitle,
      description: content.twitterDescription,
      images: [`${BASE_URL}/og-image.png`],
      creator: '@lofiever',
      site: '@lofiever',
    },
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/icon.svg', type: 'image/svg+xml' },
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      ],
      apple: [
        { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      ],
    },
    manifest: '/manifest.json',
    category: 'music',
    classification: 'Music Streaming',
    other: {
      'apple-mobile-web-app-capable': 'yes',
      'apple-mobile-web-app-status-bar-style': 'black-translucent',
      'apple-mobile-web-app-title': 'Lofiever',
      'mobile-web-app-capable': 'yes',
      'msapplication-TileColor': '#8459c0',
      'msapplication-config': '/browserconfig.xml',
    },
  };
}

// Generate JSON-LD structured data
export function generateStructuredData(locale: SupportedLocale) {
  const content = seoContent[locale] || seoContent.en;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      // Organization
      {
        '@type': 'Organization',
        '@id': `${BASE_URL}/#organization`,
        name: 'Lofiever',
        url: BASE_URL,
        logo: {
          '@type': 'ImageObject',
          url: `${BASE_URL}/logo.png`,
          width: 512,
          height: 512,
        },
        sameAs: [
          'https://twitter.com/lofiever',
          'https://instagram.com/lofiever',
          'https://youtube.com/@lofiever',
        ],
        description: content.description,
      },
      // WebSite
      {
        '@type': 'WebSite',
        '@id': `${BASE_URL}/#website`,
        url: BASE_URL,
        name: 'Lofiever',
        description: content.description,
        publisher: {
          '@id': `${BASE_URL}/#organization`,
        },
        inLanguage: locale === 'pt' ? 'pt-BR' : 'en-US',
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${BASE_URL}/${locale}?search={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
      // WebPage
      {
        '@type': 'WebPage',
        '@id': `${BASE_URL}/${locale}/#webpage`,
        url: `${BASE_URL}/${locale}`,
        name: content.title,
        description: content.description,
        isPartOf: {
          '@id': `${BASE_URL}/#website`,
        },
        about: {
          '@id': `${BASE_URL}/#organization`,
        },
        inLanguage: locale === 'pt' ? 'pt-BR' : 'en-US',
      },
      // RadioBroadcastService (specific for streaming radio)
      {
        '@type': 'RadioBroadcastService',
        '@id': `${BASE_URL}/#radioservice`,
        name: 'Lofiever Radio',
        description:
          locale === 'pt'
            ? 'Radio lofi online 24/7 com DJ virtual'
            : '24/7 lofi online radio with virtual DJ',
        url: BASE_URL,
        broadcastDisplayName: 'Lofiever',
        broadcastTimezone: 'UTC',
        broadcaster: {
          '@id': `${BASE_URL}/#organization`,
        },
        parentService: {
          '@type': 'RadioBroadcastService',
          name: 'Lofiever Streaming',
        },
        genre: ['Lo-Fi', 'Chillhop', 'Study Music', 'Ambient'],
        inLanguage: ['pt-BR', 'en-US'],
      },
      // SoftwareApplication (for the web app)
      {
        '@type': 'WebApplication',
        '@id': `${BASE_URL}/#webapp`,
        name: 'Lofiever',
        description: content.description,
        url: BASE_URL,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Any',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.8',
          ratingCount: '150',
          bestRating: '5',
          worstRating: '1',
        },
      },
      // BreadcrumbList
      {
        '@type': 'BreadcrumbList',
        '@id': `${BASE_URL}/${locale}/#breadcrumb`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: `${BASE_URL}/${locale}`,
          },
        ],
      },
    ],
  };
}
