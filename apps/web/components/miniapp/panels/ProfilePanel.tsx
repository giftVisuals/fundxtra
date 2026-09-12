'use client';

import { useCallback, useState } from 'react';
import {
  BLOCKED_PINS,
  atHandle,
  formatDate,
  formatNaira,
  initials,
  tokens,
} from '@fundxtra/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { config, supportUrl } from '@/lib/config';
import { haptic, openExternal } from '@/lib/telegram';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, PinInput, Sheet, StatBlock, SuccessState } from '@/components/ui';
import { ProfileIcon } from '@/components/glass';
import { PanelHeader, Row, Section, IconTile } from './shared';

/**
 * Profile.
 *
 * Identity, security and support. There is no "edit profile" here on purpose:
 * the name, username and photo come from Telegram and are refreshed on every
 * sign-in, so editing them locally would create two sources of truth for the
 * same fields and immediately drift.
 *
 * What the user *can* change is the one thing that is genuinely theirs: the PIN.
 */
export function ProfilePanel() {
  const { user, isAdmin, adminRole } = useSession();
  const [sheet, setSheet] = useState<'pin' | 'security' | null>(null);

  if (!user) return null;

  return (
    <div>
      <PanelHeader title="Profile" />

      <Card padding={18} style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div
            aria-hidden="true"
            style={{
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: tokens.colors.cocoa[50],
              border: `1px solid ${tokens.colors.cocoa[200]}`,
              color: tokens.colors.cocoa[700],
              fontSize: tokens.typography.size.lg,
              fontWeight: tokens.typography.weight.bold,
              overflow: 'hidden',
            }}
          >
            {user.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.photoUrl} alt="" width={56} height={56} />
            ) : (
              initials(`${user.firstName} ${user.lastName ?? ''}`)
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              style={{
                fontSize: tokens.typography.size.lg,
                fontWeight: tokens.typography.weight.semibold,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user.firstName} {user.lastName ?? ''}
            </h2>
            <p
              style={{
                marginTop: 2,
                fontSize: tokens.typography.size.sm,
                color: tokens.semantic.inkMuted,
              }}
            >
              {user.username ? atHandle(user.username) : `Telegram ID ${user.telegramId}`}
            </p>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <Badge tone="success" mark="tick">Verified by Telegram</Badge>
              {isAdmin && (
                <Badge tone="brand" mark="none">
                  {(adminRole ?? 'ADMIN').replace('_', ' ').toLowerCase()}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 8,
          marginBottom: 24,
        }}
      >
        <Card padding={14}>
          <StatBlock label="Earned all time" value={formatNaira(user.lifetimeEarnedKobo)} />
        </Card>
        <Card padding={14}>
          <StatBlock label="Member since" value={formatDate(user.createdAt)} />
        </Card>
      </div>

      <Section title="Security">
        <Row
          leading={<IconTile><LockGlyph /></IconTile>}
          title="Change your PIN"
          subtitle="Used to approve withdrawals and redemptions"
          onClick={() => setSheet('pin')}
        />
        <Row
          leading={<IconTile tone="neutral"><ShieldGlyph /></IconTile>}
          title="How Fundxtra keeps you safe"
          subtitle="What we will and will not ask you for"
          onClick={() => setSheet('security')}
        />
      </Section>

      <Section title="Support">
        <Row
          leading={<IconTile tone="success"><ChatGlyph /></IconTile>}
          title="Fundxtra Support"
          subtitle={`${config.supportHandle} · fast answers, then a human if needed`}
          onClick={() => openExternal(supportUrl)}
        />
        <Row
          leading={<IconTile tone="neutral"><DocGlyph /></IconTile>}
          title="Terms and Privacy"
          subtitle="How the platform works and how your data is handled"
          onClick={() => openExternal(`${config.siteUrl}/terms`)}
        />
      </Section>

      {isAdmin && (
        <Section title="Administration">
          <Row
            leading={<IconTile><ProfileIcon active /></IconTile>}
            title="Open the admin panel"
            subtitle="Manage tasks, users, withdrawals and settings"
            onClick={() => window.location.assign('/admin')}
          />
        </Section>
      )}

      <p
        style={{
          padding: '8px 4px 24px',
          textAlign: 'center',
          fontSize: tokens.typography.size.xs,
          color: tokens.semantic.inkFaint,
        }}
      >
        Fundxtra · Telegram ID {user.telegramId}
      </p>

      <ChangePinSheet open={sheet === 'pin'} onClose={() => setSheet(null)} />
      <SecuritySheet open={sheet === 'security'} onClose={() => setSheet(null)} />
    </div>
  );
}

/**
 * PIN change.
 *
 * Three steps — current, new, confirm — each on its own screen so nothing is
 * typed twice by muscle memory. The current PIN goes through the same
 * verification and lockout as the unlock screen, so this endpoint is not a
 * cheaper way to brute force it.
 */
function ChangePinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<'current' | 'new' | 'confirm' | 'done'>('current');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setStep('current');
    setCurrentPin('');
    setNewPin('');
    setValue('');
    setError(null);
  }, []);

  const handleComplete = useCallback(
    async (complete: string) => {
      setError(null);

      if (step === 'current') {
        setCurrentPin(complete);
        setValue('');
        setStep('new');
        return;
      }

      if (step === 'new') {
        if (BLOCKED_PINS.includes(complete)) {
          haptic.error();
          setError('That PIN is too easy to guess. Choose another.');
          setValue('');
          return;
        }
        if (complete === currentPin) {
          haptic.error();
          setError('Choose a PIN you have not used before.');
          setValue('');
          return;
        }
        setNewPin(complete);
        setValue('');
        setStep('confirm');
        return;
      }

      if (complete !== newPin) {
        haptic.error();
        setError('Those PINs did not match. Start again.');
        setStep('new');
        setNewPin('');
        setValue('');
        return;
      }

      setSubmitting(true);
      try {
        await api.post('/auth/pin/change', {
          currentPin,
          newPin,
          confirmPin: complete,
        });
        haptic.success();
        setStep('done');
      } catch (caught) {
        haptic.error();
        const message =
          caught instanceof ApiError
            ? (caught.fieldError('currentPin') ?? caught.message)
            : errorMessage(caught);
        setError(message);
        reset();
      } finally {
        setSubmitting(false);
      }
    },
    [step, currentPin, newPin, reset],
  );

  const labels: Record<typeof step, string> = {
    current: 'Enter your current PIN',
    new: 'Choose your new PIN',
    confirm: 'Confirm your new PIN',
    done: '',
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Change your PIN"
      dismissible={!submitting}
      footer={
        step === 'done' ? (
          <Button
            fullWidth
            size="lg"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Done
          </Button>
        ) : null
      }
    >
      {step === 'done' ? (
        <SuccessState
          title="PIN updated"
          message="Use your new PIN next time you approve a withdrawal or redemption."
        />
      ) : (
        <div style={{ paddingTop: 8 }}>
          <PinInput
            key={step}
            value={value}
            onChange={setValue}
            onComplete={(complete) => void handleComplete(complete)}
            label={labels[step]}
            error={error}
            disabled={submitting}
            autoFocus
          />
          <p
            style={{
              marginTop: 24,
              textAlign: 'center',
              fontSize: tokens.typography.size.xs,
              color: tokens.semantic.inkSubtle,
            }}
          >
            Step {step === 'current' ? 1 : step === 'new' ? 2 : 3} of 3
          </p>
        </div>
      )}
    </Sheet>
  );
}

/**
 * Security explainer.
 *
 * Written as concrete commitments rather than reassurance, because "we take
 * security seriously" tells a user nothing and the specific claims are what
 * make a scam attempt recognisable.
 */
function SecuritySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const points = [
    {
      title: 'Your PIN is never stored in a readable form',
      body: 'It is hashed with a slow algorithm and a value unique to your account, so even we cannot read it.',
    },
    {
      title: 'Fundxtra staff will never ask for your PIN',
      body: 'Not in chat, not on a call, not to "verify" anything. Anyone who does is not us.',
    },
    {
      title: 'Your identity is your Telegram account',
      body: 'There is no email or password to steal, and every session is verified with Telegram before it starts.',
    },
    {
      title: 'Every balance change is recorded',
      body: 'Rewards, referrals, withdrawals and refunds each leave a permanent entry we can show you if you ever query it.',
    },
    {
      title: 'Repeated wrong PINs lock the account briefly',
      body: 'That is deliberate. If it happens to you, wait a few minutes or contact support.',
    },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="How Fundxtra keeps you safe">
      <div style={{ display: 'grid', gap: 16 }}>
        {points.map((point) => (
          <div key={point.title} style={{ display: 'flex', gap: 12 }}>
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                width: 28,
                height: 28,
                borderRadius: tokens.radii.sm,
                background: tokens.colors.success.soft,
                border: '1px solid #cfe7d7',
                color: tokens.colors.success.strong,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5 6 11.5 13 4.5" />
              </svg>
            </span>
            <div>
              <h3
                style={{
                  fontSize: tokens.typography.size.base,
                  fontWeight: tokens.typography.weight.semibold,
                }}
              >
                {point.title}
              </h3>
              <p
                style={{
                  marginTop: 3,
                  fontSize: tokens.typography.size.sm,
                  lineHeight: tokens.typography.leading.relaxed,
                  color: tokens.semantic.inkMuted,
                }}
              >
                {point.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="secondary"
        fullWidth
        style={{ marginTop: 24 }}
        onClick={() => openExternal(supportUrl)}
      >
        Report something suspicious
      </Button>
    </Sheet>
  );
}

function LockGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.6" y="10.4" width="14.8" height="10" rx="2.4" />
      <path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8" />
    </svg>
  );
}

function ShieldGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.2 19.2 6v6c0 4.4-3 7.6-7.2 8.8C7.8 19.6 4.8 16.4 4.8 12V6z" />
      <path d="M9.2 12l2 2 3.6-3.8" />
    </svg>
  );
}

function ChatGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.4 6.8a2.4 2.4 0 0 1 2.4-2.4h10.4a2.4 2.4 0 0 1 2.4 2.4v7.2a2.4 2.4 0 0 1-2.4 2.4H10l-4 3.2v-3.2H6.8a2.4 2.4 0 0 1-2.4-2.4z" />
    </svg>
  );
}

function DocGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.4 3.6h7.2l4.4 4.4v12a1.6 1.6 0 0 1-1.6 1.6H6.4a1.6 1.6 0 0 1-1.6-1.6V5.2a1.6 1.6 0 0 1 1.6-1.6z" />
      <path d="M13.2 3.6V8h4.4M8.4 13h7.2M8.4 16.6h5" />
    </svg>
  );
}
