/**
 * Frontend configuration.
 *
 * Everything here is public by nature — an API origin, a bot handle, a support
 * handle, a site URL — and every value is committed in this file rather than
 * read from a hosting dashboard. That is deliberate: the frontend needs **no
 * environment variables at all** on Vercel, so a deploy cannot break because a
 * variable was forgotten, and there is no dashboard field that could tempt a
 * secret into the browser bundle. Every real secret lives on the API, which is
 * the only place that can use one safely.
 *
 * `NEXT_PUBLIC_*` overrides are still honoured when present, for local work
 * against a different API. Nothing secret may ever be added here: anything
 * behind that prefix is embedded verbatim in the client bundle.
 */

/**
 * Where the API lives.
 *
 * This is the Railway service URL. Change it here, in the repository, and
 * redeploy — it is not a dashboard setting. `localhost` is used when running
 * the site locally with `npm run dev`.
 */
const API_ORIGIN = 'https://fundxtra.up.railway.app';

/** Telegram bot that hosts the Mini App. */
const BOT_USERNAME = 'fundxtrabot';

/** Support account shown wherever a user needs a human — PIN resets included. */
const SUPPORT_HANDLE = '@fundxtracarebot';

/** Public marketing site. */
const SITE_URL = 'https://fundxtra.name.ng';

function override(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

const isDevelopment = process.env.NODE_ENV === 'development';

export const config = {
  apiUrl: override(
    process.env.NEXT_PUBLIC_API_URL,
    isDevelopment ? 'http://localhost:8080' : API_ORIGIN,
  ).replace(/\/$/, ''),
  botUsername: override(process.env.NEXT_PUBLIC_TELEGRAM_BOT, BOT_USERNAME).replace(/^@/, ''),
  supportHandle: override(process.env.NEXT_PUBLIC_SUPPORT_HANDLE, SUPPORT_HANDLE),
  siteUrl: override(process.env.NEXT_PUBLIC_SITE_URL, SITE_URL).replace(/\/$/, ''),
} as const;

export const supportUrl = `https://t.me/${config.supportHandle.replace(/^@/, '')}`;
export const startEarningUrl = `https://t.me/${config.botUsername}`;
