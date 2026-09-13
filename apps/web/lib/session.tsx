'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { DashboardSummary, UserProfile } from '@fundxtra/shared';
import { invalidateResources } from './resource';
import { api, ApiError, setSessionToken, setUnauthenticatedHandler } from './api';
import { initialiseTelegram, insideTelegram, rawInitData, startParam } from './telegram';

/**
 * Mini App session.
 *
 * Owns the whole authentication lifecycle so no screen has to think about it:
 *
 *   BOOTING     -> exchanging Telegram initData for a session
 *   OUTSIDE     -> not running inside Telegram; show the "open in Telegram" screen
 *   NEEDS_PIN   -> first-time user must create a PIN
 *   LOCKED      -> returning user must enter their PIN
 *   READY       -> dashboard is loaded
 *   BLOCKED     -> account suspended or banned
 *   ERROR       -> handshake failed; retryable
 *
 * The token lives in memory only (see `lib/api.ts`), and the *server* decides
 * every state above — the client never infers "I have a PIN" or "I am an
 * admin" from anything it stores locally.
 */

export type SessionState =
  | 'BOOTING'
  | 'OUTSIDE_TELEGRAM'
  | 'NEEDS_PIN'
  | 'LOCKED'
  | 'READY'
  | 'BLOCKED'
  | 'ERROR';

interface AuthResponse {
  token: string;
  expiresAt: string;
  needsPin: boolean;
  pinLocked: boolean;
  lockedUntil: string | null;
  user: UserProfile;
  isAdmin: boolean;
  adminRole: string | null;
}

interface SessionResponse extends DashboardSummary {
  isAdmin: boolean;
  admin: { role: string; displayName: string; permissions: string[] } | null;
  pinVerified: boolean;
}

/**
 * What a failed request should show the user.
 *
 * Carries the code and status alongside the message, because a failure with
 * neither a reference nor a code is unsupportable: a platform 502 during a
 * restart looks exactly like a real application error. The message stays
 * human; the code is one muted line for whoever has to diagnose it.
 */
export interface SessionError {
  message: string;
  requestId?: string | undefined;
  code?: string | undefined;
  status?: number | undefined;
}

function describeFailure(caught: unknown, fallback: string): SessionError {
  if (caught instanceof ApiError) {
    return {
      message: caught.message,
      ...(caught.requestId ? { requestId: caught.requestId } : {}),
      code: caught.code,
      status: caught.status,
    };
  }
  return { message: fallback };
}

export interface SessionContextValue {
  state: SessionState;
  user: UserProfile | null;
  dashboard: DashboardSummary | null;
  isAdmin: boolean;
  adminRole: string | null;
  pinLocked: boolean;
  lockedUntil: string | null;
  error: SessionError | null;
  /** Re-run the Telegram handshake from scratch. */
  reauthenticate: () => Promise<void>;
  /** Called after a PIN is created or verified, with the upgraded token. */
  completePinFlow: (token: string) => Promise<void>;
  /** Re-fetch the dashboard, e.g. after earning a reward. */
  refresh: () => Promise<void>;
  /** Optimistically patch the cached profile after a known balance change. */
  applyBalance: (balanceKobo: number) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>('BOOTING');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [pinLocked, setPinLocked] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);

  /** Guards against two concurrent handshakes on a fast double mount. */
  const handshaking = useRef(false);

  /**
   * Load the dashboard.
   *
   * This request is also the referral qualification trigger on the server: a
   * user with a PIN reaching the dashboard is exactly the moment a pending
   * referral becomes worth ₦100. The client does not implement that rule, it
   * just arrives here.
   */
  const loadDashboard = useCallback(async () => {
    const summary = await api.get<SessionResponse>('/auth/session');
    setDashboard(summary);
    setUser(summary.user);
    setIsAdmin(summary.isAdmin);
    setAdminRole(summary.admin?.role ?? null);
    setState(summary.user.status === 'ACTIVE' ? 'READY' : 'BLOCKED');
  }, []);

  const authenticate = useCallback(async () => {
    if (handshaking.current) return;
    handshaking.current = true;
    setError(null);

    try {
      if (!insideTelegram()) {
        setState('OUTSIDE_TELEGRAM');
        return;
      }

      const initData = rawInitData();
      if (!initData) {
        setState('OUTSIDE_TELEGRAM');
        return;
      }

      const auth = await api.post<AuthResponse>(
        '/auth/telegram',
        // The raw string and the start payload; the server verifies both.
        { initData, ...(startParam() ? { startParam: startParam() } : {}) },
        { anonymous: true },
      );

      setSessionToken(auth.token);
      setUser(auth.user);
      setIsAdmin(auth.isAdmin);
      setAdminRole(auth.adminRole);
      setPinLocked(auth.pinLocked);
      setLockedUntil(auth.lockedUntil);

      if (auth.user.status !== 'ACTIVE') {
        setState('BLOCKED');
        return;
      }
      if (auth.needsPin) {
        setState('NEEDS_PIN');
        return;
      }
      // Has a PIN but this session is not yet PIN-verified.
      setState('LOCKED');
    } catch (caught) {
      setState('ERROR');
      setError(describeFailure(caught, 'We could not open Fundxtra.'));
    } finally {
      handshaking.current = false;
    }
  }, []);

  const completePinFlow = useCallback(
    async (token: string) => {
      setSessionToken(token);
      setPinLocked(false);
      setLockedUntil(null);
      try {
        await loadDashboard();
      } catch (caught) {
        setState('ERROR');
        setError(describeFailure(caught, 'We could not load your dashboard.'));
      }
    },
    [loadDashboard],
  );

  const refresh = useCallback(async () => {
    try {
      await loadDashboard();
    } catch (caught) {
      // A refresh failure keeps the last good data on screen rather than
      // blanking a working dashboard.
      if (caught instanceof ApiError && caught.isAuthError) await authenticate();
    }
  }, [loadDashboard, authenticate]);

  const applyBalance = useCallback((balanceKobo: number) => {
    setUser((current) => (current ? { ...current, balanceKobo } : current));
    setDashboard((current) =>
      current ? { ...current, user: { ...current.user, balanceKobo } } : current,
    );
  }, []);

  useEffect(() => {
    initialiseTelegram();
    setUnauthenticatedHandler(() => {
      setSessionToken(null);
      // Whoever signs in next must not be shown the last account's data.
      invalidateResources();
      setState('BOOTING');
      void authenticate();
    });
    void authenticate();
    return () => setUnauthenticatedHandler(null);
  }, [authenticate]);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      user,
      dashboard,
      isAdmin,
      adminRole,
      pinLocked,
      lockedUntil,
      error,
      reauthenticate: authenticate,
      completePinFlow,
      refresh,
      applyBalance,
    }),
    [
      state, user, dashboard, isAdmin, adminRole, pinLocked, lockedUntil, error,
      authenticate, completePinFlow, refresh, applyBalance,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}

/** For screens that only render once a user exists; narrows away the null. */
export function useCurrentUser(): UserProfile {
  const { user } = useSession();
  if (!user) throw new Error('useCurrentUser used before the session was ready');
  return user;
}
