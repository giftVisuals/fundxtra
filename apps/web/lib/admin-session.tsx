'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Permission, SignupSource, SystemSettings } from '@fundxtra/shared';
import { api, ApiError, setSessionToken, setUnauthenticatedHandler } from './api';
import { initialiseTelegram, insideTelegram, rawInitData } from './telegram';

/**
 * Admin session.
 *
 * Admins authenticate exactly like users — through Telegram — because Telegram
 * identity *is* the identity model. There is no separate admin password, which
 * means there is no separate admin credential to phish or leak.
 *
 * The client never decides who is an admin. It calls /admin/dashboard; if the
 * server returns 403 the console shows a refusal. `permissions` is used only to
 * hide controls the caller cannot use — every one of those endpoints re-checks
 * the permission server-side, so hiding a button is a courtesy, not a control.
 */

export interface AdminStats {
  users: { total: number; active: number; suspended: number; banned: number; newToday: number };
  tasks: { active: number; paused: number; expired: number; pendingSubmissions: number };
  finance: {
    totalBalanceKobo: number;
    totalEarnedKobo: number;
    totalPaidOutKobo: number;
    pendingWithdrawalsKobo: number;
    pendingWithdrawalCount: number;
    activeCampaignBudgetKobo: number;
    activeCampaignRemainingKobo: number;
  };
  referrals: { total: number; qualified: number; pending: number; payoutKobo: number };
  risk: { flaggedUsers: number; highRiskUsers: number };
  /** Signups per channel, from the reserved `?start=` payloads. */
  signupSources?: Partial<Record<SignupSource, number>>;
}

export interface AdminIdentity {
  telegramId: string;
  displayName: string;
  role: string;
  permissions: Permission[];
  isPrimary: boolean;
}

export interface ProviderStatus {
  name: string;
  configured: boolean;
  capabilities: {
    airtime: boolean;
    data: boolean;
    telegramStars: boolean;
    telegramPremium: boolean;
    statusLookup: boolean;
  };
  nasfampay: { implemented: boolean; hasCredentials: boolean; note: string };
}

interface DashboardPayload {
  stats: AdminStats;
  admin: AdminIdentity;
  settings: SystemSettings;
  provider: ProviderStatus;
  environment: { nodeEnv: string; telegramConfigured: boolean; devAuthEnabled: boolean };
}

export type AdminState = 'BOOTING' | 'OUTSIDE_TELEGRAM' | 'FORBIDDEN' | 'READY' | 'ERROR';

interface AdminContextValue {
  state: AdminState;
  data: DashboardPayload | null;
  error: string | null;
  refresh: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminState>('BOOTING');
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await api.get<DashboardPayload>('/admin/dashboard'));
    setState('READY');
  }, []);

  const authenticate = useCallback(async () => {
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

      const auth = await api.post<{ token: string; isAdmin: boolean }>(
        '/auth/telegram',
        { initData },
        { anonymous: true },
      );
      setSessionToken(auth.token);

      if (!auth.isAdmin) {
        setState('FORBIDDEN');
        return;
      }
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setState('FORBIDDEN');
        return;
      }
      setState('ERROR');
      setError(caught instanceof ApiError ? caught.message : 'We could not open the admin panel.');
    }
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Refresh failed.');
    }
  }, [load]);

  useEffect(() => {
    initialiseTelegram();
    setUnauthenticatedHandler(() => {
      setSessionToken(null);
      setState('BOOTING');
      void authenticate();
    });
    void authenticate();
    return () => setUnauthenticatedHandler(null);
  }, [authenticate]);

  const can = useCallback(
    // Optional all the way down: a response missing `admin` would otherwise
    // throw during render and replace the console with a blank error page,
    // which hides the very diagnostics an operator needs. Absent permissions
    // mean "cannot", which is the safe reading anyway — and every one of these
    // endpoints re-checks server-side regardless.
    (permission: Permission) => Boolean(data?.admin?.permissions?.includes(permission)),
    [data],
  );

  const value = useMemo<AdminContextValue>(
    () => ({ state, data, error, refresh, can }),
    [state, data, error, refresh, can],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const context = useContext(AdminContext);
  if (!context) throw new Error('useAdmin must be used inside an AdminProvider');
  return context;
}
