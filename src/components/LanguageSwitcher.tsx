'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { useTransition } from 'react';

export default function LanguageSwitcher() {
    const t = useTranslations('language');
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const [isPending, startTransition] = useTransition();

    const locales = [
        { code: 'pt', name: 'Português', emoji: '🇧🇷' },
        { code: 'en', name: 'English', emoji: '🇺🇸' }
    ];

    const otherLocale = locales.find(l => l.code !== locale) || locales[1];

    const handleLocaleChange = (newLocale: string) => {
        startTransition(() => {
            router.push(pathname, { locale: newLocale });
        });
    };

    return (
        <div className="relative">
            {/* Simple toggle button */}
            <button
                onClick={() => handleLocaleChange(otherLocale.code)}
                disabled={isPending}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-full border border-gray-200 dark:border-gray-700 transition-all disabled:opacity-50 shadow-sm"
                aria-label={t('switchTo')}
            >
                <span className="text-lg">{isPending ? '⏳' : otherLocale.emoji}</span>
                <span className="hidden sm:inline font-medium text-gray-700 dark:text-gray-300">
                    {otherLocale.code.toUpperCase()}
                </span>
            </button>
        </div>
    );
}
