'use client';

import { useState } from 'react';
import { tokens } from '@fundxtra/shared';

/**
 * Admin preview banner.
 *
 * When an admin opens the Mini App they are looking at a *normal user account* —
 * their own. The requirement is that this is unmistakable, so administrators
 * never mistake their own balance or task list for a user's, and never assume a
 * reward worked for everyone because it worked for them.
 *
 * It is deliberately hard to miss (pinned, high contrast, above everything) and
 * only collapsible, never dismissible: an admin who hides it still sees the
 * marker, because the whole point is that the state is always visible.
 */
export function AdminPreviewBanner({ role }: { role: string | null }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      role="status"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: tokens.zIndex.adminBanner,
        background: `linear-gradient(90deg, ${tokens.colors.cocoa[700]}, ${tokens.colors.cocoa[600]})`,
        color: '#fff',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          maxWidth: tokens.layout.appMaxWidth,
          margin: '0 auto',
          padding: collapsed ? '5px 16px' : '9px 16px',
          transition: 'padding 160ms ease',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#fff',
            flexShrink: 0,
            boxShadow: '0 0 0 3px rgba(255,255,255,0.25)',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: tokens.typography.size['2xs'],
              fontWeight: tokens.typography.weight.bold,
              letterSpacing: tokens.typography.tracking.wider,
              textTransform: 'uppercase',
            }}
          >
            Admin preview mode
          </p>
          {!collapsed && (
            <p
              style={{
                marginTop: 2,
                fontSize: tokens.typography.size['2xs'],
                opacity: 0.88,
                lineHeight: 1.4,
              }}
            >
              You are viewing Fundxtra as your own user account
              {role ? ` · signed in as ${role.replace('_', ' ').toLowerCase()}` : ''}
            </p>
          )}
        </div>
        <a
          href="/admin"
          style={{
            flexShrink: 0,
            padding: '4px 10px',
            fontSize: tokens.typography.size['2xs'],
            fontWeight: tokens.typography.weight.semibold,
            color: tokens.colors.cocoa[800],
            background: '#fff',
            borderRadius: tokens.radii.pill,
            whiteSpace: 'nowrap',
          }}
        >
          Admin panel
        </a>
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-label={collapsed ? 'Expand admin notice' : 'Collapse admin notice'}
          aria-expanded={!collapsed}
          style={{
            flexShrink: 0,
            width: 24,
            height: 24,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(255,255,255,0.16)',
            border: 'none',
            borderRadius: '50%',
            color: '#fff',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: collapsed ? 'rotate(180deg)' : 'none',
              transition: 'transform 160ms ease',
            }}
          >
            <path d="M3.5 10 8 5.5 12.5 10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
