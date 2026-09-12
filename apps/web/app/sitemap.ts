import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';

/**
 * Sitemap.
 *
 * Only the public marketing pages. `/app` and `/admin` are authenticated
 * surfaces and are excluded here and in robots.txt.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${config.siteUrl}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${config.siteUrl}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${config.siteUrl}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
