import { tokens } from '@fundxtra/shared';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { fallbackConfig, getPublicConfig } from '@/lib/public-data';

/**
 * Marketing layout.
 *
 * A separate route group from the Mini App because the two surfaces have
 * genuinely different jobs: this one is public, indexed, has a header and a
 * footer, and must render even when the API is unreachable. The Mini App is
 * authenticated, never indexed, and is all navigation and balance.
 *
 * They share the design tokens, the components and the backend — which is what
 * keeps them looking like one product without pretending to be the same page.
 */
export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = (await getPublicConfig()) ?? fallbackConfig();

  return (
    <div style={{ background: tokens.semantic.bg, minHeight: '100dvh' }}>
      {/* Keyboard users land here first and can jump the whole header. */}
      <a href="#main" className="fx-skip-link">
        Skip to content
      </a>

      {config.maintenance.active && config.maintenance.message && (
        <div
          role="status"
          style={{
            padding: '10px 20px',
            background: tokens.colors.warning.soft,
            borderBottom: '1px solid #f0dcb8',
            color: tokens.colors.warning.strong,
            fontSize: tokens.typography.size.sm,
            textAlign: 'center',
          }}
        >
          {config.maintenance.message}
        </div>
      )}

      <SiteHeader
        startEarningUrl={config.startEarningUrl}
        supportUrl={config.brand.supportUrl}
      />

      <main id="main">{children}</main>

      <SiteFooter
        supportHandle={config.brand.supportHandle}
        supportUrl={config.brand.supportUrl}
        startEarningUrl={config.startEarningUrl}
      />
    </div>
  );
}
