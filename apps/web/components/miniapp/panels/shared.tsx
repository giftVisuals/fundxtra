'use client';

import type { ReactNode } from 'react';
import { tokens } from '@fundxtra/shared';

/**
 * Panel building blocks.
 *
 * Every panel opens with a `PanelHeader` and groups content into `Section`s, so
 * the five tabs share one rhythm — heading size, vertical spacing, the position
 * of a section action. Without this each panel drifts and the app stops feeling
 * like one product.
 */

export function PanelHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '20px 0 16px',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            fontSize: tokens.typography.size['2xl'],
            letterSpacing: tokens.typography.tracking.tighter,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              marginTop: 4,
              fontSize: tokens.typography.size.base,
              color: tokens.semantic.inkMuted,
              lineHeight: tokens.typography.leading.snug,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </header>
  );
}

export function Section({
  title,
  action,
  children,
  gap = 12,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  gap?: number;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      {(title || action) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 10,
          }}
        >
          {title && (
            <h2
              style={{
                fontSize: tokens.typography.size.sm,
                fontWeight: tokens.typography.weight.semibold,
                letterSpacing: tokens.typography.tracking.wider,
                textTransform: 'uppercase',
                color: tokens.semantic.inkSubtle,
              }}
            >
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      <div style={{ display: 'grid', gap }}>{children}</div>
    </section>
  );
}

/** A tappable row: the pattern for lists of transactions, referrals, settings. */
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  danger = false,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: (() => void) | undefined;
  danger?: boolean;
}) {
  const interactive = Boolean(onClick);
  const Element = interactive ? 'button' : 'div';

  return (
    <Element
      {...(interactive ? { type: 'button' as const, onClick } : {})}
      className={interactive ? 'fx-focus-inset' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        // 56px keeps the row comfortably above the 44px touch-target floor.
        minHeight: 56,
        padding: '12px 14px',
        textAlign: 'left',
        background: tokens.semantic.surface,
        border: `1px solid ${tokens.semantic.border}`,
        borderRadius: tokens.radii.md,
        color: danger ? tokens.colors.danger.strong : tokens.semantic.ink,
        cursor: interactive ? 'pointer' : 'default',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {leading && <div style={{ flexShrink: 0, display: 'flex' }}>{leading}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: tokens.typography.size.base,
            fontWeight: tokens.typography.weight.medium,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              marginTop: 2,
              fontSize: tokens.typography.size.xs,
              color: tokens.semantic.inkMuted,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {trailing && <div style={{ flexShrink: 0, textAlign: 'right' }}>{trailing}</div>}
      {interactive && !trailing && <Chevron />}
    </Element>
  );
}

export function Chevron() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke={tokens.semantic.inkFaint}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

/** A round icon tile, used as the `leading` slot on rows. */
export function IconTile({
  children,
  tone = 'brand',
}: {
  children: ReactNode;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const palette = {
    brand: { bg: tokens.colors.cocoa[50], fg: tokens.semantic.brand, border: tokens.colors.cocoa[200] },
    success: { bg: tokens.colors.success.soft, fg: tokens.colors.success.strong, border: '#cfe7d7' },
    warning: { bg: tokens.colors.warning.soft, fg: tokens.colors.warning.strong, border: '#f0dcb8' },
    danger: { bg: tokens.colors.danger.soft, fg: tokens.colors.danger.strong, border: '#f3d3ce' },
    neutral: { bg: tokens.colors.sand[50], fg: tokens.colors.sand[600], border: tokens.colors.sand[200] },
  }[tone];

  return (
    <div
      aria-hidden="true"
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 38,
        height: 38,
        borderRadius: tokens.radii.md,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.fg,
      }}
    >
      {children}
    </div>
  );
}
