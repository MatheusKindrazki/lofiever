'use client';

import Script from 'next/script';

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export function GoogleAnalytics() {
  if (!GA_MEASUREMENT_ID) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}', {
            page_path: window.location.pathname,
            anonymize_ip: true,
            cookie_flags: 'SameSite=None;Secure',
          });
        `}
      </Script>
    </>
  );
}

// Event tracking helper
export function trackEvent(
  action: string,
  category: string,
  label?: string,
  value?: number
) {
  if (typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('event', action, {
      event_category: category,
      event_label: label,
      value: value,
    });
  }
}

// Specific events for Lofiever
export const lofieverEvents = {
  playStream: () => trackEvent('play', 'streaming', 'lofi_stream'),
  pauseStream: () => trackEvent('pause', 'streaming', 'lofi_stream'),
  requestSong: (songName: string) =>
    trackEvent('request_song', 'interaction', songName),
  chatWithDJ: () => trackEvent('chat', 'interaction', 'dj_chat'),
  changeLanguage: (locale: string) =>
    trackEvent('change_language', 'settings', locale),
  enterZenMode: () => trackEvent('zen_mode', 'ui', 'enter'),
  exitZenMode: () => trackEvent('zen_mode', 'ui', 'exit'),
};
