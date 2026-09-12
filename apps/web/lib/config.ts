/**
 * Frontend configuration.
 *
 * Only `NEXT_PUBLIC_*` values are readable in the browser, and everything here
 * is intentionally public: an API origin, a bot handle, a support handle and
 * the Firebase web config. No secret is referenced in this file, and none
 * should ever be added to it — anything behind the `NEXT_PUBLIC_` prefix is
 * embedded verbatim in the client bundle.
 */

function required(value: string | undefined, name: string, fallback: string): string {
  if (value && value.length > 0) return value;
  if (process.env.NODE_ENV === 'production' && typeof window === 'undefined') {
    // Surfaced at build time, where it can still be fixed, rather than as a
    // runtime failure in a user's Telegram WebView.
    console.warn(`[fundxtra] ${name} is not set; falling back to "${fallback}"`);
  }
  return fallback;
}

export const config = {
  apiUrl: required(process.env.NEXT_PUBLIC_API_URL, 'NEXT_PUBLIC_API_URL', 'http://localhost:8080').replace(
    /\/$/,
    '',
  ),
  botUsername: required(
    process.env.NEXT_PUBLIC_TELEGRAM_BOT,
    'NEXT_PUBLIC_TELEGRAM_BOT',
    'fundxtrabot',
  ).replace(/^@/, ''),
  supportHandle: required(
    process.env.NEXT_PUBLIC_SUPPORT_HANDLE,
    'NEXT_PUBLIC_SUPPORT_HANDLE',
    '@fundxtracarebot',
  ),
  siteUrl: required(
    process.env.NEXT_PUBLIC_SITE_URL,
    'NEXT_PUBLIC_SITE_URL',
    'https://fundxtra.name.ng',
  ).replace(/\/$/, ''),

  firebase: {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  },
} as const;

export const supportUrl = `https://t.me/${config.supportHandle.replace(/^@/, '')}`;
export const startEarningUrl = `https://t.me/${config.botUsername}`;

/** True when the Firebase web config is complete enough to initialise. */
export const firebaseConfigured =
  config.firebase.apiKey.length > 0 && config.firebase.projectId.length > 0;
