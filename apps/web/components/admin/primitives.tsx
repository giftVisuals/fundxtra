'use client';

import type { CSSProperties, ReactNode } from 'react';
import { tokens } from '@fundxtra/shared';

/**
 * Admin console primitives.
 *
 * The admin console is a different design problem from the Mini App: an
 * operator needs density and scannability, not thumb-friendly spacing, and
 * they are on a laptop rather than a phone. So this uses tables, tighter
 * padding and smaller type — and almost no glass, because translucency over a
 * data table makes numbers harder to read, which is the opposite of the job.
 *
 * It stays unmistakably Fundxtra through the same tokens: white surfaces, warm
 * cocoa accents, the same status colours.
 */

export function AdminCard({
  title,
  action,
  children,
  padded = true,
  style,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: tokens.semantic.surface,
        border: `1px solid ${tokens.semantic.border}`,
        borderRadius: tokens.radii.md,
        boxShadow: tokens.shadows.xs,
        overflow: 'hidden',
        ...style,
      }}
    >
      {(title || action) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderBottom: `1px solid ${tokens.semantic.divider}`,
            background: tokens.colors.sand[25],
          }}
        >
          {title && (
            <h2
              style={{
                fontSize: tokens.typography.size.sm,
                fontWeight: tokens.typography.weight.semibold,
                letterSpacing: tokens.typography.tracking.wide,
              }}
            >
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      <div style={{ padding: padded ? 16 : 0 }}>{children}</div>
    </section>
  );
}

export function Metric({
  label,
  value,
  delta,
  tone = 'plain',
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: 'plain' | 'brand' | 'warning' | 'danger' | 'success';
}) {
  const accent = {
    plain: tokens.semantic.ink,
    brand: tokens.semantic.brandInk,
    warning: tokens.colors.warning.strong,
    danger: tokens.colors.danger.strong,
    success: tokens.colors.success.strong,
  }[tone];

  return (
    <div
      style={{
        padding: 14,
        background: tokens.semantic.surface,
        border: `1px solid ${tokens.semantic.border}`,
        borderRadius: tokens.radii.sm,
      }}
    >
      <div
        style={{
          fontSize: tokens.typography.size['2xs'],
          fontWeight: tokens.typography.weight.semibold,
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
          marginTop: 5,
          fontFamily: tokens.typography.fontDisplay,
          fontSize: tokens.typography.size['2xl'],
          fontWeight: tokens.typography.weight.bold,
          letterSpacing: tokens.typography.tracking.tight,
          color: accent,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {delta && (
        <div
          style={{
            marginTop: 3,
            fontSize: tokens.typography.size['2xs'],
            color: tokens.semantic.inkMuted,
          }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}

/** Data table. Horizontally scrollable rather than squashed on a narrow screen. */
export function Table({
  columns,
  children,
  empty,
}: {
  columns: string[];
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="fx-scroll" style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          minWidth: 620,
          borderCollapse: 'collapse',
          fontSize: tokens.typography.size.sm,
        }}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                style={{
                  padding: '9px 14px',
                  textAlign: 'left',
                  fontSize: tokens.typography.size['2xs'],
                  fontWeight: tokens.typography.weight.bold,
                  letterSpacing: tokens.typography.tracking.wider,
                  textTransform: 'uppercase',
                  color: tokens.semantic.inkSubtle,
                  borderBottom: `1px solid ${tokens.semantic.border}`,
                  whiteSpace: 'nowrap',
                  background: tokens.colors.sand[25],
                }}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: '36px 14px',
                  textAlign: 'center',
                  color: tokens.semantic.inkSubtle,
                }}
              >
                Nothing here yet.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  align = 'left',
  mono = false,
  nowrap = false,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
  nowrap?: boolean;
}) {
  return (
    <td
      style={{
        padding: '11px 14px',
        textAlign: align,
        borderBottom: `1px solid ${tokens.semantic.divider}`,
        fontFamily: mono ? tokens.typography.fontMono : undefined,
        fontVariantNumeric: align === 'right' ? 'tabular-nums' : undefined,
        whiteSpace: nowrap ? 'nowrap' : undefined,
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const palette = {
    neutral: { bg: tokens.colors.sand[100], fg: tokens.colors.sand[700] },
    brand: { bg: tokens.colors.cocoa[50], fg: tokens.colors.cocoa[700] },
    success: { bg: tokens.colors.success.soft, fg: tokens.colors.success.strong },
    warning: { bg: tokens.colors.warning.soft, fg: tokens.colors.warning.strong },
    danger: { bg: tokens.colors.danger.soft, fg: tokens.colors.danger.strong },
    info: { bg: tokens.colors.info.soft, fg: tokens.colors.info.strong },
  }[tone];

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        background: palette.bg,
        color: palette.fg,
        borderRadius: tokens.radii.xs,
        fontSize: tokens.typography.size['2xs'],
        fontWeight: tokens.typography.weight.bold,
        letterSpacing: tokens.typography.tracking.wide,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function AdminButton({
  children,
  onClick,
  tone = 'default',
  size = 'sm',
  disabled = false,
  loading = false,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'primary' | 'danger' | 'success';
  size?: 'xs' | 'sm';
  disabled?: boolean;
  loading?: boolean;
  title?: string;
}) {
  const palette = {
    default: {
      bg: tokens.semantic.surface,
      fg: tokens.semantic.ink,
      border: tokens.semantic.borderStrong,
    },
    primary: {
      bg: tokens.semantic.brand,
      fg: tokens.semantic.onBrand,
      border: tokens.colors.cocoa[700],
    },
    danger: {
      bg: tokens.colors.danger.base,
      fg: '#fff',
      border: tokens.colors.danger.strong,
    },
    success: {
      bg: tokens.colors.success.base,
      fg: '#fff',
      border: tokens.colors.success.strong,
    },
  }[tone];

  const isOff = disabled || loading;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isOff}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        minHeight: size === 'xs' ? 28 : 34,
        padding: size === 'xs' ? '0 9px' : '0 12px',
        background: isOff ? tokens.colors.sand[100] : palette.bg,
        color: isOff ? tokens.colors.sand[500] : palette.fg,
        border: `1px solid ${isOff ? tokens.colors.sand[200] : palette.border}`,
        borderRadius: tokens.radii.xs,
        fontSize: tokens.typography.size.xs,
        fontWeight: tokens.typography.weight.semibold,
        cursor: isOff ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {loading ? 'Working…' : children}
    </button>
  );
}

export function AdminField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span
        style={{
          display: 'block',
          marginBottom: 5,
          fontSize: tokens.typography.size.xs,
          fontWeight: tokens.typography.weight.semibold,
          color: tokens.semantic.inkMuted,
        }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span
          style={{
            display: 'block',
            marginTop: 5,
            fontSize: tokens.typography.size['2xs'],
            color: tokens.semantic.inkSubtle,
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

export const adminInputStyle: CSSProperties = {
  width: '100%',
  minHeight: 34,
  padding: '0 10px',
  fontSize: tokens.typography.size.sm,
  background: tokens.semantic.bgSubtle,
  border: `1px solid ${tokens.semantic.border}`,
  borderRadius: tokens.radii.xs,
  appearance: 'none',
};

/** A switch whose state is legible without relying on colour. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 9,
        padding: 0,
        background: 'none',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          width: 38,
          height: 22,
          borderRadius: tokens.radii.pill,
          background: checked ? tokens.colors.success.base : tokens.colors.sand[300],
          transition: 'background 160ms ease',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 19 : 3,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
            transition: 'left 160ms ease',
          }}
        />
      </span>
      <span
        style={{
          fontSize: tokens.typography.size.xs,
          fontWeight: tokens.typography.weight.semibold,
          color: checked ? tokens.colors.success.strong : tokens.semantic.inkMuted,
        }}
      >
        {checked ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
