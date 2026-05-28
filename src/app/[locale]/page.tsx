'use client';
import { useTranslations } from 'next-intl';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { LocalizedComponents } from '@/components/LocalizedComponents';
import MoodToggle from '@/components/MoodToggle';

export default function Home() {
    const t = useTranslations('common');

    return (
        <main className="relative flex min-h-screen flex-col">
            <header className="relative z-20 flex items-start justify-between gap-6 px-4 py-4 md:px-8 md:py-5">
                <div className="min-w-0 pt-0.5">
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-lofi-400">
                        {t('appTagline')}
                    </p>
                    <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-(--foreground-color) md:text-2xl">
                        {t('appName')}
                    </h1>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <MoodToggle />
                    <LanguageSwitcher />
                </div>
            </header>

            <div className="relative z-10 flex flex-1 flex-col px-4 pb-4 md:px-8 lg:px-10">
                <LocalizedComponents />
            </div>

            <footer className="relative z-10 mt-auto border-t border-lofi-800/40 px-4 py-6 md:px-8">
                <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <p className="text-sm text-lofi-300">
                        {t('footer.createdBy')}{' '}
                        <a
                            href="https://github.com/MatheusKindrazki"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-lofi-200 underline-offset-2 transition-colors hover:text-(--foreground-color) hover:underline"
                        >
                            @MatheusKindrazki
                        </a>
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                        <a
                            href="https://github.com/MatheusKindrazki/lofiever"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full border border-lofi-700/60 bg-lofi-950/30 px-3 py-1.5 text-sm text-lofi-200 transition-colors hover:border-lofi-600/70 hover:bg-lofi-900/40 hover:text-(--foreground-color)"
                        >
                            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                            </svg>
                            <span>{t('footer.starOnGithub')}</span>
                        </a>
                        <a
                            href="https://github.com/MatheusKindrazki/lofiever/issues/new?template=feature_request.md"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full border border-lofi-700/60 bg-lofi-950/30 px-3 py-1.5 text-sm text-lofi-200 transition-colors hover:border-lofi-600/70 hover:bg-lofi-900/40 hover:text-(--foreground-color)"
                        >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            <span>{t('footer.suggestFeature')}</span>
                        </a>
                    </div>
                </div>

                <p className="mx-auto mt-4 max-w-5xl text-sm text-lofi-400">
                    {t('footer.openSource')}{' '}
                    <a
                        href="https://github.com/MatheusKindrazki/lofiever/blob/main/CONTRIBUTING.md"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-lofi-300 underline underline-offset-2 transition-colors hover:text-lofi-200"
                    >
                        {t('footer.contribute')}
                    </a>
                </p>

                <p className="mx-auto mt-3 max-w-5xl text-xs text-lofi-400">
                    {t('footer.copyright', { year: new Date().getFullYear() })}
                </p>
            </footer>
        </main>
    );
}
