'use client';

import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { BLOCKED_PINS, LIMITS, tokens } from '@fundxtra/shared';
import { api, ApiError } from '@/lib/api';
import { supportUrl } from '@/lib/config';
import { haptic, openExternal } from '@/lib/telegram';
import { Button, PinInput } from '@/components/ui';

/**
 * PIN creation and unlock.
 *
 * Two screens sharing one component because they share the keypad, the error
 * handling and the support affordance — and because the difference between
 * them is one server-supplied boolean, not a different flow.
 *
 * Creation is two steps (enter, then confirm) rather than two fields on one
 * screen: on a phone, two 4-digit fields side by side invite typing the same
 * thing twice without reading it. Stepping forces a fresh entry.
 *
 * The PIN never leaves this component except in the request body, is never
 * written to storage, and the "forgot your PIN" path is support-only by design
 * — there is no email on file to reset against, which is the honest consequence
 * of not requiring one.
 */

export interface PinGateProps {
  mode: 'create' | 'unlock';
  firstName: string;
  /** Server-reported lock, if the user already exhausted their attempts. */
  locked?: boolean;
  lockedUntil?: string | null;
  onAuthenticated: (token: string) => void;
}

export function PinGate({
  mode,
  firstName,
  locked = false,
  lockedUntil = null,
  onAuthenticated,
}: PinGateProps) {
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [lockNotice, setLockNotice] = useState<string | null>(
    locked ? lockMessage(lockedUntil) : null,
  );

  // Clear the error as soon as the user starts correcting it, rather than
  // leaving a stale red message under a field they are already fixing.
  useEffect(() => {
    if (value.length > 0 && error) setError(null);
  }, [value, error]);

  const submitCreate = useCallback(
    async (confirmPin: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await api.post<{ token: string }>('/auth/pin', {
          pin: first,
          confirmPin,
        });
        haptic.success();
        onAuthenticated(result.token);
      } catch (caught) {
        haptic.error();
        const message =
          caught instanceof ApiError
            ? (caught.fieldError('pin') ?? caught.fieldError('confirmPin') ?? caught.message)
            : 'We could not set your PIN. Please try again.';
        setError(message);
        // Send them back to the start so the mismatch is unambiguous.
        setStep('enter');
        setFirst('');
        setValue('');
      } finally {
        setSubmitting(false);
      }
    },
    [first, onAuthenticated],
  );

  const submitUnlock = useCallback(
    async (pin: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await api.post<{ token: string }>('/auth/pin/verify', { pin });
        haptic.success();
        onAuthenticated(result.token);
      } catch (caught) {
        haptic.error();
        setValue('');
        if (caught instanceof ApiError) {
          if (caught.code === 'PIN_LOCKED') {
            setLockNotice(
              `Too many attempts. Try again in about ${LIMITS.PIN_LOCK_MINUTES} minutes, or contact support.`,
            );
            setError(null);
          } else {
            setError(caught.message);
            // The server tells us how many attempts remain; showing it is the
            // difference between "wrong PIN" and "wrong PIN, careful now".
            const detail = caught.fields?.attemptsRemaining;
            setAttemptsLeft(detail ? Number(detail) : null);
          }
        } else {
          setError('We could not check your PIN. Please try again.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [onAuthenticated],
  );

  const handleComplete = useCallback(
    (complete: string) => {
      if (submitting || lockNotice) return;

      if (mode === 'unlock') {
        void submitUnlock(complete);
        return;
      }

      if (step === 'enter') {
        if (BLOCKED_PINS.includes(complete)) {
          haptic.error();
          setError('That PIN is too easy to guess. Choose another.');
          setValue('');
          return;
        }
        setFirst(complete);
        setValue('');
        setStep('confirm');
        haptic.light();
        return;
      }

      if (complete !== first) {
        haptic.error();
        setError('Those PINs did not match. Start again.');
        setStep('enter');
        setFirst('');
        setValue('');
        return;
      }
      void submitCreate(complete);
    },
    [submitting, lockNotice, mode, step, first, submitUnlock, submitCreate],
  );

  const heading =
    mode === 'create'
      ? step === 'enter'
        ? 'Create your PIN'
        : 'Confirm your PIN'
      : `Welcome back, ${firstName}`;

  const subheading =
    mode === 'create'
      ? step === 'enter'
        ? 'Choose a 4-digit PIN. You will use it to approve withdrawals and reward redemptions.'
        : 'Enter it once more so we know it is right.'
      : 'Enter your PIN to unlock Fundxtra.';

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '32px 24px calc(32px + env(safe-area-inset-bottom, 0px))',
        background: tokens.semantic.bg,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={tokens.motion.spring.panel}
        style={{ width: '100%', maxWidth: 380, margin: '0 auto' }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/fundxtra-mark.png"
            alt="Fundxtra"
            width={48}
            height={39}
            style={{ margin: '0 auto 20px' }}
          />
          <h1 style={{ fontSize: tokens.typography.size['2xl'] }}>{heading}</h1>
          <p
            style={{
              marginTop: 8,
              fontSize: tokens.typography.size.base,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkMuted,
            }}
          >
            {subheading}
          </p>
        </div>

        {lockNotice ? (
          <div
            role="alert"
            style={{
              padding: 20,
              textAlign: 'center',
              background: tokens.colors.warning.soft,
              border: '1px solid #f0dcb8',
              borderRadius: tokens.radii.lg,
            }}
          >
            <p
              style={{
                fontSize: tokens.typography.size.base,
                color: tokens.colors.warning.strong,
                lineHeight: tokens.typography.leading.relaxed,
              }}
            >
              {lockNotice}
            </p>
            <Button
              variant="secondary"
              size="sm"
              style={{ marginTop: 16 }}
              onClick={() => openExternal(supportUrl)}
            >
              Contact Fundxtra Support
            </Button>
          </div>
        ) : (
          <>
            <PinInput
              key={step}
              value={value}
              onChange={setValue}
              onComplete={handleComplete}
              label={
                mode === 'create' && step === 'confirm' ? 'Re-enter your PIN' : 'Enter your PIN'
              }
              error={error}
              disabled={submitting}
              autoFocus
            />

            {attemptsLeft !== null && attemptsLeft > 0 && !error && (
              <p
                style={{
                  marginTop: 12,
                  textAlign: 'center',
                  fontSize: tokens.typography.size.xs,
                  color: tokens.semantic.inkMuted,
                }}
              >
                {attemptsLeft} {attemptsLeft === 1 ? 'attempt' : 'attempts'} left before a
                temporary lock.
              </p>
            )}

            {mode === 'create' && (
              <p
                style={{
                  marginTop: 24,
                  textAlign: 'center',
                  fontSize: tokens.typography.size.xs,
                  lineHeight: tokens.typography.leading.relaxed,
                  color: tokens.semantic.inkSubtle,
                }}
              >
                Avoid 1234, 0000 or your year of birth. Fundxtra staff will never ask you for
                your PIN.
              </p>
            )}

            {mode === 'unlock' && (
              <div style={{ marginTop: 28, textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => openExternal(supportUrl)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 8,
                    fontSize: tokens.typography.size.sm,
                    color: tokens.semantic.brandInk,
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                  }}
                >
                  Forgot your PIN? Contact Fundxtra Support
                </button>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

function lockMessage(lockedUntil: string | null): string {
  if (!lockedUntil) {
    return `Too many attempts. Try again in about ${LIMITS.PIN_LOCK_MINUTES} minutes, or contact support.`;
  }
  const minutes = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60_000));
  return `Too many attempts. Try again in about ${minutes} ${
    minutes === 1 ? 'minute' : 'minutes'
  }, or contact support.`;
}
