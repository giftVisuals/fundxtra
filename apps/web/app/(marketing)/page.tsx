import type { Metadata } from 'next';
import { BRAND, formatNaira, tokens } from '@fundxtra/shared';
import {
  Faq,
  FeatureCard,
  Grid,
  Section,
  StatsPanel,
  StepList,
} from '@/components/marketing/sections';
import {
  fallbackConfig,
  getPublicAnnouncements,
  getPublicConfig,
  getPublicStats,
} from '@/lib/public-data';

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: BRAND.description,
  alternates: { canonical: '/' },
};

/**
 * The public landing page.
 *
 * Marketing and trust, not utility — the earning happens in the Mini App and
 * this page deliberately does not duplicate the dashboard. What it has to do
 * is answer a sceptical visitor's questions: what is this, who pays, how do I
 * get my money, and why should I believe you.
 *
 * So every claim here is either a product rule the backend enforces, or a
 * figure from the database. There are no invented statistics and no income
 * promises. Where something is not live yet — reward delivery, most obviously
 * — the page says so rather than listing it as a feature.
 */
export default async function LandingPage() {
  const [config, stats, announcements] = await Promise.all([
    getPublicConfig(),
    getPublicStats(),
    getPublicAnnouncements(),
  ]);

  const site = config ?? fallbackConfig();
  const referralReward = formatNaira(site.referral.rewardKobo);
  const minWithdrawal = formatNaira(site.withdrawal.minAmountKobo);
  const maxTaskReward = formatNaira(site.maxTaskRewardKobo);

  const liveRewards = [
    { key: 'cash', label: 'Naira cash', live: site.rewards.cash, detail: `Straight to your Nigerian bank account. ${minWithdrawal} minimum.` },
    { key: 'airtime', label: 'Airtime', live: site.rewards.airtime, detail: 'Top up any Nigerian network from your balance.' },
    { key: 'data', label: 'Data', live: site.rewards.data, detail: 'Data bundles on MTN, Glo, Airtel and 9mobile.' },
    { key: 'stars', label: 'Telegram Stars', live: site.rewards.telegramStars, detail: 'Stars delivered to your Telegram account.' },
    { key: 'premium', label: 'Telegram Premium', live: site.rewards.telegramPremium, detail: '3, 6 or 12 months of Premium.' },
  ];

  return (
    <>
      {/* ---------------------------------------------------------------- HERO */}
      <section
        style={{
          position: 'relative',
          padding: '56px 20px 72px',
          overflow: 'hidden',
          // A single warm wash behind the hero. White still dominates; the
          // brown is doing accent work, not taking over the page.
          background: `radial-gradient(120% 90% at 85% -10%, ${tokens.colors.cocoa[100]} 0%, rgba(255,255,255,0) 58%), ${tokens.semantic.bg}`,
        }}
      >
        <div
          style={{
            maxWidth: tokens.layout.siteMaxWidth,
            margin: '0 auto',
            display: 'grid',
            gap: 44,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))',
            alignItems: 'center',
          }}
        >
          <div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 13px',
                background: tokens.semantic.surface,
                border: `1px solid ${tokens.semantic.brandBorder}`,
                borderRadius: tokens.radii.pill,
                fontSize: tokens.typography.size.xs,
                fontWeight: tokens.typography.weight.semibold,
                color: tokens.semantic.brandInk,
                boxShadow: tokens.shadows.xs,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: tokens.colors.success.base,
                }}
              />
              Runs inside Telegram — no app to install
            </span>

            <h1
              style={{
                marginTop: 22,
                fontSize: 'clamp(2.25rem, 6.4vw, 3.75rem)',
                letterSpacing: '-0.035em',
                lineHeight: 1.04,
              }}
            >
              Complete tasks.
              <br />
              <span style={{ color: tokens.semantic.brandInk }}>Earn rewards.</span>
              <br />
              Refer friends.
            </h1>

            <p
              style={{
                marginTop: 20,
                maxWidth: 520,
                fontSize: 'clamp(1.0625rem, 2vw, 1.1875rem)',
                lineHeight: tokens.typography.leading.relaxed,
                color: tokens.semantic.inkMuted,
              }}
            >
              Fundxtra pays you in Naira for completing sponsored tasks. Withdraw to your bank,
              or spend your balance on airtime, data, Telegram Stars and Telegram Premium. One
              balance, no email, no password — your Telegram account is your login.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 30 }}>
              <a
                href={site.startEarningUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 9,
                  minHeight: 54,
                  padding: '0 26px',
                  background: `linear-gradient(180deg, ${tokens.colors.cocoa[500]} 0%, ${tokens.semantic.brand} 55%, ${tokens.colors.cocoa[700]} 100%)`,
                  color: tokens.semantic.onBrand,
                  border: `1px solid ${tokens.colors.cocoa[700]}`,
                  borderRadius: tokens.radii.pill,
                  fontSize: tokens.typography.size.lg,
                  fontWeight: tokens.typography.weight.semibold,
                  boxShadow: tokens.shadows.brand,
                }}
              >
                Start earning
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h13M12.5 5.5 19 12l-6.5 6.5" />
                </svg>
              </a>
              <a
                href="#how-it-works"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  minHeight: 54,
                  padding: '0 24px',
                  background: tokens.semantic.surface,
                  color: tokens.semantic.brandInk,
                  border: `1px solid ${tokens.semantic.brandBorder}`,
                  borderRadius: tokens.radii.pill,
                  fontSize: tokens.typography.size.lg,
                  fontWeight: tokens.typography.weight.semibold,
                }}
              >
                How it works
              </a>
            </div>

            <p
              style={{
                marginTop: 18,
                fontSize: tokens.typography.size.sm,
                color: tokens.semantic.inkSubtle,
              }}
            >
              Up to {maxTaskReward} per task · {referralReward} per qualified referral ·{' '}
              {minWithdrawal} minimum withdrawal
            </p>
          </div>

          {/* A restrained device mock: the balance card and the glass bar, which
              is what the product actually looks like. No invented chart. */}
          <HeroPreview />
        </div>
      </section>

      {announcements.length > 0 && (
        <section style={{ padding: '0 20px' }}>
          <div style={{ maxWidth: tokens.layout.siteMaxWidth, margin: '0 auto' }}>
            {announcements.slice(0, 1).map((announcement) => (
              <div
                key={announcement.id}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  alignItems: 'baseline',
                  padding: '16px 20px',
                  background: tokens.colors.info.soft,
                  border: '1px solid #d3e0ee',
                  borderRadius: tokens.radii.lg,
                }}
              >
                <strong
                  style={{
                    fontSize: tokens.typography.size.base,
                    color: tokens.colors.info.strong,
                  }}
                >
                  {announcement.title}
                </strong>
                <span
                  style={{
                    fontSize: tokens.typography.size.base,
                    color: tokens.colors.info.strong,
                    opacity: 0.9,
                  }}
                >
                  {announcement.body}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------ HOW IT WORKS */}
      <Section
        id="how-it-works"
        eyebrow="How it works"
        title="Six steps, and the first five take a minute"
        lead="Fundxtra lives inside Telegram, so there is nothing to download and no account to create. Your Telegram identity is your login."
      >
        <div
          style={{
            display: 'grid',
            gap: 40,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))',
          }}
        >
          <StepList
            steps={[
              {
                title: 'Start Fundxtra on Telegram',
                body: 'Open the bot and tap start. We verify your Telegram account on our server — nothing to fill in.',
              },
              {
                title: 'Create your 4-digit PIN',
                body: 'A second layer of security for withdrawals and redemptions. We store it hashed, so nobody at Fundxtra can read it.',
              },
              {
                title: 'Complete available tasks',
                body: `Sponsored actions like joining a channel, trying an app or answering a short survey. Each task shows its reward and how it is verified before you begin, up to ${maxTaskReward}.`,
              },
            ]}
          />
          <StepList
            steps={[
              {
                title: 'Earn Naira rewards',
                body: 'Automatically verified tasks credit immediately. Tasks needing a screenshot are reviewed by a person, usually within 24 hours.',
              },
              {
                title: 'Refer friends',
                body: `${referralReward} for every friend who joins through your link and finishes setting up. They do not need to complete a task.`,
              },
              {
                title: 'Withdraw or redeem',
                body: `Cash to your Nigerian bank from ${minWithdrawal}, or spend your balance on airtime, data, Telegram Stars or Telegram Premium.`,
              },
            ]}
          />
        </div>
      </Section>

      {/* ------------------------------------------------------------- STATISTICS */}
      <Section
        eyebrow="By the numbers"
        title="Our figures, from our own records"
        lead="We publish platform totals from the database rather than from a brochure. When there is not enough activity for a number to mean anything, we say that instead of inventing one."
        tone="tinted"
      >
        <StatsPanel stats={stats} />
      </Section>

      {/* ---------------------------------------------------------------- REWARDS */}
      <Section
        id="rewards"
        eyebrow="Rewards"
        title="One balance, several ways to spend it"
        lead="Everything you earn — tasks and referrals alike — lands in a single Naira balance. No separate wallets to move money between."
      >
        {/* 200px so all five reward cards fit one row on a desktop width
            instead of wrapping to 4 + 1 and leaving an orphan. */}
        <Grid min={200}>
          {liveRewards.map((reward) => (
            <div
              key={reward.key}
              style={{
                position: 'relative',
                padding: 22,
                background: tokens.semantic.surface,
                border: `1px solid ${reward.live ? tokens.colors.cocoa[200] : tokens.semantic.border}`,
                borderRadius: tokens.radii.lg,
                boxShadow: tokens.shadows.xs,
                height: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <h3
                  style={{
                    fontSize: tokens.typography.size.lg,
                    fontWeight: tokens.typography.weight.semibold,
                  }}
                >
                  {reward.label}
                </h3>
                <span
                  style={{
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '3px 9px',
                    background: reward.live ? tokens.colors.success.soft : tokens.colors.sand[100],
                    color: reward.live ? tokens.colors.success.strong : tokens.colors.sand[600],
                    border: `1px solid ${reward.live ? '#cfe7d7' : tokens.colors.sand[200]}`,
                    borderRadius: tokens.radii.pill,
                    fontSize: tokens.typography.size['2xs'],
                    fontWeight: tokens.typography.weight.bold,
                    letterSpacing: tokens.typography.tracking.wide,
                  }}
                >
                  {/* A shape cue as well as colour, so status never depends on
                      hue alone. */}
                  <span aria-hidden="true">{reward.live ? '✓' : '○'}</span>
                  {reward.live ? 'LIVE' : 'SOON'}
                </span>
              </div>
              <p
                style={{
                  marginTop: 8,
                  fontSize: tokens.typography.size.base,
                  lineHeight: tokens.typography.leading.relaxed,
                  color: tokens.semantic.inkMuted,
                }}
              >
                {reward.detail}
              </p>
            </div>
          ))}
        </Grid>

        {/* Published pricing. Real numbers, marked as not-yet-deliverable
            where that is the case. */}
        <div style={{ marginTop: 32 }}>
          <h3
            style={{
              fontSize: tokens.typography.size.md,
              fontWeight: tokens.typography.weight.semibold,
              marginBottom: 14,
            }}
          >
            Telegram Stars and Premium pricing
          </h3>
          <Grid min={240} gap={12}>
            <PriceTable
              title="Telegram Stars"
              rows={site.pricing.telegramStars.map((bundle) => ({
                label: `${bundle.stars.toLocaleString('en-NG')} Stars`,
                value: formatNaira(bundle.priceKobo),
              }))}
            />
            <PriceTable
              title="Telegram Premium"
              rows={site.pricing.telegramPremium.map((plan) => ({
                label: `${plan.months} months`,
                value: formatNaira(plan.priceKobo),
              }))}
            />
          </Grid>
          <p
            style={{
              marginTop: 12,
              fontSize: tokens.typography.size.xs,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkSubtle,
            }}
          >
            These prices are final. Delivery of airtime, data, Stars and Premium switches on once
            our fulfilment partner opens their service — until then those options are marked
            &ldquo;soon&rdquo; in the app and your balance cannot be spent on them. Cash
            withdrawal does not depend on that partner.
          </p>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ TASKS */}
      <Section
        id="tasks"
        eyebrow="Task campaigns"
        title="Every task is a funded campaign"
        lead="Brands and sponsors fund a campaign with a fixed budget. You see the reward, the total budget and how much is left before you start, because a task nobody can pay for is not a task."
        tone="tinted"
      >
        <Grid min={260}>
          <FeatureCard
            icon={<GlyphBudget />}
            title="Visible budget"
            body="Each campaign shows its reward, total budget, what remains and how many people have already claimed. When the budget runs out the task closes itself rather than taking submissions it cannot pay."
          />
          <FeatureCard
            icon={<GlyphVerify />}
            title="Verification you know about upfront"
            body="Joining a Telegram channel is checked automatically against Telegram itself. Anything needing proof says so before you start, and a person reviews your screenshot."
          />
          <FeatureCard
            icon={<GlyphSponsor />}
            title="Sponsors, not surveys about nothing"
            body="Campaigns come from advertisers who want a real action completed. That is where the money comes from, and it is why rewards have a ceiling per task."
            footnote={`Maximum ${maxTaskReward} per task.`}
          />
        </Grid>
      </Section>

      {/* -------------------------------------------------------------- REFERRALS */}
      <Section
        id="referrals"
        eyebrow="Referrals"
        title={`${referralReward} per qualified referral`}
        lead="Simple and unambiguous, so you always know whether you have earned it."
      >
        <div
          style={{
            display: 'grid',
            gap: 24,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
          }}
        >
          <div
            style={{
              padding: 26,
              background: tokens.colors.cocoa[50],
              border: `1px solid ${tokens.colors.cocoa[200]}`,
              borderRadius: tokens.radii.xl,
            }}
          >
            <h3
              style={{
                fontSize: tokens.typography.size.md,
                fontWeight: tokens.typography.weight.semibold,
                marginBottom: 16,
              }}
            >
              A referral qualifies when your friend:
            </h3>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
              {[
                'Opens Fundxtra from your link',
                'Creates their 4-digit PIN',
                'Reaches their dashboard',
              ].map((step, index) => (
                <li key={step} style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: tokens.semantic.surface,
                      border: `1px solid ${tokens.colors.cocoa[200]}`,
                      color: tokens.colors.cocoa[700],
                      fontSize: tokens.typography.size['2xs'],
                      fontWeight: tokens.typography.weight.bold,
                    }}
                  >
                    {index + 1}
                  </span>
                  <span style={{ fontSize: tokens.typography.size.base }}>{step}</span>
                </li>
              ))}
            </ol>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                marginTop: 18,
                paddingTop: 16,
                borderTop: `1px solid ${tokens.colors.cocoa[200]}`,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: tokens.colors.success.soft,
                  border: '1px solid #cfe7d7',
                  color: tokens.colors.success.strong,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                ✓
              </span>
              <span
                style={{
                  fontSize: tokens.typography.size.base,
                  fontWeight: tokens.typography.weight.semibold,
                }}
              >
                {referralReward} lands in your balance
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <FeatureCard
              title="No task required"
              body="Your friend does not have to complete a task for you to be paid. Setting up their PIN and reaching the dashboard is enough."
            />
            <FeatureCard
              title="One reward per Telegram account"
              body="Referrals are tied to Telegram identities, so an account can only ever be referred once. Self-referrals do not count and are flagged for review."
            />
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------- AUTOMATION */}
      <Section
        eyebrow="Automation"
        title="What is automatic, and what a person still does"
        lead="Plenty of platforms claim to be fully automated. Here is the accurate version."
        tone="tinted"
      >
        <Grid min={250}>
          <FeatureCard
            title="Automatic"
            body="Telegram membership checks, reward calculation, balance updates, campaign budget tracking, referral qualification and the transaction record behind every movement."
          />
          <FeatureCard
            title="Reviewed by a person"
            body="Any task where you upload a screenshot. A reviewer checks it, approves or rejects with a reason you can read, and only then is the reward credited."
          />
          <FeatureCard
            title="Not yet automatic"
            body="Delivery of airtime, data, Stars and Premium, which waits on our fulfilment partner's service. Cash withdrawals are processed by our team with every step tracked."
          />
        </Grid>
      </Section>

      {/* --------------------------------------------------------------- SECURITY */}
      <Section
        id="security"
        eyebrow="Security and trust"
        title="How your balance is protected"
        lead="Fundxtra handles real money, so these are engineering commitments rather than reassurances."
      >
        <Grid min={250}>
          <FeatureCard
            icon={<GlyphLock />}
            title="Your PIN is unreadable, even to us"
            body="Stored as a slow hash with a value unique to your account. Fundxtra staff will never ask you for it — anyone who does is not us."
          />
          <FeatureCard
            icon={<GlyphLedger />}
            title="Every movement is recorded"
            body="Rewards, referrals, withdrawals and refunds each create a permanent entry. If you ever query your balance, there is a record to check it against."
          />
          <FeatureCard
            icon={<GlyphShield />}
            title="Nothing is decided in your browser"
            body="Task completion, referral qualification and every balance change are verified on our server. A modified app cannot award itself anything."
          />
          <FeatureCard
            icon={<GlyphTelegram />}
            title="No password to steal"
            body="You sign in with Telegram, which we verify server-side on every session. There is no email or password on file to be leaked."
          />
        </Grid>
      </Section>

      {/* -------------------------------------------------------------------- FAQ */}
      <Section
        id="faq"
        eyebrow="FAQ"
        title="Questions people actually ask"
        tone="tinted"
      >
        <Faq
          items={[
            {
              question: 'Is Fundxtra free to join?',
              answer:
                'Yes. There is no joining fee, no subscription and nothing to pay before you withdraw. If anyone asks you to pay to unlock your Fundxtra balance, it is a scam — report it to our support account.',
            },
            {
              question: 'How much can I actually earn?',
              answer: `That depends entirely on the campaigns available and the tasks you complete. Rewards are capped at ${maxTaskReward} per task and referrals pay ${referralReward} each. We do not promise or guarantee any income figure, and you should be sceptical of any platform that does.`,
            },
            {
              question: 'When do withdrawals open?',
              answer: `The withdrawal portal is opened and closed by our team, and the current status is always shown in your wallet with the reason. The minimum withdrawal is ${minWithdrawal}. Your balance stays safe while the portal is closed.`,
            },
            {
              question: 'Why do some tasks need a screenshot?',
              answer:
                'Because Telegram can confirm that you joined a channel, but nothing can automatically confirm that you installed an app or shared a post. Rather than guess, we ask for proof and have a person check it — usually within 24 hours.',
            },
            {
              question: 'What happens if a task is rejected?',
              answer:
                'You see the reviewer’s reason in the app, and the campaign budget that was held for your submission is released back so someone else can claim it. If you think a rejection was wrong, contact support.',
            },
            {
              question: 'Why can I not redeem airtime or Stars yet?',
              answer:
                'Because we will not take your balance for something we cannot deliver. Those options are priced and visible but marked as coming soon until our fulfilment partner opens their service. Cash withdrawal does not depend on them.',
            },
            {
              question: 'I forgot my PIN. What now?',
              answer: `Contact Fundxtra Support at ${site.brand.supportHandle}. We cannot read your PIN, so support resets it and you create a new one the next time you open the app. Nobody at Fundxtra ever learns your PIN.`,
            },
            {
              question: 'Can I have more than one account?',
              answer:
                'No. One Telegram account is one Fundxtra account — that is enforced by how accounts are created, not just by a rule. Attempting to farm referrals with multiple accounts gets them flagged for review.',
            },
          ]}
        />
      </Section>

      {/* ---------------------------------------------------------------- SUPPORT */}
      <section style={{ padding: '72px 20px 88px' }}>
        <div
          style={{
            maxWidth: 820,
            margin: '0 auto',
            padding: 'clamp(28px, 5vw, 48px)',
            textAlign: 'center',
            background: `linear-gradient(165deg, ${tokens.colors.cocoa[50]} 0%, ${tokens.semantic.bg} 100%)`,
            border: `1px solid ${tokens.colors.cocoa[200]}`,
            borderRadius: tokens.radii['2xl'],
          }}
        >
          <h2
            style={{
              fontSize: 'clamp(1.5rem, 4vw, 2.125rem)',
              letterSpacing: tokens.typography.tracking.tighter,
            }}
          >
            Ready to start earning?
          </h2>
          <p
            style={{
              margin: '14px auto 0',
              maxWidth: 520,
              fontSize: tokens.typography.size.lg,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkMuted,
            }}
          >
            Open Fundxtra in Telegram, set your PIN, and the tasks available right now are on
            your dashboard.
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              justifyContent: 'center',
              marginTop: 28,
            }}
          >
            <a
              href={site.startEarningUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 54,
                padding: '0 28px',
                background: `linear-gradient(180deg, ${tokens.colors.cocoa[500]} 0%, ${tokens.semantic.brand} 55%, ${tokens.colors.cocoa[700]} 100%)`,
                color: tokens.semantic.onBrand,
                border: `1px solid ${tokens.colors.cocoa[700]}`,
                borderRadius: tokens.radii.pill,
                fontSize: tokens.typography.size.lg,
                fontWeight: tokens.typography.weight.semibold,
                boxShadow: tokens.shadows.brand,
              }}
            >
              Start earning
            </a>
            <a
              href={site.brand.supportUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 54,
                padding: '0 24px',
                background: tokens.semantic.surface,
                color: tokens.semantic.brandInk,
                border: `1px solid ${tokens.semantic.brandBorder}`,
                borderRadius: tokens.radii.pill,
                fontSize: tokens.typography.size.lg,
                fontWeight: tokens.typography.weight.semibold,
              }}
            >
              Talk to support
            </a>
          </div>
          <p
            style={{
              marginTop: 18,
              fontSize: tokens.typography.size.sm,
              color: tokens.semantic.inkSubtle,
            }}
          >
            Official support: {site.brand.supportHandle} · Bot: {site.botUsername}
          </p>
        </div>
      </section>
    </>
  );
}

function PriceTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div
      style={{
        background: tokens.semantic.surface,
        border: `1px solid ${tokens.semantic.border}`,
        borderRadius: tokens.radii.lg,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '12px 18px',
          background: tokens.colors.sand[50],
          borderBottom: `1px solid ${tokens.semantic.border}`,
          fontSize: tokens.typography.size.sm,
          fontWeight: tokens.typography.weight.semibold,
        }}
      >
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td
                style={{
                  padding: '11px 18px',
                  fontSize: tokens.typography.size.base,
                  color: tokens.semantic.inkMuted,
                  borderTop: `1px solid ${tokens.semantic.divider}`,
                }}
              >
                {row.label}
              </td>
              <td
                className="fx-tabular"
                style={{
                  padding: '11px 18px',
                  textAlign: 'right',
                  fontSize: tokens.typography.size.base,
                  fontWeight: tokens.typography.weight.semibold,
                  color: tokens.semantic.brandInk,
                  borderTop: `1px solid ${tokens.semantic.divider}`,
                }}
              >
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Hero preview.
 *
 * A restrained representation of the real product: the balance card and the
 * glass tab bar. The figures are obviously illustrative and labelled as a
 * preview, so it cannot be mistaken for a live statistic.
 */
function HeroPreview() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div
        aria-hidden="true"
        style={{
          position: 'relative',
          width: 'min(300px, 100%)',
          padding: 14,
          background: tokens.semantic.surface,
          border: `1px solid ${tokens.semantic.border}`,
          borderRadius: 38,
          boxShadow: tokens.shadows.xl,
        }}
      >
        <div
          style={{
            // The bottom padding is the preview's equivalent of the app's
            // tab-bar clearance: without it the floating glass bar sits on
            // top of the last transaction row instead of over empty space.
            padding: '22px 18px 86px',
            background: `linear-gradient(170deg, ${tokens.colors.cocoa[50]} 0%, ${tokens.semantic.bg} 70%)`,
            borderRadius: 26,
            border: `1px solid ${tokens.colors.cocoa[100]}`,
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: tokens.typography.weight.bold,
              letterSpacing: tokens.typography.tracking.wider,
              textTransform: 'uppercase',
              color: tokens.colors.cocoa[700],
              opacity: 0.7,
            }}
          >
            Your balance
          </p>
          <p
            className="fx-tabular"
            style={{
              marginTop: 4,
              fontFamily: tokens.typography.fontDisplay,
              fontSize: 38,
              fontWeight: tokens.typography.weight.bold,
              letterSpacing: '-0.03em',
              lineHeight: 1,
              color: tokens.colors.cocoa[800],
            }}
          >
            ₦4,850
          </p>

          <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
            <span
              style={{
                flex: 1,
                padding: '9px 0',
                textAlign: 'center',
                background: `linear-gradient(180deg, ${tokens.colors.cocoa[500]}, ${tokens.colors.cocoa[700]})`,
                color: '#fff',
                borderRadius: tokens.radii.sm,
                fontSize: 11,
                fontWeight: tokens.typography.weight.semibold,
              }}
            >
              Earn now
            </span>
            <span
              style={{
                flex: 1,
                padding: '9px 0',
                textAlign: 'center',
                background: tokens.semantic.surface,
                color: tokens.semantic.brandInk,
                border: `1px solid ${tokens.semantic.brandBorder}`,
                borderRadius: tokens.radii.sm,
                fontSize: 11,
                fontWeight: tokens.typography.weight.semibold,
              }}
            >
              Withdraw
            </span>
          </div>

          <div style={{ display: 'grid', gap: 6, marginTop: 18 }}>
            {[
              { title: 'Join the Fundxtra channel', amount: '₦50' },
              { title: 'Share a post on X', amount: '₦150' },
              { title: 'Referral · Amaka', amount: '+₦100' },
            ].map((row) => (
              <div
                key={row.title}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '9px 11px',
                  background: tokens.semantic.surface,
                  border: `1px solid ${tokens.semantic.border}`,
                  borderRadius: tokens.radii.sm,
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    color: tokens.semantic.inkMuted,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.title}
                </span>
                <span
                  className="fx-tabular"
                  style={{
                    flexShrink: 0,
                    fontWeight: tokens.typography.weight.semibold,
                    color: row.amount.startsWith('+')
                      ? tokens.colors.success.strong
                      : tokens.semantic.brandInk,
                  }}
                >
                  {row.amount}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* The glass bar, so the signature navigation appears on the landing
            page too — statically rendered, no JavaScript. */}
        <div
          style={{
            position: 'absolute',
            left: 26,
            right: 26,
            bottom: 26,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            height: 46,
            padding: 5,
            background: tokens.glass.fillStrong,
            backdropFilter: `blur(${tokens.glass.blur}) saturate(${tokens.glass.saturate})`,
            WebkitBackdropFilter: `blur(${tokens.glass.blur}) saturate(${tokens.glass.saturate})`,
            border: `1px solid ${tokens.glass.edge}`,
            borderRadius: tokens.radii.pill,
            boxShadow: tokens.glass.shadow,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '0 12px',
              height: '100%',
              background: tokens.glass.pill,
              borderRadius: tokens.radii.pill,
              boxShadow: '0 1px 0 rgba(255,255,255,0.9) inset',
              fontSize: 10,
              fontWeight: tokens.typography.weight.bold,
              color: tokens.semantic.brandInk,
            }}
          >
            <GlyphHomeSmall /> Home
          </span>
          {[GlyphChartSmall, GlyphPeopleSmall, GlyphWalletSmall, GlyphUserSmall].map(
            (Glyph, index) => (
              <span
                key={index}
                style={{
                  flex: 1,
                  display: 'grid',
                  placeItems: 'center',
                  color: tokens.semantic.inkFaint,
                }}
              >
                <Glyph />
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/* Inline glyphs. Kept local to the landing page so it ships no icon payload. */

const glyph = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

const small = { ...glyph, width: 13, height: 13, strokeWidth: 2 };

function GlyphBudget() {
  return (
    <svg {...glyph}>
      <rect x="3.4" y="6.4" width="17.2" height="11.2" rx="2.4" />
      <path d="M3.4 10.6h17.2M7.4 14.4h4" />
    </svg>
  );
}
function GlyphVerify() {
  return (
    <svg {...glyph}>
      <path d="M12 3.2 19.2 6v6c0 4.4-3 7.6-7.2 8.8C7.8 19.6 4.8 16.4 4.8 12V6z" />
      <path d="M9.2 12l2 2 3.6-3.8" />
    </svg>
  );
}
function GlyphSponsor() {
  return (
    <svg {...glyph}>
      <path d="M4.6 9.4h3l5.4-4v13.2l-5.4-4h-3a1.4 1.4 0 0 1-1.4-1.4v-2.4a1.4 1.4 0 0 1 1.4-1.4z" />
      <path d="M17 9.4a4 4 0 0 1 0 5.2" />
    </svg>
  );
}
function GlyphLock() {
  return (
    <svg {...glyph}>
      <rect x="4.6" y="10.4" width="14.8" height="10" rx="2.4" />
      <path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8" />
    </svg>
  );
}
function GlyphLedger() {
  return (
    <svg {...glyph}>
      <path d="M6.4 3.6h11a1.6 1.6 0 0 1 1.6 1.6v13.6a1.6 1.6 0 0 1-1.6 1.6h-11a1.6 1.6 0 0 1-1.6-1.6V5.2a1.6 1.6 0 0 1 1.6-1.6z" />
      <path d="M8.4 8h7.2M8.4 12h7.2M8.4 16h4.4" />
    </svg>
  );
}
function GlyphShield() {
  return (
    <svg {...glyph}>
      <path d="M12 3.2 19.2 6v6c0 4.4-3 7.6-7.2 8.8C7.8 19.6 4.8 16.4 4.8 12V6z" />
      <path d="M12 8.4v4.2M12 16v.01" />
    </svg>
  );
}
function GlyphTelegram() {
  return (
    <svg {...glyph}>
      <path d="M20.4 4.2 3.8 10.6l4.6 1.7 1.7 5.1 2.6-2.9 4.3 3.2z" />
      <path d="M8.4 12.3 17 7.4l-6 6.6" />
    </svg>
  );
}
function GlyphHomeSmall() {
  return (
    <svg {...small}>
      <path d="M3.2 10.4 12 3.6l8.8 6.8v8.2a1.6 1.6 0 0 1-1.6 1.6H4.8a1.6 1.6 0 0 1-1.6-1.6z" />
    </svg>
  );
}
function GlyphChartSmall() {
  return (
    <svg {...small}>
      <path d="M3.4 17.6 9 12l3.4 3.4L20.6 7.2" />
      <path d="M15.4 7.2h5.2v5.2" />
    </svg>
  );
}
function GlyphPeopleSmall() {
  return (
    <svg {...small}>
      <circle cx="9.2" cy="8.4" r="3.4" />
      <path d="M3.2 19.4a6 6 0 0 1 12 0" />
    </svg>
  );
}
function GlyphWalletSmall() {
  return (
    <svg {...small}>
      <rect x="2.8" y="6.2" width="18.4" height="12.6" rx="3" />
      <path d="M2.8 10.4h18.4" />
    </svg>
  );
}
function GlyphUserSmall() {
  return (
    <svg {...small}>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  );
}
