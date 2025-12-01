'use client';
import { useTranslations } from 'next-intl';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { LocalizedComponents } from '@/components/LocalizedComponents';

export default function Home() {
    const t = useTranslations('common');

    return (
        <main className="flex min-h-screen flex-col items-center p-4 md:p-6 lg:p-8">
            <div className="z-10 w-full max-w-7xl flex flex-col items-center justify-start">
                <header className="flex flex-col items-center mb-6 relative w-full">
                    {/* Language Switcher - Top Right */}
                    <div className="absolute top-0 right-0">
                        <LanguageSwitcher />
                    </div>

                    <h1 className="text-4xl font-bold text-lofi-600 dark:text-lofi-300 md:text-6xl">
                        {t('appName')}
                    </h1>
                    <p className="text-lg text-gray-600 dark:text-gray-300 mt-2 text-center">
                        {t('appTagline')}
                    </p>
                </header>

                <LocalizedComponents />

                <footer className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
                    <p className="mt-1">{t('footer.madeWith')}</p>
                </footer>
            </div>
        </main>
    );
}
