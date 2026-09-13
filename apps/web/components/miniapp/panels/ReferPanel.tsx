'use client';

import { useCallback, useState } from 'react';
import {
  formatNaira,
  relativeTime,
  tokens,
  type ReferralStatus,
  type ReferralSummary,
} from '@fundxtra/shared';
import { useResource } from '@/lib/resource';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { supportUrl } from '@/lib/config';
import { haptic, openExternal } from '@/lib/telegram';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SkeletonList,
  StatBlock,
} from '@/components/ui';
import { ReferIcon } from '@/components/glass';
import { PanelHeader, Row, Section, IconTile } from './shared';

interface ReferralRow {
  id: string;
  firstName: string;
  username: string | null;
  status: ReferralStatus;
  rewardKobo: number;
  createdAt: string;
  qualifiedAt: string | null;
}

interface ReferralPayload {
  summary: ReferralSummary;
  referrals: ReferralRow[];
  qualification: string[];
  enabled: boolean;
  codeClaim: { available: boolean; bonusKobo: number };
}

/**
 * Refer.
 *
 * The qualification rule is the most important thing on this screen. A referral
 * programme where people cannot tell why a referral did or did not pay is where
 * trust goes to die, so the four steps are listed explicitly, sourced from the
 * server so the copy cannot drift from the rule the backend actually enforces.
 *
 * Pending referrals are shown as pending rather than hidden — a friend who has
 * joined but not finished setting up is real information the referrer can act
 * on by nudging them.
 */
export function ReferPanel() {
  const { refresh } = useSession();
  const [copied, setCopied] = useState(false);

  // Cached: leaving and returning to this tab should not re-read the referral
  // list from Firestore every time.
  const { data, error, reload: load } = useResource<ReferralPayload>('/referrals');

  const copyLink = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      haptic.success();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused in a WebView; falling back to a share
      // sheet is better than telling the user nothing happened.
      openExternal(
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(
          'Join me on Fundxtra — complete tasks and earn Naira rewards.',
        )}`,
      );
    }
  }, []);

  if (error && !data) {
    return (
      <div>
        <PanelHeader title="Refer" />
        <ErrorState message={error} onRetry={() => void load()} supportUrl={supportUrl} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PanelHeader title="Refer" subtitle="Invite friends and earn together." />
        <SkeletonList count={2} lines={4} />
      </div>
    );
  }

  const { summary, referrals, qualification, enabled, codeClaim } = data;

  return (
    <div>
      <PanelHeader
        title="Refer"
        subtitle={`Earn ${formatNaira(summary.rewardPerReferralKobo)} for every friend who joins and sets up.`}
      />

      {/*
        Shown only while it can still be used. A box offering money that
        refuses everything you type is worse than no box.
      */}
      {codeClaim.available && (
        <ClaimCodeCard
          bonusKobo={codeClaim.bonusKobo}
          onClaimed={() => {
            void load();
            void refresh();
          }}
        />
      )}

      {!enabled && (
        <Card tone="warning" padding={14} style={{ marginBottom: 16 }}>
          <Badge tone="warning" mark="clock">Paused</Badge>
          <p
            style={{
              marginTop: 8,
              fontSize: tokens.typography.size.sm,
              color: tokens.colors.warning.strong,
              lineHeight: tokens.typography.leading.relaxed,
            }}
          >
            The referral programme is paused right now. Existing qualified referrals are
            unaffected.
          </p>
        </Card>
      )}

      {/* Earnings summary. */}
      <Card tone="brand" padding={20} radius={tokens.radii.xl} style={{ marginBottom: 14 }}>
        <StatBlock
          label="Referral earnings"
          value={formatNaira(summary.earningsKobo)}
          emphasis
          hint={`${summary.qualifiedReferrals} qualified · ${summary.pendingReferrals} pending`}
        />
      </Card>

      {/* The link. The primary action on this screen, so it gets the most
          prominent treatment after the earnings figure. */}
      <Section title="Your referral link">
        <Card padding={14}>
          <p
            style={{
              fontFamily: tokens.typography.fontMono,
              fontSize: tokens.typography.size.xs,
              wordBreak: 'break-all',
              color: tokens.semantic.inkMuted,
              lineHeight: tokens.typography.leading.relaxed,
            }}
          >
            {summary.referralLink}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button
              style={{ flex: 1 }}
              onClick={() => void copyLink(summary.referralLink)}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button
              variant="secondary"
              style={{ flex: 1 }}
              onClick={() =>
                openExternal(
                  `https://t.me/share/url?url=${encodeURIComponent(
                    summary.referralLink,
                  )}&text=${encodeURIComponent(
                    'Join me on Fundxtra — complete tasks and earn Naira rewards.',
                  )}`,
                )
              }
            >
              Share
            </Button>
          </div>
          <p
            style={{
              marginTop: 12,
              fontSize: tokens.typography.size.xs,
              color: tokens.semantic.inkSubtle,
            }}
          >
            Your code: <strong style={{ color: tokens.semantic.brandInk }}>{summary.referralCode}</strong>
          </p>
        </Card>
      </Section>

      {/* How qualification works. Numbered, unambiguous, server-sourced. */}
      <Section title="How a referral qualifies">
        <Card padding={16}>
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {qualification.map((step, index) => (
              <li key={index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span
                  aria-hidden="true"
                  style={{
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background:
                      index === qualification.length - 1
                        ? tokens.colors.success.soft
                        : tokens.colors.cocoa[50],
                    border: `1px solid ${
                      index === qualification.length - 1 ? '#cfe7d7' : tokens.colors.cocoa[200]
                    }`,
                    color:
                      index === qualification.length - 1
                        ? tokens.colors.success.strong
                        : tokens.colors.cocoa[700],
                    fontSize: tokens.typography.size['2xs'],
                    fontWeight: tokens.typography.weight.bold,
                  }}
                >
                  {index === qualification.length - 1 ? '₦' : index + 1}
                </span>
                <span
                  style={{
                    fontSize: tokens.typography.size.base,
                    lineHeight: tokens.typography.leading.snug,
                    fontWeight:
                      index === qualification.length - 1
                        ? tokens.typography.weight.semibold
                        : tokens.typography.weight.regular,
                  }}
                >
                  {step}
                </span>
              </li>
            ))}
          </ol>
          <p
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: `1px solid ${tokens.semantic.divider}`,
              fontSize: tokens.typography.size.xs,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkMuted,
            }}
          >
            Your friend does not need to complete a task for you to get paid. One reward per
            Telegram account, and self-referrals do not count.
          </p>
        </Card>
      </Section>

      <Section title={`Your referrals (${summary.totalReferrals})`}>
        {referrals.length === 0 ? (
          <EmptyState
            icon={<ReferIcon active />}
            title="No referrals yet"
            description={`Share your link with one friend. When they join and set up their PIN, ${formatNaira(
              summary.rewardPerReferralKobo,
            )} lands in your balance.`}
            action={{ label: 'Copy your link', onClick: () => void copyLink(summary.referralLink) }}
          />
        ) : (
          referrals.map((referral) => (
            <Row
              key={referral.id}
              leading={
                <IconTile tone={referral.status === 'QUALIFIED' ? 'success' : 'neutral'}>
                  <ReferIcon active={referral.status === 'QUALIFIED'} />
                </IconTile>
              }
              title={referral.firstName}
              subtitle={
                referral.status === 'QUALIFIED'
                  ? `Qualified ${relativeTime(referral.qualifiedAt)}`
                  : referral.status === 'PENDING'
                    ? `Joined ${relativeTime(referral.createdAt)} · still setting up`
                    : 'Not eligible'
              }
              trailing={
                referral.status === 'QUALIFIED' ? (
                  <span
                    className="fx-tabular"
                    style={{
                      fontSize: tokens.typography.size.base,
                      fontWeight: tokens.typography.weight.semibold,
                      color: tokens.colors.success.strong,
                    }}
                  >
                    {formatNaira(referral.rewardKobo, { signed: true })}
                  </span>
                ) : referral.status === 'PENDING' ? (
                  <Badge tone="warning" mark="clock">Pending</Badge>
                ) : (
                  <Badge tone="neutral" mark="cross">Rejected</Badge>
                )
              }
            />
          ))
        )}
      </Section>
    </div>
  );
}

/**
 * "Someone told you about Fundxtra? Put their code in."
 *
 * Most people hear about a platform from a friend and then open the bot
 * directly — they search for it, or tap a link in a group — and the friend's
 * code never travels with them. The friend gets nothing, concludes that
 * promoting it earned them nothing, and stops. A referral programme can die
 * from a missing text box, and this is the box.
 *
 * It disappears the moment it is used or stops being usable, so nobody is ever
 * looking at an offer they cannot take.
 */
function ClaimCodeCard({
  bonusKobo,
  onClaimed,
}: {
  bonusKobo: number;
  onClaimed: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ bonusKobo?: number; referrerName?: string }>(
        '/referrals/claim',
        { code: code.trim().toUpperCase() },
      );
      haptic.success();
      setDone(
        result.bonusKobo
          ? `${formatNaira(result.bonusKobo)} added${result.referrerName ? ` — thanks to ${result.referrerName}` : ''}.`
          : 'Code added.',
      );
      onClaimed();
    } catch (caught) {
      haptic.error();
      setError(
        caught instanceof ApiError ? (caught.fieldError('code') ?? errorMessage(caught)) : errorMessage(caught),
      );
    } finally {
      setBusy(false);
    }
  }, [code, onClaimed]);

  if (done) {
    return (
      <Card tone="brand" padding={14} style={{ marginBottom: 16 }}>
        <p style={{ fontSize: tokens.typography.size.sm, fontWeight: tokens.typography.weight.semibold, color: tokens.colors.cocoa[800] }}>
          🎉 {done}
        </p>
      </Card>
    );
  }

  return (
    <Card tone="brand" padding={14} style={{ marginBottom: 16 }}>
      <p style={{ fontSize: tokens.typography.size.sm, fontWeight: tokens.typography.weight.semibold, color: tokens.colors.cocoa[800] }}>
        Did a friend tell you about Fundxtra?
      </p>
      <p
        style={{
          marginTop: 4,
          fontSize: tokens.typography.size.xs,
          lineHeight: tokens.typography.leading.relaxed,
          color: tokens.colors.cocoa[700],
        }}
      >
        {bonusKobo > 0
          ? `Enter their code and we will add ${formatNaira(bonusKobo)} to your balance. They get credited too.`
          : 'Enter their code so they get credited for bringing you here.'}
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setError(null);
          }}
          placeholder="FX7K2M9Q"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={16}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '11px 12px',
            fontFamily: tokens.typography.fontMono,
            fontSize: tokens.typography.size.base,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            background: '#fff',
            border: `1px solid ${error ? tokens.colors.danger.base : tokens.semantic.border}`,
            borderRadius: tokens.radii.md,
          }}
        />
        <Button
          size="md"
          loading={busy}
          disabled={busy || code.trim().length < 4}
          onClick={() => void submit()}
        >
          Add
        </Button>
      </div>

      {error && (
        <p role="alert" style={{ marginTop: 8, fontSize: tokens.typography.size.xs, color: tokens.colors.danger.strong }}>
          {error}
        </p>
      )}
    </Card>
  );
}
