import type { ReactNode } from 'react';
import { formatCount, formatNaira, tokens, type PublicStats } from '@fundxtra/shared';

/**
 * Marketing page sections.
 *
 * Server components — no interactivity, so no JavaScript ships for any of
 * this. The landing page's job is to load fast and build trust on a mobile
 * connection, and the fastest component is one that does not hydrate.
 */

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  tone = 'plain',
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: ReactNode;
  tone?: 'plain' | 'tinted';
}) {
  return (
    <section
      id={id}
      // scroll-margin so an anchor jump does not land under the sticky header.
      style={{
        scrollMarginTop: 80,
        padding: '72px 20px',
        background: tone === 'tinted' ? tokens.colors.cocoa[50] : tokens.semantic.bg,
      }}
    >
      <div style={{ maxWidth: tokens.layout.siteMaxWidth, margin: '0 auto' }}>
        <div style={{ maxWidth: 680 }}>
          {eyebrow && (
            <p
              style={{
                marginBottom: 12,
                fontSize: tokens.typography.size.xs,
                fontWeight: tokens.typography.weight.bold,
                letterSpacing: tokens.typography.tracking.wider,
                textTransform: 'uppercase',
                color: tokens.semantic.brand,
              }}
            >
              {eyebrow}
            </p>
          )}
          <h2
            style={{
              fontSize: 'clamp(1.625rem, 4vw, 2.375rem)',
              letterSpacing: tokens.typography.tracking.tighter,
            }}
          >
            {title}
          </h2>
          {lead && (
            <p
              style={{
                marginTop: 14,
                fontSize: tokens.typography.size.lg,
                lineHeight: tokens.typography.leading.relaxed,
                color: tokens.semantic.inkMuted,
              }}
            >
              {lead}
            </p>
          )}
        </div>
        {children && <div style={{ marginTop: 36 }}>{children}</div>}
      </div>
    </section>
  );
}

export function Grid({
  children,
  min = 260,
  gap = 16,
}: {
  children: ReactNode;
  min?: number;
  gap?: number;
}) {
  return (
    <div
      style={{
        display: 'grid',
        // auto-fit + minmax: responsive without a single media query, and it
        // degrades to one column on a phone without extra markup.
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`,
        gap,
      }}
    >
      {children}
    </div>
  );
}

export function FeatureCard({
  icon,
  title,
  body,
  footnote,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  footnote?: string;
}) {
  return (
    <div
      style={{
        padding: 22,
        background: tokens.semantic.surface,
        border: `1px solid ${tokens.semantic.border}`,
        borderRadius: tokens.radii.lg,
        boxShadow: tokens.shadows.xs,
        height: '100%',
      }}
    >
      {icon && (
        <div
          aria-hidden="true"
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 44,
            height: 44,
            marginBottom: 16,
            borderRadius: tokens.radii.md,
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
      <p
        style={{
          marginTop: 8,
          fontSize: tokens.typography.size.base,
          lineHeight: tokens.typography.leading.relaxed,
          color: tokens.semantic.inkMuted,
        }}
      >
        {body}
      </p>
      {footnote && (
        <p
          style={{
            marginTop: 12,
            fontSize: tokens.typography.size.xs,
            color: tokens.semantic.inkSubtle,
          }}
        >
          {footnote}
        </p>
      )}
    </div>
  );
}

export function StepList({ steps }: { steps: Array<{ title: string; body: string }> }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
      {steps.map((step, index) => (
        <li
          key={step.title}
          style={{
            display: 'flex',
            gap: 18,
            padding: '18px 0',
            borderBottom:
              index === steps.length - 1 ? 'none' : `1px solid ${tokens.semantic.divider}`,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              width: 34,
              height: 34,
              borderRadius: tokens.radii.pill,
              background: tokens.semantic.brand,
              color: tokens.semantic.onBrand,
              fontSize: tokens.typography.size.sm,
              fontWeight: tokens.typography.weight.bold,
            }}
          >
            {index + 1}
          </span>
          <div>
            <h3
              style={{
                fontSize: tokens.typography.size.lg,
                fontWeight: tokens.typography.weight.semibold,
              }}
            >
              {step.title}
            </h3>
            <p
              style={{
                marginTop: 5,
                fontSize: tokens.typography.size.base,
                lineHeight: tokens.typography.leading.relaxed,
                color: tokens.semantic.inkMuted,
              }}
            >
              {step.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Platform statistics.
 *
 * The `sufficientData` flag comes from the API and is the honesty mechanism:
 * below the threshold the platform is too young for these figures to mean
 * anything, so the section renders an early-stage message instead of numbers.
 * We would rather say "we are new" than publish an unimpressive or invented
 * total — and a visitor who later discovers a fabricated figure would be right
 * never to trust the platform again.
 */
export function StatsPanel({ stats }: { stats: PublicStats | null }) {
  if (!stats || !stats.sufficientData) {
    return (
      <div
        style={{
          padding: 28,
          background: tokens.semantic.surface,
          border: `1px solid ${tokens.colors.cocoa[200]}`,
          borderRadius: tokens.radii.xl,
          textAlign: 'center',
        }}
      >
        <p
          style={{
            fontSize: tokens.typography.size.lg,
            fontWeight: tokens.typography.weight.semibold,
          }}
        >
          Fundxtra is new, and we would rather say so
        </p>
        <p
          style={{
            margin: '10px auto 0',
            maxWidth: 520,
            fontSize: tokens.typography.size.base,
            lineHeight: tokens.typography.leading.relaxed,
            color: tokens.semantic.inkMuted,
          }}
        >
          We publish platform totals from our own records, not from marketing
          copy. There is not enough activity yet for those numbers to mean
          anything, so this is where they will appear once there is — real
          figures, straight from the database.
        </p>
      </div>
    );
  }

  const figures = [
    { label: 'Registered users', value: formatCount(stats.totalUsers, true) },
    { label: 'Rewards paid out', value: formatNaira(stats.totalPaidOutKobo, { compact: true }) },
    { label: 'Tasks completed', value: formatCount(stats.totalTasksCompleted, true) },
    { label: 'Active campaigns', value: formatCount(stats.activeCampaigns) },
  ];

  return (
    <div>
      <Grid min={190} gap={12}>
        {figures.map((figure) => (
          <div
            key={figure.label}
            style={{
              padding: 22,
              background: tokens.semantic.surface,
              border: `1px solid ${tokens.semantic.border}`,
              borderRadius: tokens.radii.lg,
              boxShadow: tokens.shadows.xs,
            }}
          >
            <div
              className="fx-tabular"
              style={{
                fontFamily: tokens.typography.fontDisplay,
                fontSize: tokens.typography.size['3xl'],
                fontWeight: tokens.typography.weight.bold,
                letterSpacing: tokens.typography.tracking.tighter,
                color: tokens.semantic.brandInk,
              }}
            >
              {figure.value}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: tokens.typography.size.sm,
                color: tokens.semantic.inkMuted,
              }}
            >
              {figure.label}
            </div>
          </div>
        ))}
      </Grid>
      <p
        style={{
          marginTop: 14,
          fontSize: tokens.typography.size.xs,
          color: tokens.semantic.inkSubtle,
        }}
      >
        Taken from our own records and refreshed regularly. Last updated{' '}
        {new Date(stats.updatedAt).toLocaleDateString('en-NG', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
        .
      </p>
    </div>
  );
}

/** FAQ built on <details>, so it works with JavaScript disabled. */
export function Faq({ items }: { items: Array<{ question: string; answer: string }> }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((item) => (
        <details
          key={item.question}
          style={{
            padding: '16px 18px',
            background: tokens.semantic.surface,
            border: `1px solid ${tokens.semantic.border}`,
            borderRadius: tokens.radii.md,
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              fontSize: tokens.typography.size.md,
              fontWeight: tokens.typography.weight.semibold,
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            {item.question}
            <span
              aria-hidden="true"
              style={{ flexShrink: 0, color: tokens.semantic.brand, fontSize: 20, lineHeight: 1 }}
            >
              +
            </span>
          </summary>
          <p
            style={{
              marginTop: 12,
              fontSize: tokens.typography.size.base,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkMuted,
            }}
          >
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
