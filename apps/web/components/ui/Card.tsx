import type { CSSProperties, ReactNode } from 'react';
import { tokens } from '@fundxtra/shared';

/**
 * Card.
 *
 * White surface with a hairline warm border, which is the workhorse container
 * for both surfaces. `tone` tints the background for state (a rejected task, a
 * success confirmation) without ever going dark.
 *
 * Glass is deliberately *not* the default here. The brief was explicit that the
 * effect should be concentrated in the navigation; a page of translucent cards
 * stacked on each other is exactly the cheap look to avoid, and it makes text
 * harder to read over scrolling content.
 */

export type CardTone = 'plain' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface CardProps {
  children: ReactNode;
  tone?: CardTone;
  /** Adds the glass treatment. Use sparingly — see the note above. */
  glass?: boolean;
  padding?: number | string;
  radius?: string;
  className?: string;
  style?: CSSProperties;
  as?: 'div' | 'section' | 'article' | 'li';
}

const TONES: Record<CardTone, { background: string; border: string }> = {
  plain: { background: tokens.semantic.surface, border: tokens.semantic.border },
  brand: { background: tokens.colors.cocoa[50], border: tokens.colors.cocoa[200] },
  success: { background: tokens.colors.success.soft, border: '#cfe7d7' },
  warning: { background: tokens.colors.warning.soft, border: '#f0dcb8' },
  danger: { background: tokens.colors.danger.soft, border: '#f3d3ce' },
  info: { background: tokens.colors.info.soft, border: '#d3e0ee' },
};

export function Card({
  children,
  tone = 'plain',
  glass = false,
  padding = 16,
  radius = tokens.radii.lg,
  className,
  style,
  as: Element = 'div',
}: CardProps) {
  const palette = TONES[tone];

  return (
    <Element
      className={glass ? `fx-glass-simple ${className ?? ''}`.trim() : className}
      style={{
        background: glass ? undefined : palette.background,
        border: `1px solid ${glass ? tokens.glass.edge : palette.border}`,
        borderRadius: radius,
        padding,
        boxShadow: glass ? undefined : tokens.shadows.xs,
        ...style,
      }}
    >
      {children}
    </Element>
  );
}

/** A labelled figure: the pattern used for balances and statistics. */
export function StatBlock({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: tokens.typography.size.xs,
          fontWeight: tokens.typography.weight.medium,
          letterSpacing: tokens.typography.tracking.wider,
          textTransform: 'uppercase',
          color: tokens.semantic.inkSubtle,
        }}
      >
        {label}
      </div>
      <div
        className="fx-tabular"
        style={{
          marginTop: 4,
          fontFamily: tokens.typography.fontDisplay,
          fontSize: emphasis ? tokens.typography.size['3xl'] : tokens.typography.size.xl,
          fontWeight: tokens.typography.weight.semibold,
          letterSpacing: tokens.typography.tracking.tight,
          color: emphasis ? tokens.semantic.brandInk : tokens.semantic.ink,
          lineHeight: tokens.typography.leading.tight,
        }}
      >
        {value}
      </div>
      {hint && (
        <div
          style={{
            marginTop: 4,
            fontSize: tokens.typography.size.xs,
            color: tokens.semantic.inkMuted,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
