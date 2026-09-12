'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { tokens } from '@fundxtra/shared';
import { Button } from './Button';
import { Card } from './Card';

/**
 * Loading, empty, error and success states.
 *
 * Every screen in Fundxtra uses these rather than rendering nothing, because a
 * blank white screen inside Telegram is indistinguishable from a broken app.
 * They are collected in one file so the four states stay visually consistent
 * with each other — an empty state that looks unrelated to its loading state
 * makes an app feel assembled from parts.
 */

/** Skeleton line. Width as a percentage so rows look naturally ragged. */
export function SkeletonLine({
  width = '100%',
  height = 12,
  radius = tokens.radii.xs,
}: {
  width?: string | number;
  height?: number;
  radius?: string;
}) {
  return (
    <div
      className="fx-skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius }}
    />
  );
}

/** A skeleton shaped like the card it replaces, so the layout does not jump. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card padding={16}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <SkeletonLine width={40} height={40} radius={tokens.radii.md} />
        <div style={{ flex: 1, display: 'grid', gap: 8 }}>
          <SkeletonLine width="62%" height={13} />
          <SkeletonLine width="38%" height={11} />
        </div>
      </div>
      {lines > 2 && (
        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          {Array.from({ length: lines - 2 }).map((_, index) => (
            <SkeletonLine key={index} width={index % 2 === 0 ? '92%' : '74%'} height={11} />
          ))}
        </div>
      )}
    </Card>
  );
}

export function SkeletonList({ count = 3, lines = 3 }: { count?: number; lines?: number }) {
  return (
    <div style={{ display: 'grid', gap: 12 }} role="status" aria-live="polite">
      <span className="fx-sr-only">Loading…</span>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} lines={lines} />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void } | undefined;
  secondaryAction?: { label: string; onClick: () => void } | undefined;
}

/**
 * Empty state.
 *
 * Written to explain *why* it is empty and what happens next, not just to say
 * "nothing here" — an empty task list on a young platform is a normal, honest
 * situation and the copy should say so.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '40px 24px',
      }}
    >
      {icon && (
        <div
          aria-hidden="true"
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 64,
            height: 64,
            marginBottom: 16,
            borderRadius: tokens.radii.xl,
            background: tokens.colors.cocoa[50],
            border: `1px solid ${tokens.colors.cocoa[200]}`,
            color: tokens.semantic.brand,
          }}
        >
          {icon}
        </div>
      )}
      <h3
        style={{
          fontSize: tokens.typography.size.lg,
          fontWeight: tokens.typography.weight.semibold,
        }}
      >
        {title}
      </h3>
      {description && (
        <p
          style={{
            marginTop: 6,
            maxWidth: 320,
            fontSize: tokens.typography.size.base,
            lineHeight: tokens.typography.leading.relaxed,
            color: tokens.semantic.inkMuted,
          }}
        >
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
          {action && (
            <Button size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button size="sm" variant="secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Error state.
 *
 * Shows the friendly message and, when present, the request id — so a user
 * contacting support can quote something an admin can actually look up. The
 * underlying technical detail is never rendered here.
 */
export function ErrorState({
  title = 'Something went wrong',
  message = 'Please try again.',
  requestId,
  code,
  status,
  onRetry,
  supportUrl,
}: {
  title?: string;
  message?: string;
  requestId?: string | undefined;
  /** Error code from the API envelope, or NETWORK/TIMEOUT/INTERNAL locally. */
  code?: string | undefined;
  /** HTTP status, 0 when the request never got a response. */
  status?: number | undefined;
  onRetry?: (() => void) | undefined;
  supportUrl?: string | undefined;
}) {
  /*
    A failure with no reference is the hard one to support.

    `requestId` only exists when the API's own error handler produced the
    response. A 502 from the platform while the service restarts, or a proxy
    error page, arrives as a non-JSON body with no reference at all — and the
    card then showed nothing but "Something went wrong", which is
    indistinguishable from a real application error. Showing the code and
    status costs one muted line and turns "it just fails" into something
    answerable.
  */
  const diagnostic = requestId
    ? `Reference: ${requestId}`
    : code || status
      ? `Code: ${[code, status ? `HTTP ${status}` : null].filter(Boolean).join(' · ')}`
      : null;
  return (
    <Card tone="danger" padding={20}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          aria-hidden="true"
          style={{
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            width: 36,
            height: 36,
            borderRadius: tokens.radii.md,
            background: '#fff',
            color: tokens.colors.danger.base,
            border: `1px solid #f3d3ce`,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M12 8v5M12 16.5v.01" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: tokens.typography.size.base, fontWeight: tokens.typography.weight.semibold }}>
            {title}
          </h3>
          <p
            style={{
              marginTop: 4,
              fontSize: tokens.typography.size.sm,
              color: tokens.semantic.inkMuted,
              lineHeight: tokens.typography.leading.relaxed,
            }}
          >
            {message}
          </p>
          {diagnostic && (
            <p
              style={{
                marginTop: 8,
                fontFamily: tokens.typography.fontMono,
                fontSize: tokens.typography.size['2xs'],
                color: tokens.semantic.inkFaint,
              }}
            >
              {diagnostic}
            </p>
          )}
          {(onRetry || supportUrl) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              {onRetry && (
                <Button size="sm" variant="secondary" onClick={onRetry}>
                  Try again
                </Button>
              )}
              {supportUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => window.open(supportUrl, '_blank', 'noopener')}
                >
                  Contact support
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Success state.
 *
 * A spring pop on the tick, which is the one place a little flourish earns its
 * keep — confirming that money arrived should feel like something.
 */
export function SuccessState({
  title,
  message,
  children,
}: {
  title: string;
  message?: string;
  children?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div style={{ textAlign: 'center', padding: '28px 20px' }}>
      <motion.div
        initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        aria-hidden="true"
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 64,
          height: 64,
          margin: '0 auto 16px',
          borderRadius: tokens.radii.pill,
          background: tokens.colors.success.soft,
          border: `1px solid #cfe7d7`,
          color: tokens.colors.success.strong,
        }}
      >
        <motion.svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <motion.path
            d="M5 13l4.2 4.2L19 7.6"
            initial={reduceMotion ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.1, duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          />
        </motion.svg>
      </motion.div>

      <h3 style={{ fontSize: tokens.typography.size.xl, fontWeight: tokens.typography.weight.semibold }}>
        {title}
      </h3>
      {message && (
        <p
          style={{
            marginTop: 8,
            fontSize: tokens.typography.size.base,
            color: tokens.semantic.inkMuted,
            lineHeight: tokens.typography.leading.relaxed,
          }}
        >
          {message}
        </p>
      )}
      {children && <div style={{ marginTop: 20 }}>{children}</div>}
    </div>
  );
}

/** Full-screen loader for the initial Mini App boot. */
export function BootLoader({ message = 'Opening Fundxtra' }: { message?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: tokens.semantic.bg,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <motion.div
          animate={reduceMotion ? undefined : { scale: [1, 1.06, 1], opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ width: 56, margin: '0 auto 18px' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/fundxtra-mark.png" alt="" width={56} height={46} />
        </motion.div>
        <p style={{ fontSize: tokens.typography.size.sm, color: tokens.semantic.inkMuted }}>
          {message}
        </p>
      </div>
    </div>
  );
}

/**
 * Inline "working on it" strip.
 *
 * Sits inside a form rather than replacing the screen, because a full-screen
 * loader after a PIN entry loses the context of what is being confirmed. What
 * matters is that *something* visibly changes the moment the last digit lands:
 * without it the dots simply sit there, the request looks ignored, and people
 * tap again — which is exactly what was reported.
 *
 * `aria-live="polite"` so a screen reader announces it too; the dots alone are
 * invisible to one.
 */
export function InlineWorking({ message }: { message: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        marginTop: 16,
      }}
    >
      <motion.span
        aria-hidden="true"
        animate={reduceMotion ? undefined : { rotate: 360 }}
        transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: `2px solid ${tokens.colors.cocoa[200]}`,
          borderTopColor: tokens.semantic.brand,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: tokens.typography.size.sm,
          fontWeight: tokens.typography.weight.medium,
          color: tokens.semantic.inkMuted,
        }}
      >
        {message}
      </span>
    </div>
  );
}
