'use client';
import { useTranslations } from 'next-intl';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { LocalizedComponents } from '@/components/LocalizedComponents';
import MoodToggle from '@/components/MoodToggle';

export default function Home() {
    const t = useTranslations('common');

    return (
        <main className="flex min-h-screen flex-col items-center p-4 md:p-6 lg:p-8">
            <div className="z-10 w-full max-w-7xl flex flex-col items-center justify-start">
                <header className="flex flex-col items-center mb-6 relative w-full">
                    {/* Language Switcher - Top Right */}
                    <div className="absolute top-0 right-0 flex items-center gap-2">
                        <MoodToggle />
                        <LanguageSwitcher />
                    </div>

                    <h1 className="text-4xl font-bold md:text-6xl font-serif bg-gradient-to-r from-[var(--mood-accent)] via-[var(--mood-accent-2)] to-[var(--mood-accent-3)] text-transparent bg-clip-text drop-shadow-sm">
                        {t('appName')}
                    </h1>
                    <p className="text-lg text-white/65 mt-2 text-center">
                        {t('appTagline')}
                    </p>
                </header>

                <LocalizedComponents />

                <footer className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    {/* Credits */}
                    <p className="flex items-center justify-center gap-1">
                        {t('footer.createdBy')}{' '}
                        <a
                            href="https://github.com/MatheusKindrazki"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--mood-accent)] hover:text-[var(--mood-accent-2)] transition-colors font-medium"
                        >
                            @MatheusKindrazki
                        </a>
                    </p>

                    {/* GitHub CTA */}
                    <div className="mt-3 flex items-center justify-center gap-4">
                        <a
                            href="https://github.com/MatheusKindrazki/lofiever"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-white/70 hover:text-white"
                        >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                            </svg>
                            <span>{t('footer.starOnGithub')}</span>
                        </a>
                        <a
                            href="https://github.com/MatheusKindrazki/lofiever/issues/new?template=feature_request.md"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-white/70 hover:text-white"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            <span>{t('footer.suggestFeature')}</span>
                        </a>
                    </div>

                    {/* Contribute CTA */}
                    <p className="mt-3 text-white/50">
                        {t('footer.openSource')}{' '}
                        <a
                            href="https://github.com/MatheusKindrazki/lofiever/blob/main/CONTRIBUTING.md"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--mood-accent)] hover:text-[var(--mood-accent-2)] transition-colors underline underline-offset-2"
                        >
                            {t('footer.contribute')}
                        </a>
                    </p>

                    {/* Copyright */}
                    <p className="mt-4 text-white/30">
                        {t('footer.copyright', { year: new Date().getFullYear() })}
                    </p>
                </footer>
            </div>
        </main>
    );
}
