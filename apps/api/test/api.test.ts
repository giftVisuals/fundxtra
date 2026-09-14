import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { FakeFirestore } from './fake-firestore';

/**
 * End-to-end HTTP tests through the real Express app.
 *
 * These exercise the pieces that unit tests cannot: middleware ordering, the
 * error envelope, and — most importantly — that an unauthenticated or
 * non-admin caller cannot reach a privileged route. A service can be perfectly
 * safe and still be exposed by a router mounted in the wrong order.
 */

const BOT_TOKEN = '7000000000:AAExampleTokenForTestsOnly_not_real_abcd';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-32';
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_BOT_USERNAME = 'fundxtrabot';
process.env.FIREBASE_CLIENT_EMAIL = 'test@fundxtra.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest-key-material-placeholder\n-----END PRIVATE KEY-----';
process.env.PRIMARY_ADMIN_TELEGRAM_ID = '6438544386';

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
  return { ...actual, db: () => store, firestoreAvailable: true, bucket: () => ({}) };
});

vi.mock('../src/lib/telegram-bot', () => ({
  checkChatMembership: async () => ({ state: 'JOINED', status: 'member' }),
  probeChatAccess: async () => ({ ok: true, title: 'Fundxtra Channel', warning: null }),
  notifyUser: async () => true,
  getBotIdentity: async () => null,
}));

const { createApp } = await import('../src/app');
const { signInitData } = await import('../src/lib/telegram-auth');
const { invalidateSettingsCache } = await import('../src/services/settings');

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  for (const path of Object.keys(store.snapshot())) {
    store.commit([{ kind: 'delete', path, data: {} }]);
  }
  // Settings are cached for 15 seconds, which is longer than the whole suite.
  invalidateSettingsCache();
});

/** Flip maintenance mode, the way an admin does from Settings. */
function setMaintenance(on: boolean, message?: string) {
  store.commit([
    {
      kind: 'merge',
      path: 'systemSettings/global',
      data: {
        platform: {
          maintenanceMode: on,
          ...(message ? { maintenanceMessage: message } : {}),
        },
      },
    },
  ]);
  invalidateSettingsCache();
}

function initDataFor(id: number, firstName = 'Gift', username?: string, startParam?: string) {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: firstName, ...(username ? { username } : {}) }),
  };
  if (startParam) fields.start_param = startParam;
  return signInitData(fields, BOT_TOKEN);
}

/** Sign in and return the bearer token plus the auth payload. */
async function signIn(id: number, options: { username?: string; startParam?: string } = {}) {
  const response = await request(app)
    .post('/auth/telegram')
    .send({ initData: initDataFor(id, 'Gift', options.username, options.startParam) });
  expect(response.status).toBe(200);
  return response.body.data as {
    token: string; needsPin: boolean; isAdmin: boolean; adminRole: string | null;
    user: { id: string; referralCode: string; balanceKobo: number };
  };
}

/** Sign in and set a PIN, returning a fully unlocked token. */
async function signInWithPin(id: number, pin = '8351', options: { username?: string; startParam?: string } = {}) {
  const auth = await signIn(id, options);
  const pinResponse = await request(app)
    .post('/auth/pin')
    .set('authorization', `Bearer ${auth.token}`)
    .send({ pin, confirmPin: pin });
  expect(pinResponse.status).toBe(200);
  return { ...auth, token: pinResponse.body.data.token as string };
}

describe('health', () => {
  it('reports readiness without authentication', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.service).toBe('fundxtra-api');
  });
});

describe('Telegram sign-in', () => {
  it('creates the user and asks for a PIN on first contact', async () => {
    const auth = await signIn(555_001, { username: 'newcomer' });

    expect(auth.needsPin).toBe(true);
    expect(auth.isAdmin).toBe(false);
    expect(auth.user.id).toBe('555001');
    expect(auth.user.balanceKobo).toBe(0);
    expect(auth.user.referralCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(auth.token).toBeTruthy();
  });

  it('rejects forged initData', async () => {
    const response = await request(app)
      .post('/auth/telegram')
      .send({ initData: 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=' + 'a'.repeat(64) });

    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    // The user-facing message never leaks the reason.
    expect(response.body.error.message).toBe('Please open Fundxtra from Telegram to continue.');
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('rejects a body that fails schema validation, with field errors', async () => {
    const response = await request(app).post('/auth/telegram').send({});
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.fields).toHaveProperty('initData');
  });

  it('recognises the primary admin from their Telegram id alone', async () => {
    const auth = await signIn(6_438_544_386, { username: 'giftvisuals' });
    expect(auth.isAdmin).toBe(true);
    expect(auth.adminRole).toBe('SUPER_ADMIN');
  });
});

describe('PIN gate', () => {
  it('refuses a weak PIN', async () => {
    const auth = await signIn(555_002);
    const response = await request(app)
      .post('/auth/pin')
      .set('authorization', `Bearer ${auth.token}`)
      .send({ pin: '1234', confirmPin: '1234' });

    expect(response.status).toBe(422);
    expect(response.body.error.fields.pin).toContain('predictable');
  });

  it('refuses mismatched confirmation', async () => {
    const auth = await signIn(555_003);
    const response = await request(app)
      .post('/auth/pin')
      .set('authorization', `Bearer ${auth.token}`)
      .send({ pin: '8351', confirmPin: '8352' });

    expect(response.status).toBe(422);
    expect(response.body.error.fields.confirmPin).toContain('do not match');
  });

  it('blocks a money-moving route until the PIN is verified in this session', async () => {
    const auth = await signIn(555_004);
    // The session from /auth/telegram is not PIN-verified.
    const response = await request(app)
      .post('/wallet/withdrawals')
      .set('authorization', `Bearer ${auth.token}`)
      .send({
        amountKobo: 30_000, bankCode: '058',
        accountNumber: '0123456789', accountName: 'Gift Update', pin: '8351',
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('PIN_REQUIRED');
  });

  it('never returns the PIN or its hash in any response', async () => {
    const auth = await signInWithPin(555_005);
    const session = await request(app).get('/auth/session').set('authorization', `Bearer ${auth.token}`);
    const body = JSON.stringify(session.body);

    expect(body).not.toContain('8351');
    expect(body).not.toContain('scrypt');
    expect(body).not.toContain('pinHash');
  });
});

/**
 * A referral is paid for a user, not for a signup.
 *
 * It used to pay the moment the referred user reached their dashboard — about
 * fifteen seconds after arriving. That made the ₦100 collectable by anybody
 * with a few throwaway Telegram accounts, and unlike the joining bonus it
 * lands on an account that can actually withdraw.
 *
 * It now waits for their first completed task. That does not block a farmer;
 * it makes the cheat cost more than the honest path, because the fake account
 * has to do real work on a real campaign before anyone is paid.
 */
describe('referral qualification over HTTP', () => {
  function seedHonourTask(id: string) {
    store.seed('tasks', id, {
      title: 'Read the announcement', description: 'Open it and read.',
      instructions: ['Open it'], category: 'OTHER', status: 'ACTIVE',
      verification: 'HONOUR', requiresProof: false,
      rewardKobo: 2_000, budgetKobo: 200_000, spentKobo: 0,
      maxCompletions: 100, completionCount: 0, pendingCount: 0, perUserLimit: 1,
      targetUrl: 'https://example.com', telegramChatId: null, telegramChatLabel: null,
      verificationWarning: null, reviewCriteria: null, sponsor: null,
      startsAt: null, endsAt: null, minimumDwellSeconds: 0, sortWeight: 100,
      createdBy: 'admin', createdAt: new Date(), updatedAt: new Date(),
    });
  }

  it('does not pay the referrer for a signup alone', async () => {
    const referrer = await signInWithPin(555_100, '8351', { username: 'referrer' });
    await request(app).get('/auth/session').set('authorization', `Bearer ${referrer.token}`);

    const friend = await signIn(555_101, { username: 'friend', startParam: referrer.user.referralCode });
    const withPin = await request(app)
      .post('/auth/pin')
      .set('authorization', `Bearer ${friend.token}`)
      .send({ pin: '4729', confirmPin: '4729' });

    // Dashboard reached, PIN set — everything the old rule asked for.
    await request(app).get('/auth/session').set('authorization', `Bearer ${withPin.body.data.token}`);

    expect(store.snapshot()['referrals/555101']?.status).toBe('PENDING');
    expect(store.snapshot()['users/555100']?.balanceKobo).toBe(0);
  });

  it('pays the referrer once the friend completes a task', async () => {
    const referrer = await signInWithPin(555_120, '8351');
    await request(app).get('/auth/session').set('authorization', `Bearer ${referrer.token}`);
    seedHonourTask('read-it');

    const friend = await signIn(555_121, { startParam: referrer.user.referralCode });
    const withPin = await request(app)
      .post('/auth/pin')
      .set('authorization', `Bearer ${friend.token}`)
      .send({ pin: '4729', confirmPin: '4729' });
    const friendToken = withPin.body.data.token as string;
    await request(app).get('/auth/session').set('authorization', `Bearer ${friendToken}`);

    const completion = await request(app)
      .post('/tasks/read-it/complete')
      .set('authorization', `Bearer ${friendToken}`)
      .send({ dwellSeconds: 20 });
    expect(completion.status).toBe(200);

    // Fire-and-forget, so it lands a tick after the response.
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(store.snapshot()['referrals/555121']?.status).toBe('QUALIFIED');
    expect(store.snapshot()['users/555120']?.balanceKobo).toBe(10_000);
    expect(store.snapshot()['users/555120']?.qualifiedReferralCount).toBe(1);
  });

  it('pays once, however many tasks the friend completes', async () => {
    const referrer = await signInWithPin(555_130, '8351');
    await request(app).get('/auth/session').set('authorization', `Bearer ${referrer.token}`);
    seedHonourTask('one');
    seedHonourTask('two');

    const friend = await signIn(555_131, { startParam: referrer.user.referralCode });
    const withPin = await request(app)
      .post('/auth/pin')
      .set('authorization', `Bearer ${friend.token}`)
      .send({ pin: '4729', confirmPin: '4729' });
    const friendToken = withPin.body.data.token as string;
    await request(app).get('/auth/session').set('authorization', `Bearer ${friendToken}`);

    for (const taskId of ['one', 'two']) {
      await request(app)
        .post(`/tasks/${taskId}/complete`)
        .set('authorization', `Bearer ${friendToken}`)
        .send({ dwellSeconds: 20 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    expect(store.snapshot()['users/555130']?.balanceKobo).toBe(10_000);
    expect(store.snapshot()['users/555130']?.qualifiedReferralCount).toBe(1);
  });
});

/**
 * Maintenance mode.
 *
 * The switch has to mean the platform is closed, not that a banner appears
 * over a working one. What was shipped first did the opposite: the handshake
 * and the dashboard were mounted ahead of the gate, so a user still signed in
 * and still saw their balance while every panel behind it failed. These pin
 * the lockdown down at the two doors that matter, and pin the admin's way in
 * open — because an outage that also locks out the person who can lift it is
 * an outage nobody can end.
 */
describe('maintenance lockdown', () => {
  it('refuses the handshake for a user, and creates no account', async () => {
    setMaintenance(true, 'Back at 6pm. Your balance is safe.');

    const response = await request(app)
      .post('/auth/telegram')
      .send({ initData: initDataFor(556_001, 'Gift') });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('MAINTENANCE');
    // The admin's own words reach the user, not generic copy.
    expect(response.body.error.message).toBe('Back at 6pm. Your balance is safe.');
    expect(response.body.error.requestId).toBeTruthy();
    // No token, and nothing written: a closed platform does not open accounts.
    expect(response.body.data).toBeUndefined();
    expect(store.snapshot()['users/556001']).toBeUndefined();

    setMaintenance(false);
  });

  it('refuses the dashboard to a user who signed in before the lockdown', async () => {
    // Signed in and unlocked while the platform was open.
    const user = await signInWithPin(556_002);
    expect((await request(app).get('/auth/session').set('authorization', `Bearer ${user.token}`)).status).toBe(200);

    setMaintenance(true);

    const dashboard = await request(app)
      .get('/auth/session')
      .set('authorization', `Bearer ${user.token}`);

    expect(dashboard.status).toBe(503);
    expect(dashboard.body.error.code).toBe('MAINTENANCE');
    // Not one field of the dashboard leaves the server.
    expect(dashboard.body.data).toBeUndefined();

    // And neither does anything else they could reach with that token.
    for (const route of ['/tasks', '/wallet/summary', '/referrals']) {
      const blocked = await request(app).get(route).set('authorization', `Bearer ${user.token}`);
      expect(blocked.status, route).toBe(503);
      expect(blocked.body.error.code, route).toBe('MAINTENANCE');
    }

    setMaintenance(false);
  });

  it('still lets an admin sign in and load their dashboard', async () => {
    setMaintenance(true);

    const response = await request(app)
      .post('/auth/telegram')
      .send({ initData: initDataFor(6_438_544_386, 'Gift', 'giftvisuals') });

    expect(response.status).toBe(200);
    expect(response.body.data.isAdmin).toBe(true);

    const session = await request(app)
      .get('/auth/session')
      .set('authorization', `Bearer ${response.body.data.token}`);
    expect(session.status).toBe(200);
    expect(session.body.data.isAdmin).toBe(true);

    setMaintenance(false);
  });

  it('leaves the admin console reachable so the lockdown can be lifted', async () => {
    const admin = await signInWithPin(6_438_544_386, '8351', { username: 'giftvisuals' });
    setMaintenance(true);

    const dashboard = await request(app)
      .get('/admin/dashboard')
      .set('authorization', `Bearer ${admin.token}`);
    expect(dashboard.status).toBe(200);

    // The switch itself is reachable, which is the whole point.
    const lifted = await request(app)
      .patch('/admin/settings')
      .set('authorization', `Bearer ${admin.token}`)
      .send({ platform: { maintenanceMode: false } });
    expect(lifted.status).toBe(200);

    const user = await request(app)
      .post('/auth/telegram')
      .send({ initData: initDataFor(556_003, 'Gift') });
    expect(user.status).toBe(200);
  });
});

describe('authorisation boundaries', () => {
  const adminRoutes = [
    '/admin/dashboard',
    '/admin/users',
    '/admin/tasks',
    '/admin/submissions',
    '/admin/withdrawals',
    '/admin/settings',
    '/admin/admins',
    '/admin/audit',
    '/admin/security-events',
  ];

  it('rejects every admin route without a session', async () => {
    for (const route of adminRoutes) {
      const response = await request(app).get(route);
      expect(response.status, route).toBe(401);
      expect(response.body.error.code, route).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects every admin route for an ordinary signed-in user', async () => {
    const auth = await signInWithPin(555_200);
    for (const route of adminRoutes) {
      const response = await request(app).get(route).set('authorization', `Bearer ${auth.token}`);
      expect(response.status, route).toBe(403);
      expect(response.body.error.code, route).toBe('FORBIDDEN');
    }
  });

  it('rejects a token signed with a different secret', async () => {
    const response = await request(app)
      .get('/wallet')
      .set('authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.not-a-real-signature');
    expect(response.status).toBe(401);
  });

  it('lets the primary admin reach the admin dashboard', async () => {
    const auth = await signInWithPin(6_438_544_386, '8351', { username: 'giftvisuals' });
    const response = await request(app)
      .get('/admin/dashboard')
      .set('authorization', `Bearer ${auth.token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.admin.role).toBe('SUPER_ADMIN');
    expect(response.body.data.admin.isPrimary).toBe(true);
    // The provider status is surfaced honestly.
    expect(response.body.data.provider.nasfampay.implemented).toBe(false);
  });

  it('stops a moderator from adjusting a balance', async () => {
    const admin = await signInWithPin(6_438_544_386, '8351', { username: 'giftvisuals' });
    const victim = await signInWithPin(555_300);

    // The primary admin adds a moderator by Telegram id.
    const added = await request(app)
      .post('/admin/admins')
      .set('authorization', `Bearer ${admin.token}`)
      .send({ telegramId: '555400', displayName: 'Mod', role: 'MODERATOR', extraPermissions: [] });
    expect(added.status).toBe(201);

    const moderator = await signInWithPin(555_400, '4729', { username: 'mod' });

    const attempt = await request(app)
      .post(`/admin/users/${victim.user.id}/adjust-balance`)
      .set('authorization', `Bearer ${moderator.token}`)
      .send({ amountKobo: 500_000, reason: 'Helping myself to some money' });

    expect(attempt.status).toBe(403);
    expect(store.snapshot()[`users/${victim.user.id}`]?.balanceKobo).toBe(0);
  });

  it('will not let a super admin be granted through the extraPermissions field', async () => {
    const admin = await signInWithPin(6_438_544_386, '8351', { username: 'giftvisuals' });

    await request(app)
      .post('/admin/admins')
      .set('authorization', `Bearer ${admin.token}`)
      .send({
        telegramId: '555500', displayName: 'Sneaky', role: 'MODERATOR',
        extraPermissions: ['admins:manage', 'settings:manage', 'finance:manage'],
      });

    const stored = store.snapshot()['admins/555500'];
    expect(stored?.extraPermissions).toEqual([]);
  });
});

describe('admin balance adjustment', () => {
  it('moves the balance and writes an audit record with the reason', async () => {
    const admin = await signInWithPin(6_438_544_386, '8351', { username: 'giftvisuals' });
    const user = await signInWithPin(555_600);

    const response = await request(app)
      .post(`/admin/users/${user.user.id}/adjust-balance`)
      .set('authorization', `Bearer ${admin.token}`)
      .send({ amountKobo: 250_000, reason: 'Goodwill credit after a failed airtime top-up' });

    expect(response.status).toBe(200);
    expect(response.body.data.balanceAfterKobo).toBe(250_000);
    expect(store.snapshot()[`users/${user.user.id}`]?.balanceKobo).toBe(250_000);

    const audit = Object.entries(store.snapshot()).find(
      ([path, data]) => path.startsWith('auditLogs/') && data.action === 'BALANCE_ADJUSTED',
    );
    expect(audit).toBeDefined();
    expect(audit?.[1]?.reason).toContain('Goodwill credit');
    expect(audit?.[1]?.actorId).toBe('6438544386');
    expect(audit?.[1]?.before).toEqual({ balanceKobo: 0 });
    expect(audit?.[1]?.after).toEqual({ balanceKobo: 250_000 });
  });

  it('refuses an adjustment with no reason', async () => {
    const admin = await signInWithPin(6_438_544_386, '8351', { username: 'giftvisuals' });
    const user = await signInWithPin(555_601);

    const response = await request(app)
      .post(`/admin/users/${user.user.id}/adjust-balance`)
      .set('authorization', `Bearer ${admin.token}`)
      .send({ amountKobo: 250_000, reason: 'oops' });

    expect(response.status).toBe(422);
    expect(store.snapshot()[`users/${user.user.id}`]?.balanceKobo).toBe(0);
  });
});

describe('public endpoints', () => {
  it('serves platform config without a session', async () => {
    const response = await request(app).get('/public/config');
    expect(response.status).toBe(200);
    expect(response.body.data.brand.name).toBe('Fundxtra');
    expect(response.body.data.brand.supportHandle).toBe('@fundxtracarebot');
    // Carries the website attribution, which is how signups from the public
    // site are counted without guessing.
    expect(response.body.data.startEarningUrl).toBe(
      'https://t.me/fundxtrabot?start=website',
    );
    expect(response.body.data.referral.rewardKobo).toBe(10_000);
    expect(response.body.data.maxTaskRewardKobo).toBe(100_000);
    // Rewards default to off until a provider exists.
    expect(response.body.data.rewards.airtime).toBe(false);
    expect(response.body.data.pricing.telegramStars).toHaveLength(5);
  });

  it('reports insufficient data rather than inventing statistics', async () => {
    const response = await request(app).get('/public/stats');
    expect(response.status).toBe(200);
    expect(response.body.data.stats.sufficientData).toBe(false);
    expect(response.body.data.stats.totalUsers).toBe(0);
    expect(response.body.data.stats.totalPaidOutKobo).toBe(0);
  });
});

describe('unknown routes', () => {
  it('returns the standard error envelope, not an HTML page', async () => {
    const response = await request(app).get('/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
