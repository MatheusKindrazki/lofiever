import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { config } from '@/lib/config';

const BASE_URL = config.app.url;

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
