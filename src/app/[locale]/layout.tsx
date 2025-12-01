import type { Metadata, Viewport } from 'next';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import '../../styles/globals.css';
import AppProviders from '@/lib/providers/AppProviders';
import IntlProviderWrapper from '@/app/[locale]/components/IntlProviderWrapper';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function generateStaticParams() {
    return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
    title: 'Lofiever - 24/7 Lofi Streaming',
    description: 'Continuous streaming of lofi music with AI curation',
    keywords: ['lofi', 'music', 'streaming', 'AI', 'curation', 'study', 'focus', 'relax'],
    authors: [{ name: 'Lofiever Team' }],
};

export const viewport: Viewport = {
    themeColor: '#8459c0'
};

export default async function LocaleLayout({
    children,
    params
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
        <html lang={locale} key={locale}>
            <body className="antialiased" suppressHydrationWarning>
                <IntlProviderWrapper key={locale} locale={locale} messages={messages}>
                    <AppProviders key={locale}>
                        {children}
                    </AppProviders>
                </IntlProviderWrapper>
            </body>
        </html>
    );
}
