import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lofiever.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const locales = routing.locales;
  const now = new Date();

  // Main pages with all locale variants
  const mainPages: MetadataRoute.Sitemap = [];

  // Home page for each locale
  locales.forEach((locale) => {
    mainPages.push({
      url: `${BASE_URL}/${locale}`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
      alternates: {
        languages: Object.fromEntries(
          locales.map((l) => [l, `${BASE_URL}/${l}`])
        ),
      },
    });
  });

  return mainPages;
}
