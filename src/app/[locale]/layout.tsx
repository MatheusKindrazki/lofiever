import type { Metadata, Viewport } from 'next';
import { Fraunces, Manrope, JetBrains_Mono } from 'next/font/google';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import '../../styles/globals.css';
import AppProviders from '@/lib/providers/AppProviders';
import IntlProviderWrapper from '@/app/[locale]/components/IntlProviderWrapper';
import type { SupportedLocale } from '@/lib/seo';
import { generateSeoMetadata } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { GoogleAnalytics } from '@/components/seo/GoogleAnalytics';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return generateSeoMetadata(locale as SupportedLocale);
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#8459c0' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1a2e' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

const manrope = Manrope({
    subsets: ['latin'],
    variable: '--font-manrope',
    display: 'swap',
});

const fraunces = Fraunces({
    subsets: ['latin'],
    variable: '--font-fraunces',
    display: 'swap',
});

const jetbrains = JetBrains_Mono({
    subsets: ['latin'],
    variable: '--font-jetbrains-mono',
    display: 'swap',
});

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<React.ReactElement> {
  const { locale } = await params;

  // Ensure that the incoming `locale` is valid
  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  // Tell Next.js/next-intl which locale is active for this request
  setRequestLocale(locale);

  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();

  return (
    <html lang={locale === 'pt' ? 'pt-BR' : 'en-US'} key={locale}>
      <head>
        <JsonLd locale={locale as SupportedLocale} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body
        className={`${manrope.variable} ${fraunces.variable} ${jetbrains.variable} antialiased dark`}
        suppressHydrationWarning
      >
        <GoogleAnalytics />
        <IntlProviderWrapper key={locale} locale={locale} messages={messages}>
          <AppProviders key={locale}>{children}</AppProviders>
        </IntlProviderWrapper>
      </body>
    </html>
  );
}
