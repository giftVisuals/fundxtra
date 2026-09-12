/**
 * Fundxtra design tokens — the single source of truth for the brand.
 *
 * Identity: **white dominant, warm cocoa brown accents.** The palette is derived
 * from the official logo mark, whose fill samples at `#7b4829`. That exact value
 * is `cocoa.700` and is used for brand text and pressed states. Interactive
 * surfaces use `cocoa.600` (#96603d, 5.2:1 on white — AA for body text), so a
 * primary button never fails contrast.
 *
 * Nothing here is dark-themed. There is deliberately no espresso/near-black
 * brown in the scale: the darkest step, `cocoa.900`, is still a readable warm
 * brown rather than a blackish one.
 *
 * These tokens are emitted as CSS custom properties by `apps/web/app/tokens.css`
 * (generated via `toCssVariables()`), so no component ever hardcodes a brown.
 */

export const colors = {
  /** Warm cocoa — the brand. Light to medium chocolate, never espresso. */
  cocoa: {
    50: '#fdf8f4',
    100: '#f9efe6',
    200: '#f1dccb',
    300: '#e5c1a5',
    400: '#d3a07a',
    500: '#b98058',
    600: '#96603d',
    700: '#7b4829',
    800: '#643a22',
    900: '#512f1e',
  },
  /** Warm neutrals. Grey with a little cocoa in it, so nothing reads cold. */
  sand: {
    0: '#ffffff',
    25: '#fdfcfb',
    50: '#faf8f6',
    100: '#f4f1ee',
    200: '#e8e3de',
    300: '#d6cec7',
    400: '#b3a8a0',
    500: '#8a7d74',
    600: '#685d56',
    700: '#4c443f',
    800: '#332d29',
    900: '#1f1b19',
  },
  /** Semantic states. Muted to sit beside cocoa without shouting. */
  success: { soft: '#eaf6ed', base: '#2f8a4f', strong: '#1f6b3a' },
  warning: { soft: '#fdf3e3', base: '#a9711a', strong: '#84550d' },
  danger: { soft: '#fdeeec', base: '#bf3b2c', strong: '#97281b' },
  info: { soft: '#eef3fa', base: '#33628f', strong: '#244a6f' },
} as const;

/** Semantic aliases. Components reference these, not raw scale steps. */
export const semantic = {
  brand: colors.cocoa[600],
  brandHover: colors.cocoa[700],
  brandActive: colors.cocoa[800],
  brandSoft: colors.cocoa[100],
  brandSofter: colors.cocoa[50],
  brandBorder: colors.cocoa[200],
  brandInk: colors.cocoa[700],
  onBrand: colors.sand[0],

  bg: colors.sand[0],
  bgSubtle: colors.sand[50],
  bgMuted: colors.sand[100],
  surface: colors.sand[0],
  surfaceRaised: colors.sand[25],

  ink: colors.sand[900],
  inkMuted: colors.sand[600],
  inkSubtle: colors.sand[500],
  inkFaint: colors.sand[400],

  border: colors.sand[200],
  borderStrong: colors.sand[300],
  divider: colors.sand[100],

  focusRing: colors.cocoa[500],
} as const;

/**
 * Glass tokens for the Fluid Lucid Glass system.
 *
 * The glass is *light*: a white-leaning translucency lifted by saturation and a
 * warm inner tint, with a specular top edge and a soft lower edge. It never
 * becomes dark or black glass, and the blur stays modest so text behind it reads
 * as depth rather than mush.
 */
export const glass = {
  /** Base translucent fill of a glass surface. */
  fill: 'rgba(255, 255, 255, 0.62)',
  /** Slightly denser fill for the nav bar, which sits over scrolling content. */
  fillStrong: 'rgba(255, 255, 255, 0.72)',
  /** Warm tint layered under the fill so the glass picks up the brand. */
  tint: 'rgba(150, 96, 61, 0.055)',
  /** The morphing active-tab pill. */
  pill: 'rgba(255, 255, 255, 0.88)',
  /** Hairline edge. Light, never a glowing border. */
  edge: 'rgba(255, 255, 255, 0.85)',
  edgeShadow: 'rgba(100, 58, 34, 0.10)',
  /** Specular highlight sweeping the top edge. */
  specular: 'rgba(255, 255, 255, 0.95)',
  blur: '20px',
  blurStrong: '28px',
  saturate: '180%',
  shadow: '0 1px 2px rgba(80, 47, 30, 0.05), 0 8px 24px -8px rgba(80, 47, 30, 0.14), 0 20px 48px -24px rgba(80, 47, 30, 0.18)',
  shadowPill: '0 1px 1px rgba(255,255,255,0.9) inset, 0 -1px 2px rgba(123,72,41,0.06) inset, 0 4px 12px -4px rgba(80, 47, 30, 0.18)',
} as const;

export const radii = {
  xs: '6px',
  sm: '10px',
  md: '14px',
  lg: '18px',
  xl: '24px',
  '2xl': '32px',
  pill: '999px',
} as const;

export const shadows = {
  xs: '0 1px 2px rgba(80, 47, 30, 0.05)',
  sm: '0 1px 3px rgba(80, 47, 30, 0.07), 0 1px 2px rgba(80, 47, 30, 0.04)',
  md: '0 4px 12px -2px rgba(80, 47, 30, 0.09), 0 2px 4px -2px rgba(80, 47, 30, 0.05)',
  lg: '0 12px 28px -8px rgba(80, 47, 30, 0.13), 0 4px 10px -4px rgba(80, 47, 30, 0.07)',
  xl: '0 24px 56px -16px rgba(80, 47, 30, 0.17), 0 8px 20px -8px rgba(80, 47, 30, 0.08)',
  brand: '0 6px 18px -6px rgba(123, 72, 41, 0.42)',
} as const;

/** 4px base scale. */
export const spacing = {
  0: '0px', px: '1px', 0.5: '2px', 1: '4px', 1.5: '6px', 2: '8px', 2.5: '10px',
  3: '12px', 4: '16px', 5: '20px', 6: '24px', 7: '28px', 8: '32px', 10: '40px',
  12: '48px', 14: '56px', 16: '64px', 20: '80px', 24: '96px', 32: '128px',
} as const;

export const typography = {
  fontSans:
    "var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontDisplay:
    "var(--font-display), var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontMono:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  size: {
    '2xs': '0.6875rem', xs: '0.75rem', sm: '0.8125rem', base: '0.875rem',
    md: '0.9375rem', lg: '1.0625rem', xl: '1.25rem', '2xl': '1.5rem',
    '3xl': '1.875rem', '4xl': '2.25rem', '5xl': '2.875rem', '6xl': '3.5rem',
  },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  leading: { tight: '1.15', snug: '1.3', normal: '1.5', relaxed: '1.65' },
  tracking: { tighter: '-0.03em', tight: '-0.015em', normal: '0', wide: '0.02em', wider: '0.08em' },
} as const;

/**
 * Motion. Springs are the primary language — the glass nav is spring-driven, not
 * duration-driven, so it tracks a finger instead of playing an animation.
 */
export const motion = {
  spring: {
    /** Tab pill morph: quick, barely overshoots, settles clean. */
    pill: { type: 'spring', stiffness: 520, damping: 38, mass: 0.85 },
    /** Label reveal: a touch softer so text does not snap. */
    label: { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 },
    /** Panel/section transitions. */
    panel: { type: 'spring', stiffness: 320, damping: 32, mass: 0.9 },
    /** Sheets and modals. */
    sheet: { type: 'spring', stiffness: 300, damping: 30, mass: 1 },
    /** Press feedback. */
    press: { type: 'spring', stiffness: 700, damping: 30, mass: 0.5 },
  },
  duration: { instant: 90, fast: 160, base: 240, slow: 380, slower: 560 },
  easing: {
    standard: 'cubic-bezier(0.32, 0.72, 0, 1)',
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    in: 'cubic-bezier(0.7, 0, 0.84, 0)',
    emphasised: 'cubic-bezier(0.2, 0.9, 0.1, 1)',
  },
} as const;

export const layout = {
  /** Height of the floating glass tab bar (excludes safe-area inset). */
  tabBarHeight: '62px',
  /** Gap between the tab bar and the viewport bottom. */
  tabBarInset: '12px',
  /** Scroll padding so content clears the floating bar. */
  tabBarClearance: '106px',
  /** Mini App content max width — comfortable on tablets without stretching. */
  appMaxWidth: '520px',
  /** Marketing content max width. */
  siteMaxWidth: '1160px',
  /** Minimum touch target, per WCAG 2.5.5 / Apple HIG. */
  touchTarget: '44px',
} as const;

export const zIndex = {
  base: 0, raised: 10, sticky: 100, tabBar: 200, sheet: 300,
  modal: 400, toast: 500, adminBanner: 600,
} as const;

/**
 * Flatten the tokens into CSS custom properties.
 * Consumed at build time to generate `tokens.css`, which is the only place
 * these values enter the stylesheet.
 */
export function toCssVariables(): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const [scale, steps] of Object.entries(colors)) {
    for (const [step, value] of Object.entries(steps as Record<string, string>)) {
      vars[`--fx-${scale}-${step}`] = value;
    }
  }
  for (const [key, value] of Object.entries(semantic)) vars[`--fx-${kebab(key)}`] = value;
  for (const [key, value] of Object.entries(glass)) vars[`--fx-glass-${kebab(key)}`] = value;
  for (const [key, value] of Object.entries(radii)) vars[`--fx-radius-${key}`] = value;
  for (const [key, value] of Object.entries(shadows)) vars[`--fx-shadow-${key}`] = value;
  for (const [key, value] of Object.entries(spacing)) vars[`--fx-space-${key}`] = value;
  for (const [key, value] of Object.entries(typography.size)) vars[`--fx-text-${key}`] = value;
  for (const [key, value] of Object.entries(typography.weight)) vars[`--fx-weight-${key}`] = value;
  for (const [key, value] of Object.entries(typography.leading)) vars[`--fx-leading-${key}`] = value;
  for (const [key, value] of Object.entries(typography.tracking)) vars[`--fx-tracking-${key}`] = value;
  for (const [key, value] of Object.entries(motion.duration)) vars[`--fx-duration-${key}`] = `${value}ms`;
  for (const [key, value] of Object.entries(motion.easing)) vars[`--fx-ease-${key}`] = value;
  for (const [key, value] of Object.entries(layout)) vars[`--fx-${kebab(key)}`] = value;
  for (const [key, value] of Object.entries(zIndex)) vars[`--fx-z-${kebab(key)}`] = String(value);

  vars['--fx-font-sans'] = typography.fontSans;
  vars['--fx-font-display'] = typography.fontDisplay;
  vars['--fx-font-mono'] = typography.fontMono;

  return vars;
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export const tokens = {
  colors, semantic, glass, radii, shadows, spacing, typography, motion, layout, zIndex,
} as const;
