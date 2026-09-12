'use client';

/**
 * Telegram Mini App bridge.
 *
 * A thin, typed wrapper over `window.Telegram.WebApp`. Three reasons it exists
 * rather than components touching the global directly:
 *
 * 1. **Everything is optional.** The Mini App must also run in a plain browser
 *    (for development and for the admin console), so every call is guarded and
 *    a missing SDK degrades to sensible defaults rather than throwing.
 * 2. **`initData` is treated as opaque.** The client never parses it or trusts
 *    the user object inside it — it forwards the raw string to the API, which
 *    verifies the HMAC. Reading `initDataUnsafe` for display is fine; reading
 *    it for *authorisation* is the mistake this wrapper makes hard to commit.
 * 3. **Viewport handling lives in one place.** Telegram's WebView reports its
 *    own height and changes it when the keyboard opens, which `100vh` does not
 *    track. `useTelegramViewport` publishes that as a CSS variable.
 */

import { useEffect, useState } from 'react';

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
      is_premium?: boolean;
    };
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  enableClosingConfirmation?: () => void;
  disableVerticalSwipes?: () => void;
  onEvent: (event: string, handler: () => void) => void;
  offEvent: (event: string, handler: () => void) => void;
  HapticFeedback?: {
    impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged?: () => void;
  };
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
  MainButton?: {
    setText: (text: string) => void;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
}

export function webApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null
  );
}

export function insideTelegram(): boolean {
  const app = webApp();
  return Boolean(app && app.initData.length > 0);
}

/**
 * The raw `initData` string to send to the API.
 *
 * Returns null outside Telegram so the caller can decide what to do — the app
 * shows an "open this from Telegram" screen rather than silently failing.
 */
export function rawInitData(): string | null {
  const app = webApp();
  if (!app || app.initData.length === 0) return null;
  return app.initData;
}

/** Shape a referral code is allowed to take, before it is sent anywhere. */
const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The referral code, if the user arrived by an invite link.
 *
 * Two sources, in order of trustworthiness:
 *
 * 1. `start_param` from `initDataUnsafe` — part of the HMAC-signed payload,
 *    populated for a direct Mini App link (`t.me/<bot>/<app>?startapp=CODE`).
 * 2. `?ref=` on this page's URL — how the bot's `web_app` button carries the
 *    code, because Telegram does not sign a `start_param` for a button.
 *
 * The second is a claim, not a fact, and the API treats it as one: attribution
 * happens once, only when the account is created, and self-referral is refused.
 * It is filtered to a known shape here so nothing stranger than a code is ever
 * put on the wire.
 */
export function startParam(): string | null {
  const signed = webApp()?.initDataUnsafe?.start_param;
  if (signed && REFERRAL_CODE_PATTERN.test(signed)) return signed;

  if (typeof window === 'undefined') return null;
  const fromUrl = new URLSearchParams(window.location.search).get('ref');
  return fromUrl && REFERRAL_CODE_PATTERN.test(fromUrl) ? fromUrl : null;
}

/**
 * Display-only Telegram profile.
 * Explicitly *unsafe* for anything but rendering: the server's copy of the
 * user, derived from the verified payload, is the one that counts.
 */
export function unsafeDisplayUser() {
  return webApp()?.initDataUnsafe?.user ?? null;
}

/**
 * Prepare the WebView.
 *
 * Called once on mount. `expand()` claims the full height so the layout is not
 * fighting a half-height sheet, and the header/background are painted white to
 * match the brand — Telegram would otherwise use the client's own theme colour,
 * which on a dark-mode client puts a dark bar above a white app.
 */
export function initialiseTelegram(): void {
  const app = webApp();
  if (!app) return;

  try {
    app.ready();
    app.expand();
    app.setHeaderColor?.('#ffffff');
    app.setBackgroundColor?.('#ffffff');
    // Telegram's own vertical swipe-to-close competes with scrolling a long
    // task list, so it is disabled where the client supports it.
    app.disableVerticalSwipes?.();
  } catch {
    /* An older client missing a method must not break the app. */
  }
}

export function openExternal(url: string): void {
  const app = webApp();
  if (!app) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    // Telegram links must go through openTelegramLink or they open a browser
    // tab that then bounces back into the app.
    if (/^https?:\/\/t\.me\//.test(url)) app.openTelegramLink(url);
    else app.openLink(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export const haptic = {
  light(): void {
    try {
      webApp()?.HapticFeedback?.impactOccurred?.('light');
    } catch {
      /* ignore */
    }
  },
  success(): void {
    try {
      webApp()?.HapticFeedback?.notificationOccurred?.('success');
    } catch {
      /* ignore */
    }
  },
  error(): void {
    try {
      webApp()?.HapticFeedback?.notificationOccurred?.('error');
    } catch {
      /* ignore */
    }
  },
  selection(): void {
    try {
      webApp()?.HapticFeedback?.selectionChanged?.();
    } catch {
      /* ignore */
    }
  },
};

/**
 * Track Telegram's viewport height and publish it as `--fx-viewport-height`.
 *
 * `100vh` is wrong inside the Telegram WebView: it does not account for the
 * client's own chrome and does not shrink when the keyboard opens, so a fixed
 * bottom element ends up underneath the keyboard. `100dvh` helps in modern
 * browsers but Telegram's reported `viewportStableHeight` is more reliable
 * across its Android client, so both are used — the variable when available,
 * `100dvh` as the CSS fallback.
 */
export function useTelegramViewport(): { height: number | null; expanded: boolean } {
  const [state, setState] = useState<{ height: number | null; expanded: boolean }>({
    height: null,
    expanded: true,
  });

  useEffect(() => {
    const app = webApp();
    if (!app) return;

    const sync = () => {
      const height = app.viewportStableHeight || app.viewportHeight || null;
      setState({ height, expanded: app.isExpanded });
      if (height) {
        document.documentElement.style.setProperty('--fx-viewport-height', `${height}px`);
      }
    };

    sync();
    app.onEvent('viewportChanged', sync);
    return () => app.offEvent('viewportChanged', sync);
  }, []);

  return state;
}

/**
 * Wire Telegram's native back button to a handler.
 * Used by sheets and detail views so the hardware/native back gesture does
 * something sensible instead of closing the whole Mini App.
 */
export function useTelegramBackButton(visible: boolean, onBack: () => void): void {
  useEffect(() => {
    const app = webApp();
    const button = app?.BackButton;
    if (!button) return;

    if (!visible) {
      button.hide();
      return;
    }

    button.onClick(onBack);
    button.show();
    return () => {
      button.offClick(onBack);
      button.hide();
    };
  }, [visible, onBack]);
}
