/**
 * Navigation icons.
 *
 * Drawn as inline SVG on a 24px grid with a 1.7px stroke, rather than pulled
 * from an icon library: the tab bar animates `stroke-width` and fill opacity as
 * a tab becomes active, which needs the paths to be under our control. Keeping
 * them here also means the Mini App ships no icon-font or sprite request.
 *
 * Each icon takes an `active` flag so the selected state can thicken the
 * stroke and fill the shape, giving the morph something to interpolate that
 * is not just colour.
 */

export interface NavIconProps {
  active?: boolean;
  className?: string;
}

const base = (active: boolean) => ({
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: active ? 2.1 : 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  focusable: 'false' as const,
});

/** Home — a simple roofline, no chimney fuss at 22px. */
export function HomeIcon({ active = false, className }: NavIconProps) {
  return (
    <svg {...base(active)} className={className}>
      <path d="M3.2 10.4 12 3.6l8.8 6.8v8.2a1.6 1.6 0 0 1-1.6 1.6H4.8a1.6 1.6 0 0 1-1.6-1.6z" />
      <path
        d="M9.3 20.2v-5.1a1.2 1.2 0 0 1 1.2-1.2h3a1.2 1.2 0 0 1 1.2 1.2v5.1"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.16 : 0}
      />
    </svg>
  );
}

/** Earn — a rising chart, echoing the Fundxtra mark without copying it. */
export function EarnIcon({ active = false, className }: NavIconProps) {
  return (
    <svg {...base(active)} className={className}>
      <path d="M3.4 17.6 9 12l3.4 3.4L20.6 7.2" />
      <path d="M15.4 7.2h5.2v5.2" />
      <path
        d="M3.4 20.6h17.2"
        strokeOpacity={active ? 0.9 : 0.45}
      />
    </svg>
  );
}

/** Refer — two people, the second lighter so the shape reads at small size. */
export function ReferIcon({ active = false, className }: NavIconProps) {
  return (
    <svg {...base(active)} className={className}>
      <circle
        cx="9.2"
        cy="8.4"
        r="3.4"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.16 : 0}
      />
      <path d="M3.2 19.4a6 6 0 0 1 12 0" />
      <path d="M16.2 5.4a3.4 3.4 0 0 1 0 6" strokeOpacity={active ? 0.9 : 0.5} />
      <path d="M18 13.6a6 6 0 0 1 2.8 4.4" strokeOpacity={active ? 0.9 : 0.5} />
    </svg>
  );
}

/** Wallet — a card with a clasp; the clasp fills when active. */
export function WalletIcon({ active = false, className }: NavIconProps) {
  return (
    <svg {...base(active)} className={className}>
      <rect x="2.8" y="6.2" width="18.4" height="12.6" rx="3" />
      <path d="M2.8 10.4h18.4" strokeOpacity={active ? 0.9 : 0.5} />
      <circle
        cx="17"
        cy="14.6"
        r="1.5"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.9 : 0}
      />
    </svg>
  );
}

/** Profile — head and shoulders. */
export function ProfileIcon({ active = false, className }: NavIconProps) {
  return (
    <svg {...base(active)} className={className}>
      <circle
        cx="12"
        cy="8.2"
        r="3.6"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.16 : 0}
      />
      <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  );
}

/** Rewards — a gift, used on the rewards sheet trigger. */
export function GiftIcon({ active = false, className }: NavIconProps) {
  return (
    <svg {...base(active)} className={className}>
      <rect x="3.2" y="9.4" width="17.6" height="11" rx="2.2" />
      <path d="M3.2 13.4h17.6M12 9.4v11" />
      <path d="M12 9.4C12 7 10.4 5.2 8.6 5.2a2.2 2.2 0 0 0 0 4.2zM12 9.4c0-2.4 1.6-4.2 3.4-4.2a2.2 2.2 0 0 1 0 4.2z" />
    </svg>
  );
}
