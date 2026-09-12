'use client';

import { useEffect, useState } from 'react';
import { tokens } from '@fundxtra/shared';

/**
 * Marketing site header.
 *
 * The second place the glass language appears, and the only one outside the
 * Mini App's navigation. It earns it: the header sits over scrolling content
 * and needs to stay readable, which is exactly the problem glass solves.
 *
 * It starts flush and transparent over the hero, then *becomes* glass once the
 * page scrolls — the transition is the point. A permanently glassy header over
 * a white hero would just be a grey bar.
 */
export function SiteHeader({
  startEarningUrl,
  supportUrl,
}: {
  startEarningUrl: string;
  supportUrl: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // Passive listener and a plain boolean: no layout reads, so scrolling
    // stays smooth on a mid-range phone.
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    { href: '#how-it-works', label: 'How it works' },
    { href: '#rewards', label: 'Rewards' },
    { href: '#referrals', label: 'Referrals' },
    { href: '#faq', label: 'FAQ' },
  ];

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: tokens.zIndex.sticky,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: scrolled ? tokens.glass.fillStrong : 'transparent',
        backdropFilter: scrolled
          ? `blur(${tokens.glass.blur}) saturate(${tokens.glass.saturate})`
          : 'none',
        WebkitBackdropFilter: scrolled
          ? `blur(${tokens.glass.blur}) saturate(${tokens.glass.saturate})`
          : 'none',
        borderBottom: `1px solid ${scrolled ? tokens.semantic.border : 'transparent'}`,
        transition: 'background 220ms ease, border-color 220ms ease, backdrop-filter 220ms ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          maxWidth: tokens.layout.siteMaxWidth,
          margin: '0 auto',
          padding: '14px 20px',
        }}
      >
        <a
          href="/"
          aria-label="Fundxtra home"
          style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/fundxtra-mark.png" alt="" width={30} height={25} />
          <span
            style={{
              fontFamily: tokens.typography.fontDisplay,
              fontSize: tokens.typography.size.lg,
              fontWeight: tokens.typography.weight.bold,
              letterSpacing: tokens.typography.tracking.tight,
              color: tokens.semantic.brandInk,
            }}
          >
            Fundxtra
          </span>
        </a>

        {/* Desktop links. Hidden below 880px via the media query in the
            stylesheet below, which is cheaper than a resize listener. */}
        <nav className="fx-site-nav" aria-label="Main">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              style={{
                padding: '8px 10px',
                fontSize: tokens.typography.size.base,
                fontWeight: tokens.typography.weight.medium,
                color: tokens.semantic.inkMuted,
                borderRadius: tokens.radii.sm,
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <a
            href={supportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="fx-site-support"
            style={{
              padding: '8px 12px',
              fontSize: tokens.typography.size.base,
              fontWeight: tokens.typography.weight.medium,
              color: tokens.semantic.inkMuted,
            }}
          >
            Support
          </a>
          <a
            href={startEarningUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              minHeight: 42,
              padding: '0 16px',
              background: `linear-gradient(180deg, ${tokens.colors.cocoa[500]} 0%, ${tokens.semantic.brand} 55%, ${tokens.colors.cocoa[700]} 100%)`,
              color: tokens.semantic.onBrand,
              border: `1px solid ${tokens.colors.cocoa[700]}`,
              borderRadius: tokens.radii.pill,
              fontSize: tokens.typography.size.base,
              fontWeight: tokens.typography.weight.semibold,
              boxShadow: tokens.shadows.brand,
              whiteSpace: 'nowrap',
            }}
          >
            Start earning
          </a>

          <button
            type="button"
            className="fx-site-burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            style={{
              display: 'none',
              width: 42,
              height: 42,
              placeItems: 'center',
              background: tokens.semantic.surface,
              border: `1px solid ${tokens.semantic.border}`,
              borderRadius: tokens.radii.pill,
              color: tokens.semantic.ink,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          aria-label="Main"
          style={{
            padding: '4px 20px 16px',
            borderTop: `1px solid ${tokens.semantic.divider}`,
            background: tokens.semantic.surface,
          }}
        >
          {[...links, { href: supportUrl, label: 'Support' }].map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              style={{
                display: 'block',
                padding: '12px 4px',
                fontSize: tokens.typography.size.md,
                fontWeight: tokens.typography.weight.medium,
                color: tokens.semantic.ink,
                borderBottom: `1px solid ${tokens.semantic.divider}`,
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}

      <style>{`
        .fx-site-nav { display: flex; align-items: center; gap: 2px; }
        @media (max-width: 879px) {
          .fx-site-nav { display: none; }
          .fx-site-support { display: none; }
          .fx-site-burger { display: grid !important; }
        }
      `}</style>
    </header>
  );
}
