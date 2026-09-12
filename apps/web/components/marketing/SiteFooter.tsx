import { BRAND, tokens } from '@fundxtra/shared';

export function SiteFooter({
  supportHandle,
  supportUrl,
  startEarningUrl,
}: {
  supportHandle: string;
  supportUrl: string;
  startEarningUrl: string;
}) {
  const columns = [
    {
      title: 'Fundxtra',
      links: [
        { href: '#how-it-works', label: 'How it works' },
        { href: '#rewards', label: 'Rewards' },
        { href: '#referrals', label: 'Referrals' },
        { href: '#tasks', label: 'For sponsors' },
      ],
    },
    {
      title: 'Help',
      links: [
        { href: '#faq', label: 'FAQ' },
        { href: supportUrl, label: `Support ${supportHandle}`, external: true },
        { href: '#security', label: 'Security' },
      ],
    },
    {
      title: 'Legal',
      links: [
        { href: '/terms', label: 'Terms of use' },
        { href: '/privacy', label: 'Privacy policy' },
      ],
    },
  ];

  return (
    <footer
      style={{
        padding: '56px 20px 40px',
        background: tokens.colors.sand[50],
        borderTop: `1px solid ${tokens.semantic.border}`,
      }}
    >
      <div style={{ maxWidth: tokens.layout.siteMaxWidth, margin: '0 auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
            gap: 32,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/fundxtra-mark.png" alt="" width={28} height={23} />
              <span
                style={{
                  fontFamily: tokens.typography.fontDisplay,
                  fontSize: tokens.typography.size.lg,
                  fontWeight: tokens.typography.weight.bold,
                  color: tokens.semantic.brandInk,
                }}
              >
                Fundxtra
              </span>
            </div>
            <p
              style={{
                marginTop: 12,
                maxWidth: 280,
                fontSize: tokens.typography.size.sm,
                lineHeight: tokens.typography.leading.relaxed,
                color: tokens.semantic.inkMuted,
              }}
            >
              {BRAND.tagline} A Telegram-first rewards platform paying in Nigerian Naira.
            </p>
            <a
              href={startEarningUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 40,
                marginTop: 18,
                padding: '0 16px',
                background: tokens.semantic.surface,
                color: tokens.semantic.brandInk,
                border: `1px solid ${tokens.semantic.brandBorder}`,
                borderRadius: tokens.radii.pill,
                fontSize: tokens.typography.size.sm,
                fontWeight: tokens.typography.weight.semibold,
              }}
            >
              Open in Telegram
            </a>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <h3
                style={{
                  fontSize: tokens.typography.size.xs,
                  fontWeight: tokens.typography.weight.bold,
                  letterSpacing: tokens.typography.tracking.wider,
                  textTransform: 'uppercase',
                  color: tokens.semantic.inkSubtle,
                }}
              >
                {column.title}
              </h3>
              <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                {column.links.map((link) => (
                  <li key={link.href + link.label}>
                    <a
                      href={link.href}
                      {...('external' in link && link.external
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                      style={{
                        fontSize: tokens.typography.size.base,
                        color: tokens.semantic.inkMuted,
                      }}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'space-between',
            marginTop: 40,
            paddingTop: 22,
            borderTop: `1px solid ${tokens.semantic.border}`,
          }}
        >
          <p style={{ fontSize: tokens.typography.size.xs, color: tokens.semantic.inkSubtle }}>
            © {new Date().getFullYear()} Fundxtra. All rights reserved.
          </p>
          <p
            style={{
              maxWidth: 620,
              fontSize: tokens.typography.size.xs,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkSubtle,
            }}
          >
            Fundxtra pays for completed sponsored tasks and qualified referrals. Earnings depend
            entirely on the tasks available and the work you complete — we do not promise or
            guarantee any level of income.
          </p>
        </div>
      </div>
    </footer>
  );
}
