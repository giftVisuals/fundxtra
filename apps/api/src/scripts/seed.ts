/**
 * Development seed.
 *
 * Creates a realistic working dataset so the Mini App and admin console can be
 * built and demonstrated without inventing numbers in the UI. Everything it
 * writes is real data flowing through the real services — task creation goes
 * through `createTask`, so the ₦1,000 cap and budget derivation apply here too.
 *
 * Run:  npm run seed --workspace @fundxtra/api
 *
 * Refuses to run against production, because seeding a live platform with
 * demo campaigns would be indistinguishable from a compromise.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { nairaToKobo } from '@fundxtra/shared';
import { env, isProduction } from '../config/env';
import { COLLECTIONS, DOC_IDS, db } from '../lib/firebase';
import { logger } from '../lib/logger';
import { createTask } from '../services/tasks';
import { seedRewardCatalogue } from '../services/rewards';
import { createAnnouncement } from '../services/announcements';
import { defaultSettings } from '../services/settings';

async function main(): Promise<void> {
  if (isProduction) {
    logger.error('Refusing to seed a production environment.');
    process.exit(1);
  }

  const adminId = env.PRIMARY_ADMIN_TELEGRAM_ID;
  logger.info({ projectId: env.FIREBASE_PROJECT_ID }, 'Seeding Fundxtra');

  // --- Settings -----------------------------------------------------------
  // Withdrawals and rewards start closed even in development: they should be
  // switched on deliberately, so nobody is surprised by a live money path.
  const settings = defaultSettings();
  await db()
    .collection(COLLECTIONS.systemSettings)
    .doc(DOC_IDS.settings)
    .set(
      {
        ...settings,
        platform: { ...settings.platform, botUsername: env.TELEGRAM_BOT_USERNAME },
        updatedAt: Timestamp.now(),
        updatedBy: adminId,
      },
      { merge: true },
    );
  logger.info('System settings written (withdrawals and rewards start closed)');

  // --- Admin --------------------------------------------------------------
  await db()
    .collection(COLLECTIONS.admins)
    .doc(adminId)
    .set(
      {
        telegramId: adminId,
        username: null,
        displayName: 'Fundxtra Owner',
        role: 'SUPER_ADMIN',
        extraPermissions: [],
        active: true,
        addedBy: null,
        createdAt: Timestamp.now(),
        lastActiveAt: null,
      },
      { merge: true },
    );
  logger.info({ adminId }, 'Primary admin ensured');

  // --- Reward catalogue ---------------------------------------------------
  const products = await seedRewardCatalogue();
  logger.info({ products }, 'Reward catalogue seeded');

  // --- Tasks --------------------------------------------------------------
  // A spread across verification methods and budget states, so every UI state
  // has something real behind it.
  const campaigns = [
    {
      title: 'Join the Fundxtra announcements channel',
      description:
        'Join our official channel to get new tasks, withdrawal openings and platform updates first.',
      instructions: ['Tap Open Channel', 'Tap Join at the bottom', 'Come back and tap Verify'],
      category: 'TELEGRAM' as const,
      rewardKobo: nairaToKobo(50),
      budgetKobo: nairaToKobo(50_000),
      verification: 'TELEGRAM_MEMBERSHIP' as const,
      targetUrl: 'https://t.me/fundxtra',
      telegramChatId: '@fundxtra',
      telegramChatLabel: 'Fundxtra Announcements',
      perUserLimit: 1,
      minimumDwellSeconds: 5,
      sortWeight: 10,
      status: 'ACTIVE' as const,
    },
    {
      title: 'Follow Fundxtra on X and share a post',
      description:
        'Follow our X account, share any Fundxtra post to your timeline, then send a screenshot showing both.',
      instructions: [
        'Open the Fundxtra profile on X',
        'Tap Follow',
        'Share any post to your timeline',
        'Screenshot your timeline showing the shared post',
        'Upload the screenshot here',
      ],
      category: 'SOCIAL' as const,
      rewardKobo: nairaToKobo(150),
      budgetKobo: nairaToKobo(50_000),
      verification: 'SCREENSHOT' as const,
      targetUrl: 'https://x.com/fundxtra',
      perUserLimit: 1,
      minimumDwellSeconds: 20,
      sortWeight: 20,
      status: 'ACTIVE' as const,
      sponsorName: 'Fundxtra',
    },
    {
      title: 'Try the Kredi budgeting app for 3 days',
      description:
        'Install Kredi, set up a budget, and keep it installed for three days. Send a screenshot of your dashboard.',
      instructions: [
        'Install Kredi from the Play Store',
        'Create an account and set one budget',
        'Screenshot your Kredi dashboard',
        'Upload the screenshot here',
      ],
      category: 'APP_INSTALL' as const,
      rewardKobo: nairaToKobo(1_000),
      budgetKobo: nairaToKobo(200_000),
      verification: 'SCREENSHOT' as const,
      targetUrl: 'https://example.com/kredi',
      perUserLimit: 1,
      minimumDwellSeconds: 30,
      sortWeight: 5,
      status: 'ACTIVE' as const,
      sponsorName: 'Kredi',
    },
    {
      title: 'Two-minute survey on how you save money',
      description: 'Answer eight questions about your saving habits. No personal details required.',
      instructions: ['Open the survey', 'Answer all eight questions', 'Paste your completion code below'],
      category: 'SURVEY' as const,
      rewardKobo: nairaToKobo(80),
      budgetKobo: nairaToKobo(24_000),
      verification: 'MANUAL_REVIEW' as const,
      targetUrl: 'https://example.com/survey',
      perUserLimit: 1,
      minimumDwellSeconds: 60,
      sortWeight: 30,
      status: 'ACTIVE' as const,
    },
    {
      title: 'Join the Fundxtra earners group',
      description: 'A community group for tips, task alerts and support from other Fundxtra earners.',
      instructions: ['Tap Open Group', 'Tap Join', 'Return and tap Verify'],
      category: 'TELEGRAM' as const,
      rewardKobo: nairaToKobo(40),
      budgetKobo: nairaToKobo(12_000),
      verification: 'TELEGRAM_MEMBERSHIP' as const,
      targetUrl: 'https://t.me/fundxtragroup',
      telegramChatId: '@fundxtragroup',
      telegramChatLabel: 'Fundxtra Earners',
      perUserLimit: 1,
      minimumDwellSeconds: 5,
      sortWeight: 40,
      status: 'PAUSED' as const,
    },
  ];

  let created = 0;
  for (const campaign of campaigns) {
    try {
      const task = await createTask(
        {
          ...campaign,
          sponsorLogoUrl: null,
          startsAt: null,
          endsAt: null,
        } as never,
        adminId,
      );
      created += 1;
      logger.info({ taskId: task.id, title: task.title }, 'Task created');
    } catch (error) {
      logger.error({ err: error, title: campaign.title }, 'Could not create task');
    }
  }

  // --- Announcements ------------------------------------------------------
  await createAnnouncement(
    {
      title: 'Welcome to Fundxtra',
      body:
        'Complete tasks, earn Naira rewards and refer friends for ₦100 each. Withdrawals open soon — your balance is safe until then.',
      level: 'INFO',
      audience: 'BOTH',
      ctaLabel: null,
      ctaUrl: null,
      published: true,
      publishAt: null,
      expiresAt: null,
      pinned: true,
    },
    adminId,
  );

  await createAnnouncement(
    {
      title: 'Reward redemption is coming',
      body:
        'Airtime, data, Telegram Stars and Telegram Premium are priced and ready. They go live as soon as our fulfilment partner opens their API.',
      level: 'INFO',
      audience: 'APP',
      ctaLabel: null,
      ctaUrl: null,
      published: true,
      publishAt: null,
      expiresAt: null,
      pinned: false,
    },
    adminId,
  );

  logger.info({ tasks: created, products }, 'Seed complete');
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Seed failed');
  process.exit(1);
});
