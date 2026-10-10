import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Timestamp } from 'firebase-admin/firestore';
import { FakeFirestore } from './fake-firestore';

/**
 * What a user costs.
 *
 * One user browsing a little generated 966 Firestore reads and 465 writes.
 * Almost none of that was anything the user did — it was the same unchanging
 * data re-read per request, and bookkeeping writes firing per request.
 *
 * These tests count. An estimate of how much a request costs drifts the moment
 * somebody adds a query; a number asserted in a test does not. They are
 * deliberately about *shape* rather than exact figures: the task list must not
 * get more expensive as users are added, an admin clicking around must not
 * write per click, and one screen's parallel calls must not each pay for the
 * same document.
 */

const BOT_TOKEN = '7000000000:AAExampleTokenForTestsOnly_not_real_abcd';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-32';
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_BOT_USERNAME = 'fundxtrabot';
process.env.FIREBASE_CLIENT_EMAIL = 'test@fundxtra.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
process.env.PRIMARY_ADMIN_TELEGRAM_ID = '6438544386';

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
  return { ...actual, db: () => store, firestoreAvailable: true, bucket: () => ({}) };
});

vi.mock('../src/lib/telegram-bot', () => ({
  checkChatMembership: async () => ({ state: 'JOINED', status: 'member' }),
  probeChatAccess: async () => ({ ok: true, title: 'Channel', warning: null }),
  notifyUser: async () => true,
  getBotIdentity: async () => null,
  sendBotMessage: async () => true,
  sendBotPhoto: async () => ({ message_id: 1 }),
}));

const { createApp } = await import('../src/app');
const { signInitData } = await import('../src/lib/telegram-auth');
const { invalidateTaskCache } = await import('../src/services/tasks');
const { clearUserCache } = await import('../src/services/users');
const { flushStats } = await import('../src/services/stats');
const { rateLimiter } = await import('../src/lib/rate-limit');

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  for (const path of Object.keys(store.snapshot())) {
    store.commit([{ kind: 'delete', path, data: {} }]);
  }
  invalidateTaskCache();
  clearUserCache();
  // These tests sign in far more often than a person would, and the auth
  // limiter is per IP — without this they throttle each other.
  rateLimiter.resetAll();
  await flushStats();
});

function initDataFor(id: number) {
  return signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id, first_name: 'Gift' }),
    },
    BOT_TOKEN,
  );
}

async function signIn(id: number) {
  const response = await request(app).post('/auth/telegram').send({ initData: initDataFor(id) });
  expect(response.status).toBe(200);
  return (response.body.data as { token: string }).token;
}

/** Signed in and PIN-verified, which anything that moves money requires. */
async function signInWithPin(id: number) {
  const token = await signIn(id);
  const unlocked = await request(app)
    .post('/auth/pin')
    .set('authorization', `Bearer ${token}`)
    .send({ pin: '8351', confirmPin: '8351' });
  expect(unlocked.status).toBe(200);
  return (unlocked.body.data as { token: string }).token;
}

function seedTasks(count: number) {
  for (let index = 0; index < count; index += 1) {
    store.seed('tasks', `task-${String(index)}`, {
      title: `Campaign ${String(index)}`,
      description: 'Do the thing',
      instructions: 'Do the thing',
      type: 'LINK_VISIT',
      verification: 'HONOUR',
      status: 'ACTIVE',
      rewardKobo: 5_000,
      budgetKobo: 5_000_000,
      spentKobo: 0,
      maxCompletions: 1_000,
      completionCount: 0,
      perUserLimit: 1,
      pendingCount: 0,
      targetUrl: 'https://example.com',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      startsAt: null,
      endsAt: null,
    });
  }
}

describe('the task list', () => {
  it('does not get more expensive as more users ask for it', async () => {
    seedTasks(20);
    const tokens: string[] = [];
    for (let index = 0; index < 25; index += 1) tokens.push(await signIn(900_100 + index));

    store.resetMetrics();
    for (const token of tokens) {
      const response = await request(app).get('/tasks').set('authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      expect(response.body.data.tasks).toHaveLength(20);
    }

    /*
      Read per request, twenty campaigns cost twenty reads each: 25 users would
      be 500 reads for the campaign documents alone, plus the sweep. Shared,
      the campaigns are read once and each user pays only for their own state.
    */
    expect(store.metrics.reads).toBeLessThan(150);
  });

  it('shows an admin’s edit immediately rather than when the cache expires', async () => {
    seedTasks(1);
    const token = await signIn(900_200);

    const before = await request(app).get('/tasks').set('authorization', `Bearer ${token}`);
    expect(before.body.data.tasks).toHaveLength(1);

    // Straight to the store, then the invalidation the write paths perform.
    store.seed('tasks', 'task-0', {
      ...store.snapshot()['tasks/task-0'],
      status: 'PAUSED',
    });
    invalidateTaskCache();

    const after = await request(app).get('/tasks').set('authorization', `Bearer ${token}`);
    expect(after.body.data.tasks).toHaveLength(0);
  });
});

describe('one screen firing several calls at once', () => {
  it('pays for the user document once, not once per call', async () => {
    const token = await signIn(900_300);
    clearUserCache();
    store.resetMetrics();

    // What the wallet screen does on open.
    await Promise.all([
      request(app).get('/wallet').set('authorization', `Bearer ${token}`),
      request(app).get('/wallet/transactions?limit=20').set('authorization', `Bearer ${token}`),
      request(app).get('/wallet/withdrawals').set('authorization', `Bearer ${token}`),
    ]);

    /*
      Three reads for the whole screen: the user document once, then one query
      each for the history and the withdrawal list. Without the shared read the
      user document is fetched three times over, because all three requests
      miss an empty cache at the same instant.
    */
    expect(store.metrics.reads).toBeLessThanOrEqual(3);
  });
});

describe('a request that changes something', () => {
  it('reads the balance fresh rather than from cache', async () => {
    const token = await signIn(900_400);

    // Warm the cache with a GET.
    await request(app).get('/wallet').set('authorization', `Bearer ${token}`);

    // Change the balance underneath, the way another process would.
    const existing = store.snapshot()['users/900400'];
    store.seed('users', '900400', { ...existing, balanceKobo: 777_000 });

    // A non-GET must not be served the stale document: withdrawals are closed
    // by default, so this is refused — but on the *fresh* balance, and the
    // proof is that the next GET sees the new number rather than the cached one.
    await request(app)
      .post('/wallet/withdrawals')
      .set('authorization', `Bearer ${token}`)
      .send({ amountKobo: 50_000, bankCode: '058', accountNumber: '0123456789', accountName: 'Gift', pin: '8351' });

    const after = await request(app).get('/wallet').set('authorization', `Bearer ${token}`);
    expect(after.body.data.balanceKobo).toBe(777_000);
  });
});

describe('an admin clicking around the console', () => {
  it('does not write a row per request', async () => {
    const token = await signIn(6_438_386);
    const adminToken = await signIn(6_438_544_386);
    expect(token).toBeTruthy();

    // One request to get the throttles past their first claim.
    await request(app).get('/admin/dashboard').set('authorization', `Bearer ${adminToken}`);
    await flushStats();
    store.resetMetrics();

    for (let index = 0; index < 15; index += 1) {
      await request(app).get('/admin/dashboard').set('authorization', `Bearer ${adminToken}`);
    }
    await flushStats();

    /*
      Every one of these used to write twice — "the primary admin record
      exists" and "this admin was active" — so fifteen page loads wrote thirty
      rows saying nothing had changed.
    */
    expect(store.metrics.writes).toBe(0);
  });
});

describe('a full app open', () => {
  it('stays inside a read budget per screen', async () => {
    seedTasks(12);
    const token = await signIn(900_500);

    // Warm the shared campaign cache, as any real traffic would have.
    const other = await signIn(900_501);
    await request(app).get('/tasks').set('authorization', `Bearer ${other}`);

    /*
      Measured per screen from a cold user cache, so each figure includes the
      one user-document read every authenticated request makes.

      The budgets are what the screens cost today, asserted so they cannot
      quietly grow again: adding a query to a hot path should have to be a
      decision, not an accident. Raise a number here only with the reason
      written down.
    */
    const budgets: [string, number][] = [
      // One read for the user, two for the per-user task state behind the
      // "waiting on review" badge — which the Earn tab then reuses for free.
      ['/auth/session', 3],
      ['/tasks', 3],
      ['/referrals', 3],
      ['/wallet', 1],
      ['/wallet/transactions?limit=20', 2],
      ['/wallet/withdrawals', 2],
    ];

    for (const [path, budget] of budgets) {
      clearUserCache();
      store.resetMetrics();
      const response = await request(app).get(path).set('authorization', `Bearer ${token}`);
      expect(response.status, path).toBe(200);
      expect(store.metrics.reads, `${path} reads`).toBeLessThanOrEqual(budget);
    }
  });

  it('costs no writes at all to look around', async () => {
    seedTasks(3);
    const token = await signIn(900_600);
    // The signup itself writes; after that, reading must not.
    await request(app).get('/auth/session').set('authorization', `Bearer ${token}`);
    await flushStats();
    store.resetMetrics();

    for (const path of ['/auth/session', '/tasks', '/referrals', '/wallet']) {
      await request(app).get(path).set('authorization', `Bearer ${token}`);
    }
    await flushStats();

    // Opening the app used to write a SESSION_ISSUED row every single time.
    expect(store.metrics.writes).toBe(0);
  });
});

/**
 * What a working day costs.
 *
 * Browsing was brought down first; this is about the part that was left —
 * what it costs when somebody actually *uses* the platform. Two defects hid
 * here, and both had the same shape: a cost that grew with how much a user
 * had earned.
 *
 *  - The dashboard summed today's credits by reading every one of them, so
 *    twenty completed tasks meant twenty-plus reads on every refresh.
 *  - The task list read the user's entire completion history on every open,
 *    forever.
 *
 * Both are gone. The numbers below are asserted so they cannot come back, and
 * the writes are asserted too — those are the floor, and the comments say why
 * each one exists.
 */
describe('what a heavy day costs', () => {
  function seedTelegramTask(id: string) {
    store.seed('tasks', id, {
      title: `Task ${id}`, description: 'Join the channel and come back.',
      instructions: ['Join'], category: 'TELEGRAM', status: 'ACTIVE',
      verification: 'TELEGRAM_MEMBERSHIP', requiresProof: false,
      rewardKobo: 1_000, budgetKobo: 1_000_000, spentKobo: 0,
      maxCompletions: 500, completionCount: 0, pendingCount: 0, perUserLimit: 1,
      targetUrl: null, telegramChatId: '@fundxtra', telegramChatLabel: 'Fundxtra',
      verificationWarning: null, reviewCriteria: null, sponsor: null,
      startsAt: null, endsAt: null, minimumDwellSeconds: 0, sortWeight: 100,
      createdBy: 'admin', createdAt: new Date(), updatedAt: new Date(),
    });
  }

  it('charges a fixed price per completion, however many came before', async () => {
    const token = await signInWithPin(910_100);
    for (let index = 0; index < 12; index += 1) seedTelegramTask(`c${String(index)}`);
    invalidateTaskCache();
    await request(app).get('/tasks').set('authorization', `Bearer ${token}`);

    const costs: { reads: number; writes: number }[] = [];
    for (let index = 0; index < 12; index += 1) {
      store.resetMetrics();
      const response = await request(app)
        .post(`/tasks/c${String(index)}/complete`)
        .set('authorization', `Bearer ${token}`)
        .send({ dwellSeconds: 5 });
      expect(response.status, `completion ${String(index)}`).toBe(200);
      costs.push({ ...store.metrics });
    }

    /*
      Four reads: the user document the request authenticates with, then the
      three the money transaction needs — the campaign, the idempotency key,
      and the user's balance. The task itself is served from the shared
      campaign cache, and the duplicate check was removed because the
      transaction's own completion document already refuses a second one.

      Five writes, and each is a different fact that has to survive a crash:
      the campaign's spent budget, the ledger entry, the idempotency key that
      makes paying twice impossible, the user's balance and counters (one
      update, not two), and the completion record that stops them claiming it
      again. There is no sixth, and none of the five can be dropped without
      giving up a guarantee about money.
    */
    for (const [index, cost] of costs.entries()) {
      expect(cost.reads, `completion ${String(index)} reads`).toBeLessThanOrEqual(4);
      expect(cost.writes, `completion ${String(index)} writes`).toBeLessThanOrEqual(5);
    }

    // The last one costs exactly what the first one did.
    expect(costs.at(-1)).toEqual(costs[0]);
  });

  it('does not make the dashboard more expensive for someone who earned a lot', async () => {
    const token = await signInWithPin(910_200);
    for (let index = 0; index < 15; index += 1) seedTelegramTask(`d${String(index)}`);
    invalidateTaskCache();

    store.resetMetrics();
    await request(app).get('/auth/session').set('authorization', `Bearer ${token}`);
    const fresh = store.metrics.reads;

    for (let index = 0; index < 15; index += 1) {
      await request(app)
        .post(`/tasks/d${String(index)}/complete`)
        .set('authorization', `Bearer ${token}`)
        .send({ dwellSeconds: 5 });
    }

    clearUserCache();
    store.resetMetrics();
    await request(app).get('/auth/session').set('authorization', `Bearer ${token}`);

    /*
      The same price after fifteen rewards as before the first. Today's
      earnings are kept on the user document by the ledger as it credits, so
      the dashboard no longer reads the credits back to add them up.
    */
    expect(store.metrics.reads).toBeLessThanOrEqual(fresh + 1);
    expect(store.metrics.writes).toBe(0);
  });

  it('serves a repeated task list for nothing at all', async () => {
    const token = await signInWithPin(910_300);
    for (let index = 0; index < 10; index += 1) seedTelegramTask(`e${String(index)}`);
    invalidateTaskCache();

    await request(app).get('/tasks').set('authorization', `Bearer ${token}`);

    /*
      The Mini App reloads this every time it comes back to the foreground,
      and the answer does not change until the user does something. The second
      and third looks are free.
    */
    for (const attempt of [1, 2]) {
      store.resetMetrics();
      await request(app).get('/tasks').set('authorization', `Bearer ${token}`);
      expect(store.metrics.reads, `look ${String(attempt)}`).toBe(0);
      expect(store.metrics.writes, `look ${String(attempt)}`).toBe(0);
    }
  });

  it('shows a completed task as completed the moment it is completed', async () => {
    const token = await signInWithPin(910_400);
    seedTelegramTask('f0');
    invalidateTaskCache();

    const before = await request(app).get('/tasks').set('authorization', `Bearer ${token}`);
    expect(before.body.data.tasks[0].userState).toBe('AVAILABLE');

    await request(app)
      .post('/tasks/f0/complete')
      .set('authorization', `Bearer ${token}`)
      .send({ dwellSeconds: 5 });

    // The cache above must not be allowed to answer this.
    const after = await request(app).get('/tasks').set('authorization', `Bearer ${token}`);
    expect(after.body.data.tasks[0].userState).toBe('COMPLETED');
  });
});
