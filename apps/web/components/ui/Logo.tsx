import { LOGO_PATH, LOGO_VIEWBOX } from '@/lib/logo';

/**
 * The Fundxtra mark.
 *
 * Inherits `currentColor`, so it takes the colour of whatever it sits in — the
 * white knock-out on a brown badge and the brown mark on white are the same
 * component, not two assets that can drift apart.
 *
 * Decorative by default: it appears beside the word "Fundxtra" everywhere it
 * is used, so announcing it again would just make a screen reader say the
 * brand name twice. Pass a `title` where it stands alone.
 */
export function Logo({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(LOGO_VIEWBOX)} ${String(LOGO_VIEWBOX)}`}
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      style={{ display: 'block', flexShrink: 0 }}
    >
      {title && <title>{title}</title>}
      <path d={LOGO_PATH} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}
