import type { ReactNode } from 'react';
import { tokens } from '@fundxtra/shared';

/**
 * Status badge.
 *
 * Every badge pairs a colour with a **shape cue** — a filled dot, a ring, or a
 * tick — so status is never conveyed by colour alone. That is a WCAG 1.4.1
 * requirement and it also matters practically: a rejected task and an approved
 * one must be distinguishable in a screenshot, in bright sunlight, and by a
 * colour-blind user.
 */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<BadgeTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: tokens.colors.sand[100], fg: tokens.colors.sand[700], border: tokens.colors.sand[200] },
  brand: { bg: tokens.colors.cocoa[50], fg: tokens.colors.cocoa[700], border: tokens.colors.cocoa[200] },
  success: { bg: tokens.colors.success.soft, fg: tokens.colors.success.strong, border: '#cfe7d7' },
  warning: { bg: tokens.colors.warning.soft, fg: tokens.colors.warning.strong, border: '#f0dcb8' },
  danger: { bg: tokens.colors.danger.soft, fg: tokens.colors.danger.strong, border: '#f3d3ce' },
  info: { bg: tokens.colors.info.soft, fg: tokens.colors.info.strong, border: '#d3e0ee' },
};

/** Shape cues, so the tone is legible without colour. */
export type BadgeMark = 'none' | 'dot' | 'ring' | 'tick' | 'cross' | 'clock';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  mark?: BadgeMark;
  size?: 'sm' | 'md';
}

export function Badge({ children, tone = 'neutral', mark = 'dot', size = 'sm' }: BadgeProps) {
  const palette = TONES[tone];
  const compact = size === 'sm';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: compact ? '3px 8px' : '5px 10px',
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        borderRadius: tokens.radii.pill,
        fontSize: compact ? tokens.typography.size['2xs'] : tokens.typography.size.xs,
        fontWeight: tokens.typography.weight.semibold,
        letterSpacing: tokens.typography.tracking.wide,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      <BadgeIcon mark={mark} />
      {children}
    </span>
  );
}

function BadgeIcon({ mark }: { mark: BadgeMark }) {
  if (mark === 'none') return null;

  if (mark === 'dot') {
    return (
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'currentColor',
          flexShrink: 0,
        }}
      />
    );
  }

  if (mark === 'ring') {
    return (
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          border: '1.5px solid currentColor',
          flexShrink: 0,
        }}
      />
    );
  }

  const paths: Record<'tick' | 'cross' | 'clock', ReactNode> = {
    tick: <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />,
    cross: <path d="M4 4l8 8M12 4l-8 8" />,
    clock: (
      <>
        <circle cx="8" cy="8" r="5.6" />
        <path d="M8 4.8V8l2.2 1.8" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {paths[mark as 'tick' | 'cross' | 'clock']}
    </svg>
  );
}
