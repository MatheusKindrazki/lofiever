import { generateStructuredData, SupportedLocale } from '@/lib/seo';

interface JsonLdProps {
  locale: SupportedLocale;
}

export function JsonLd({ locale }: JsonLdProps) {
  const structuredData = generateStructuredData(locale);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData, null, 0),
      }}
    />
  );
}
