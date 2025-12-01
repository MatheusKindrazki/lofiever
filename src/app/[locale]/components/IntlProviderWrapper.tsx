'use client';



import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';

interface Props {
    locale: string;
    messages: Record<string, string>;
    children: ReactNode;
}

export default function IntlProviderWrapper({ locale, messages, children }: Props) {
    // This wrapper forces a remount when the locale changes because the component key is set in the parent.
    return (
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
            {children}
        </NextIntlClientProvider>
    );
}
