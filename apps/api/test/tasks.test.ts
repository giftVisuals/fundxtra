import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeFirestore } from './fake-firestore';

/**
 * Task engine integrity.
 *
 * The questions under test: can a user be paid twice for one task, can a
 * campaign overspend its budget, does a task stop itself when the money runs
 * out, and does a manual task ever credit before an admin approves it.
 */

const store = new FakeFirestore();

vi.mock('../src/lib/firebase', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/firebase')>('../src/lib/firebase');
  return { ...actual, db: () => store, firestoreAvailable: true };
});

vi.mock('../src/services/settings', () => ({
  getSettings: async () => ({
    tasks: { maxRewardKobo: 100_000, earningEnabled: true },
    referrals: { enabled: true, rewardKobo: 10_000 },
    platform: { botUsername: 'fundxtrabot' },
    withdrawals: {},
    rewards: {},
  }),
  withdrawalAvailability: () => ({ open: false, reason: null, opensAt: null }),
}));

// Telegram membership is stubbed so the engine can be tested without network.
const membership = vi.fn();
vi.mock('../src/lib/telegram-bot', () => ({
  checkChatMembership: (...args: unknown[]) => membership(...args),
  probeChatAccess: async () => ({ ok: true, title: 'Fundxtra Channel', warning: null }),
  notifyUser: async () => true,
  getBotIdentity: async () => null,
}));

const { completeTask, reviewSubmission } = await import('../src/services/completions');
const {
  taskAvailability,
  budgetView,
  mapTask,
  topUpBudget,
  updateTask,
  listTasksForUser,
} = await import('../src/services/tasks');
const { mapUser } = await import('../src/services/users');

function seedUser(id: string, overrides: Record<string, unknown> = {}) {
  store.seed('users', id, {
    telegramId: id, firstName: `User ${id}`, username: `user${id}`, status: 'ACTIVE',
    hasPin: true, onboardedAt: new Date().toISOString(), balanceKobo: 0,
    lifetimeEarnedKobo: 0, lifetimePaidOutKobo: 0, tasksCompleted: 0,
    referralCode: `CODE${id}`, referredBy: null, referralCount: 0,
    qualifiedReferralCount: 0, referralEarningsKobo: 0, riskScore: 0, flags: [],
    ...overrides,
  });
}

/** A ₦150 reward on a ₦450 budget: exactly three completions available. */
function seedTask(id: string, overrides: Record<string, unknown> = {}) {
  store.seed('tasks', id, {
    title: 'Join the Fundxtra channel',
    description: 'Join and stay joined.',
    instructions: ['Open the link', 'Tap Join'],
    category: 'TELEGRAM',
    status: 'ACTIVE',
    rewardKobo: 15_000,
    budgetKobo: 45_000,
    spentKobo: 0,
    maxCompletions: 3,
    completionCount: 0,
    pendingCount: 0,
    perUserLimit: 1,
    verification: 'TELEGRAM_MEMBERSHIP',
    requiresProof: false,
    targetUrl: 'https://t.me/fundxtra',
    telegramChatId: '@fundxtra',
    telegramChatLabel: 'Fundxtra Channel',
    verificationWarning: null,
    sponsor: null,
    startsAt: null,
    endsAt: null,
    minimumDwellSeconds: 0,
    sortWeight: 100,
    createdBy: '6438544386',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function user(id: string) {
  return mapUser(id, store.snapshot()[`users/${id}`]!);
}

function task(id: string) {
  return mapTask(id, store.snapshot()[`tasks/${id}`]!);
}

beforeEach(() => {
  for (const path of Object.keys(store.snapshot())) {
    store.commit([{ kind: 'delete', path, data: {} }]);
  }
  store.transactionAttempts = 0;
  membership.mockReset();
  membership.mockResolvedValue({ state: 'JOINED', status: 'member' });
});

describe('availability and budget arithmetic', () => {
  it('reports a fresh active task as available', () => {
    seedTask('t1');
    expect(taskAvailability(task('t1')).available).toBe(true);
  });

  it('is unavailable when paused, not started, or ended', () => {
    seedTask('paused', { status: 'PAUSED' });
    expect(taskAvailability(task('paused'))).toEqual({ available: false, reason: 'NOT_ACTIVE' });

    seedTask('future', { startsAt: new Date(Date.now() + 86_400_000) });
    expect(taskAvailability(task('future'))).toEqual({ available: false, reason: 'NOT_STARTED' });

    seedTask('past', { endsAt: new Date(Date.now() - 86_400_000) });
    expect(taskAvailability(task('past'))).toEqual({ available: false, reason: 'ENDED' });
  });

  it('is unavailable when the remaining budget cannot fund another reward', () => {
    seedTask('t1', { spentKobo: 40_000, completionCount: 2 });
    expect(taskAvailability(task('t1'))).toEqual({
      available: false,
      reason: 'BUDGET_EXHAUSTED',
    });
  });

  it('counts pending submissions as claimed against the completion cap', () => {
    seedTask('t1', { completionCount: 1, pendingCount: 2, spentKobo: 45_000 });
    expect(taskAvailability(task('t1'))).toEqual({
      available: false,
      reason: 'COMPLETIONS_EXHAUSTED',
    });
  });

  it('exposes a budget view matching the spec example shape', () => {
    seedTask('t1', { rewardKobo: 15_000, budgetKobo: 5_000_000, spentKobo: 1_855_000, completionCount: 123, maxCompletions: 333 });
    const view = budgetView(task('t1'));
    expect(view.rewardKobo).toBe(15_000);
    expect(view.budgetKobo).toBe(5_000_000);
    expect(view.remainingKobo).toBe(3_145_000);
    expect(view.completionCount).toBe(123);
    expect(view.maxCompletions).toBe(333);
    expect(view.percentClaimed).toBeCloseTo(37.1, 1);
  });
});

describe('automatic Telegram verification', () => {
  it('credits the reward when the bot confirms membership', async () => {
    seedUser('200');
    seedTask('t1');

    const outcome = await completeTask({ user: user('200'), taskId: 't1' });

    expect(outcome.state).toBe('CREDITED');
    expect(outcome.rewardKobo).toBe(15_000);
    expect(outcome.remainingBudgetKobo).toBe(30_000);

    const snapshot = store.snapshot();
    expect(snapshot['users/200']?.balanceKobo).toBe(15_000);
    expect(snapshot['users/200']?.tasksCompleted).toBe(1);
    expect(snapshot['tasks/t1']?.spentKobo).toBe(15_000);
    expect(snapshot['tasks/t1']?.completionCount).toBe(1);
    expect(snapshot['taskCompletions/200__t1']).toBeDefined();
    expect(membership).toHaveBeenCalledWith('@fundxtra', '200');
  });

  it('refuses and credits nothing when the user has not joined', async () => {
    seedUser('200');
    seedTask('t1');
    membership.mockResolvedValue({ state: 'NOT_JOINED', status: 'left' });

    await expect(completeTask({ user: user('200'), taskId: 't1' })).rejects.toMatchObject({
      code: 'VERIFICATION_FAILED',
    });

    expect(store.snapshot()['users/200']?.balanceKobo).toBe(0);
    expect(store.snapshot()['tasks/t1']?.spentKobo).toBe(0);
    expect(store.countIn('taskCompletions')).toBe(0);
  });

  it('never credits on a bot misconfiguration, and records the warning for the admin', async () => {
    seedUser('200');
    seedTask('t1');
    membership.mockResolvedValue({
      state: 'CONFIGURATION_ERROR',
      adminMessage: 'The Fundxtra bot must be an administrator of this chat to read its member list.',
    });

    await expect(completeTask({ user: user('200'), taskId: 't1' })).rejects.toMatchObject({
      code: 'VERIFICATION_UNAVAILABLE',
    });

    expect(store.snapshot()['users/200']?.balanceKobo).toBe(0);
    expect(store.snapshot()['tasks/t1']?.verificationWarning).toContain('administrator');
  });

  it('treats an unreachable Telegram as retryable, not as a failure to credit', async () => {
    seedUser('200');
    seedTask('t1');
    membership.mockResolvedValue({ state: 'UNAVAILABLE', adminMessage: 'Request to Telegram timed out' });

    await expect(completeTask({ user: user('200'), taskId: 't1' })).rejects.toMatchObject({
      code: 'VERIFICATION_UNAVAILABLE',
    });
    expect(store.countIn('taskCompletions')).toBe(0);
  });
});

describe('duplicate completion is impossible', () => {
  it('rejects a second attempt at the same task', async () => {
    seedUser('200');
    seedTask('t1');

    await completeTask({ user: user('200'), taskId: 't1' });
    await expect(completeTask({ user: user('200'), taskId: 't1' })).rejects.toMatchObject({
      code: 'TASK_ALREADY_COMPLETED',
    });

    expect(store.snapshot()['users/200']?.balanceKobo).toBe(15_000);
    expect(store.countIn('transactions')).toBe(1);
    expect(store.snapshot()['tasks/t1']?.spentKobo).toBe(15_000);
  });

  it('pays once when the same user fires two requests concurrently', async () => {
    seedUser('200');
    seedTask('t1');

    const results = await Promise.allSettled([
      completeTask({ user: user('200'), taskId: 't1' }),
      completeTask({ user: user('200'), taskId: 't1' }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(store.snapshot()['users/200']?.balanceKobo).toBe(15_000);
    expect(store.countIn('transactions')).toBe(1);
    expect(store.snapshot()['tasks/t1']?.completionCount).toBe(1);
    expect(store.snapshot()['tasks/t1']?.spentKobo).toBe(15_000);
  });
});

describe('budget exhaustion', () => {
  it('stops the campaign once the budget is spent, and pays no more', async () => {
    seedTask('t1');
    for (const id of ['201', '202', '203', '204']) seedUser(id);

    // Three rewards fit in the ₦450 budget.
    await completeTask({ user: user('201'), taskId: 't1' });
    await completeTask({ user: user('202'), taskId: 't1' });
    await completeTask({ user: user('203'), taskId: 't1' });

    const snapshot = store.snapshot();
    expect(snapshot['tasks/t1']?.spentKobo).toBe(45_000);
    expect(snapshot['tasks/t1']?.completionCount).toBe(3);
    // The task closed itself rather than waiting to overspend.
    expect(snapshot['tasks/t1']?.status).toBe('COMPLETED');

    await expect(completeTask({ user: user('204'), taskId: 't1' })).rejects.toMatchObject({
      code: 'TASK_BUDGET_EXHAUSTED',
    });
    expect(store.snapshot()['users/204']?.balanceKobo).toBe(0);
    expect(store.snapshot()['tasks/t1']?.spentKobo).toBe(45_000);
  });

  it('cannot overspend when more users race for the last reward than it can fund', async () => {
    // Budget for exactly one reward, five users going for it at once.
    seedTask('t1', { budgetKobo: 15_000, maxCompletions: 1 });
    const ids = ['301', '302', '303', '304', '305'];
    for (const id of ids) seedUser(id);

    const results = await Promise.allSettled(
      ids.map((id) => completeTask({ user: user(id), taskId: 't1' })),
    );

    const credited = results.filter((result) => result.status === 'fulfilled');
    expect(credited).toHaveLength(1);

    const snapshot = store.snapshot();
    expect(snapshot['tasks/t1']?.spentKobo).toBe(15_000);
    expect(snapshot['tasks/t1']?.completionCount).toBe(1);
    expect(store.countIn('transactions')).toBe(1);

    const totalPaid = ids.reduce(
      (sum, id) => sum + ((snapshot[`users/${id}`]?.balanceKobo as number) ?? 0),
      0,
    );
    expect(totalPaid).toBe(15_000);
  });
});

describe('manual screenshot review', () => {
  it('requires proof and credits nothing on submission', async () => {
    seedUser('200');
    seedTask('t1', { verification: 'SCREENSHOT', requiresProof: true, telegramChatId: null });

    await expect(completeTask({ user: user('200'), taskId: 't1' })).rejects.toMatchObject({
      code: 'TASK_PROOF_REQUIRED',
    });

    const outcome = await completeTask({
      user: user('200'), taskId: 't1', proofPath: 'proofs/200/t1.png',
    });

    expect(outcome.state).toBe('PENDING_REVIEW');
    expect(outcome.submissionId).toBeDefined();

    const snapshot = store.snapshot();
    // No money moved, but the budget is held so it cannot be double-promised.
    expect(snapshot['users/200']?.balanceKobo).toBe(0);
    expect(store.countIn('transactions')).toBe(0);
    expect(snapshot['tasks/t1']?.pendingCount).toBe(1);
    expect(snapshot['tasks/t1']?.spentKobo).toBe(15_000);
    expect(snapshot[`taskSubmissions/${outcome.submissionId}`]?.status).toBe('PENDING_REVIEW');
    expect(snapshot[`taskSubmissions/${outcome.submissionId}`]?.proofPath).toBe('proofs/200/t1.png');
  });

  it('credits on approval and records the reviewer', async () => {
    seedUser('200');
    seedTask('t1', { verification: 'SCREENSHOT', requiresProof: true, telegramChatId: null });
    const submitted = await completeTask({
      user: user('200'), taskId: 't1', proofPath: 'proofs/200/t1.png',
    });

    const review = await reviewSubmission({
      submissionId: submitted.submissionId!,
      decision: 'APPROVE',
      reviewerId: '6438544386',
    });

    expect(review.status).toBe('APPROVED');
    const snapshot = store.snapshot();
    expect(snapshot['users/200']?.balanceKobo).toBe(15_000);
    expect(snapshot['users/200']?.tasksCompleted).toBe(1);
    expect(snapshot['tasks/t1']?.pendingCount).toBe(0);
    expect(snapshot['tasks/t1']?.completionCount).toBe(1);
    // The spend was already reserved, so approving must not double-count it.
    expect(snapshot['tasks/t1']?.spentKobo).toBe(15_000);
    expect(snapshot[`taskSubmissions/${submitted.submissionId}`]?.reviewedBy).toBe('6438544386');
    expect(snapshot['taskCompletions/200__t1']).toBeDefined();
  });

  it('releases the budget on rejection and keeps the reason for the user', async () => {
    seedUser('200');
    seedTask('t1', { verification: 'SCREENSHOT', requiresProof: true, telegramChatId: null });
    const submitted = await completeTask({
      user: user('200'), taskId: 't1', proofPath: 'proofs/200/t1.png',
    });

    const review = await reviewSubmission({
      submissionId: submitted.submissionId!,
      decision: 'REJECT',
      reason: 'The screenshot shows a different channel',
      reviewerId: '6438544386',
    });

    expect(review.status).toBe('REJECTED');
    const snapshot = store.snapshot();
    expect(snapshot['users/200']?.balanceKobo).toBe(0);
    expect(snapshot['tasks/t1']?.spentKobo).toBe(0);
    expect(snapshot['tasks/t1']?.pendingCount).toBe(0);
    expect(snapshot[`taskSubmissions/${submitted.submissionId}`]?.rejectionReason).toContain(
      'different channel',
    );
    expect(store.countIn('taskCompletions')).toBe(0);
  });

  it('refuses to review the same submission twice, so a double-click cannot pay twice', async () => {
    seedUser('200');
    seedTask('t1', { verification: 'SCREENSHOT', requiresProof: true, telegramChatId: null });
    const submitted = await completeTask({
      user: user('200'), taskId: 't1', proofPath: 'proofs/200/t1.png',
    });

    await reviewSubmission({
      submissionId: submitted.submissionId!, decision: 'APPROVE', reviewerId: '6438544386',
    });
    await expect(
      reviewSubmission({
        submissionId: submitted.submissionId!, decision: 'APPROVE', reviewerId: '6438544386',
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_REQUEST' });

    expect(store.snapshot()['users/200']?.balanceKobo).toBe(15_000);
    expect(store.countIn('transactions')).toBe(1);
  });

  it('blocks a second submission while one is already queued', async () => {
    seedUser('200');
    seedTask('t1', { verification: 'SCREENSHOT', requiresProof: true, telegramChatId: null });

    await completeTask({ user: user('200'), taskId: 't1', proofPath: 'a.png' });
    await expect(
      completeTask({ user: user('200'), taskId: 't1', proofPath: 'b.png' }),
    ).rejects.toMatchObject({ code: 'TASK_ALREADY_COMPLETED' });

    expect(store.countIn('taskSubmissions')).toBe(1);
    expect(store.snapshot()['tasks/t1']?.spentKobo).toBe(15_000);
  });

  it('reactivates a campaign that paused only because of a pending submission', async () => {
    seedUser('200');
    // Budget for one reward; the submission fills it and closes the task.
    seedTask('t1', {
      verification: 'SCREENSHOT', requiresProof: true, telegramChatId: null,
      budgetKobo: 15_000, maxCompletions: 1,
    });
    const submitted = await completeTask({ user: user('200'), taskId: 't1', proofPath: 'a.png' });
    expect(store.snapshot()['tasks/t1']?.status).toBe('COMPLETED');

    await reviewSubmission({
      submissionId: submitted.submissionId!, decision: 'REJECT',
      reason: 'Not valid proof', reviewerId: '6438544386',
    });

    // The reward is available again for someone else.
    expect(store.snapshot()['tasks/t1']?.status).toBe('ACTIVE');
    expect(store.snapshot()['tasks/t1']?.spentKobo).toBe(0);
  });
});

describe('task link ids', () => {
  /*
    The link id is the task's document id, which is what makes uniqueness a
    database guarantee rather than a check that could race between two admins
    saving at the same moment.
  */
  const baseInput = {
    description: 'Join the channel and stay for the updates.',
    instructions: ['Open the channel', 'Tap Join'],
    category: 'TELEGRAM' as const,
    rewardKobo: 5_000,
    budgetKobo: 50_000,
    perUserLimit: 1,
    verification: 'MANUAL' as const,
    minimumDwellSeconds: 0,
    sortWeight: 100,
    status: 'ACTIVE' as const,
  };

  it('uses the id the admin typed', async () => {
    const { createTask } = await import('../src/services/tasks');

    const task = await createTask({ ...baseInput, title: 'Crediplex promo', slug: 'crediplex' }, 'admin');

    expect(task.id).toBe('crediplex');
  });

  it('refuses a second task with the same id, naming the field', async () => {
    const { createTask } = await import('../src/services/tasks');
    await createTask({ ...baseInput, title: 'First', slug: 'crediplex' }, 'admin');

    await expect(
      createTask({ ...baseInput, title: 'Second', slug: 'crediplex' }, 'admin'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { slug: expect.stringContaining('already used') },
    });
  });

  it('derives an id from the title when none is given', async () => {
    const { createTask } = await import('../src/services/tasks');

    const task = await createTask({ ...baseInput, title: 'Join Crediplex Channel!' }, 'admin');

    expect(task.id).toBe('join-crediplex-channel');
  });

  it('suffixes a derived id rather than failing, since the admin chose nothing', async () => {
    const { createTask } = await import('../src/services/tasks');
    await createTask({ ...baseInput, title: 'Join Crediplex' }, 'admin');

    const second = await createTask({ ...baseInput, title: 'Join Crediplex' }, 'admin');

    expect(second.id).toBe('join-crediplex-2');
  });

  it('keeps the completion key unambiguous', async () => {
    const { createTask } = await import('../src/services/tasks');

    const task = await createTask({ ...baseInput, title: 'A', slug: 'credi-plex-promo' }, 'admin');

    // Completions are keyed `userId__taskId`, so the id must not contain `__`.
    expect(task.id).not.toContain('__');
    expect(`555001__${task.id}`.split('__')).toHaveLength(2);
  });
});

/**
 * Refilling a campaign that ran out.
 *
 * A campaign auto-pauses itself when it can no longer fund a reward — it goes
 * COMPLETED and disappears from the earn list, which is right. What was wrong
 * is what happened next: an admin adding money to it left it funded and still
 * invisible, which looks exactly like the top-up having failed.
 */
describe('topping up a campaign budget', () => {
  it('adds to the budget rather than replacing it', async () => {
    seedTask('t1', { budgetKobo: 45_000, spentKobo: 30_000 });

    const updated = await topUpBudget('t1', 60_000);

    expect(updated.budgetKobo).toBe(105_000);
    // Spent is untouched: this adds money, it does not reset the campaign.
    expect(updated.spentKobo).toBe(30_000);
  });

  it('raises how many completions the budget can fund', async () => {
    seedTask('t1', { rewardKobo: 15_000, budgetKobo: 45_000, maxCompletions: 3 });

    const updated = await topUpBudget('t1', 45_000);
    expect(updated.maxCompletions).toBe(6);
  });

  it('brings an exhausted campaign back to life', async () => {
    seedTask('spent', {
      status: 'COMPLETED', rewardKobo: 15_000, budgetKobo: 45_000,
      spentKobo: 45_000, completionCount: 3, maxCompletions: 3,
    });

    const updated = await topUpBudget('spent', 30_000);

    expect(updated.status).toBe('ACTIVE');
    expect(taskAvailability(updated).available).toBe(true);
  });

  it('leaves a campaign an admin paused by hand alone', async () => {
    seedTask('paused', { status: 'PAUSED', spentKobo: 0 });

    const updated = await topUpBudget('paused', 30_000);

    // Only the budget stops a campaign automatically. A human decision stands
    // until a human reverses it.
    expect(updated.status).toBe('PAUSED');
  });

  it('leaves a draft as a draft', async () => {
    seedTask('draft', { status: 'DRAFT' });
    expect((await topUpBudget('draft', 30_000)).status).toBe('DRAFT');
  });

  it('refuses a top-up of nothing', async () => {
    seedTask('t1');
    await expect(topUpBudget('t1', 0)).rejects.toThrow();
    await expect(topUpBudget('t1', -5_000)).rejects.toThrow();
  });
});

describe('editing a campaign', () => {
  it('revives an exhausted campaign when the budget is raised', async () => {
    seedTask('spent', {
      status: 'COMPLETED', rewardKobo: 15_000, budgetKobo: 45_000,
      spentKobo: 45_000, completionCount: 3, maxCompletions: 3,
    });

    const updated = await updateTask('spent', { budgetKobo: 90_000 });
    expect(updated.status).toBe('ACTIVE');
  });

  it('still refuses a budget below what has been spent', async () => {
    seedTask('t1', { budgetKobo: 45_000, spentKobo: 30_000 });

    // The reason a person can act on lives in `fields`, not in the generic
    // message the envelope carries.
    await expect(updateTask('t1', { budgetKobo: 20_000 })).rejects.toMatchObject({
      fields: { budgetKobo: expect.stringMatching(/already been spent/i) },
    });
  });

  it('lets an admin correct the verification method', async () => {
    seedTask('t1', { verification: 'TELEGRAM_MEMBERSHIP', requiresProof: false });

    const updated = await updateTask('t1', { verification: 'SCREENSHOT' });

    expect(updated.verification).toBe('SCREENSHOT');
    // The flag the earn screen reads must follow, or the task asks for a
    // screenshot the app never offers a way to attach.
    expect(updated.requiresProof).toBe(true);
  });

  it('refuses to change verification while submissions are waiting', async () => {
    seedTask('t1', { verification: 'SCREENSHOT', requiresProof: true, pendingCount: 2 });

    // Those submissions were made under a promise about how they would be
    // judged. Changing it after the fact is how a platform feels arbitrary.
    await expect(updateTask('t1', { verification: 'HONOUR' })).rejects.toMatchObject({
      fields: { verification: expect.stringMatching(/waiting/i) },
    });
  });
});

/**
 * A task must not come back after you have done it.
 *
 * Reported from production: a screenshot task was completed and then appeared
 * as available again. The service refuses a second completion, so nothing
 * could actually be claimed twice — but a task offering itself again after you
 * did it is indistinguishable from the first attempt not having counted, and
 * that is the point at which people start submitting the same screenshot over
 * and over.
 */
describe('a task the user has already done', () => {
  async function seedApprovedFlow() {
    seedUser('500', 0);
    seedTask('shot', {
      verification: 'SCREENSHOT', requiresProof: true,
      rewardKobo: 4_000, budgetKobo: 40_000, maxCompletions: 10, perUserLimit: 1,
    });
    return completeTask({
      user: user('500'), taskId: 'shot', proofPath: 'https://i.ibb.co/a/b.png', dwellSeconds: 30,
    });
  }

  it('shows as waiting for review while the screenshot is pending', async () => {
    await seedApprovedFlow();

    const listed = await listTasksForUser('500');
    const row = listed.find((entry) => entry.id === 'shot');

    expect(row?.userState).toBe('PENDING_REVIEW');
  });

  it('shows as completed once the screenshot is approved', async () => {
    const submitted = await seedApprovedFlow();
    expect(submitted.state).toBe('PENDING_REVIEW');

    const submissionId = Object.keys(store.snapshot())
      .find((path) => path.startsWith('taskSubmissions/'))
      ?.split('/')[1];
    expect(submissionId).toBeTruthy();

    await reviewSubmission({
      submissionId: submissionId!, decision: 'APPROVE', reviewerId: 'admin-1',
    });

    const listed = await listTasksForUser('500');
    const row = listed.find((entry) => entry.id === 'shot');

    // The complaint: this came back as AVAILABLE.
    expect(row?.userState).toBe('COMPLETED');
  });

  it('refuses a second attempt outright', async () => {
    const submitted = await seedApprovedFlow();
    expect(submitted.state).toBe('PENDING_REVIEW');

    await expect(
      completeTask({
        user: user('500'), taskId: 'shot',
        proofPath: 'https://i.ibb.co/a/second.png', dwellSeconds: 30,
      }),
    ).rejects.toThrow();
  });
});
