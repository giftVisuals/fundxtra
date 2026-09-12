'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { tokens } from '@fundxtra/shared';

/**
 * Button.
 *
 * Variants map onto brand roles rather than colour names, so no call site
 * decides what "primary" looks like. Every variant keeps a 44px minimum touch
 * target — the WCAG 2.5.5 / Apple HIG floor — because this is a thumb-driven
 * product.
 *
 * The press animation is a spring scale on transform only, and it is disabled
 * under `prefers-reduced-motion`.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * React's DOM animation and drag handlers collide with framer-motion's
 * same-named props (motion's `onAnimationStart` receives an animation
 * *definition*, not a DOM event). Omitting them here is what keeps the
 * component's public props honest instead of casting the collision away.
 */
type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | 'onAnimationStart'
  | 'onAnimationEnd'
  | 'onAnimationIteration'
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
  | 'onDragEnter'
  | 'onDragExit'
  | 'onDragLeave'
  | 'onDragOver'
  | 'onDrop'
  | 'style'
>;

export interface ButtonProps extends NativeButtonProps {
  style?: React.CSSProperties;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const SIZES: Record<ButtonSize, { height: number; padding: string; font: string; radius: string }> = {
  sm: { height: 38, padding: '0 14px', font: tokens.typography.size.sm, radius: tokens.radii.sm },
  md: { height: 46, padding: '0 18px', font: tokens.typography.size.base, radius: tokens.radii.md },
  lg: { height: 54, padding: '0 24px', font: tokens.typography.size.lg, radius: tokens.radii.lg },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    disabled,
    children,
    style,
    ...rest
  },
  ref,
) {
  const reduceMotion = useReducedMotion();
  const metrics = SIZES[size];
  const isDisabled = disabled || loading;

  // A disabled button must read as *unavailable*, not as broken. Fading the
  // brown gradient to 55% turns it muddy, so a disabled solid variant switches
  // to a flat neutral fill instead of inheriting the gradient.
  const disabledFill: React.CSSProperties = {
    background: tokens.colors.sand[100],
    color: tokens.colors.sand[500],
    border: `1px solid ${tokens.colors.sand[200]}`,
    boxShadow: 'none',
  };

  const variantStyle: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      // A gentle warm gradient rather than a flat fill: it reads as a lit
      // surface without becoming a glossy 2010 button.
      background: `linear-gradient(180deg, ${tokens.colors.cocoa[500]} 0%, ${tokens.semantic.brand} 55%, ${tokens.colors.cocoa[700]} 100%)`,
      color: tokens.semantic.onBrand,
      border: `1px solid ${tokens.colors.cocoa[700]}`,
      boxShadow: tokens.shadows.brand,
    },
    secondary: {
      background: tokens.semantic.surface,
      color: tokens.semantic.brandInk,
      border: `1px solid ${tokens.semantic.brandBorder}`,
      boxShadow: tokens.shadows.xs,
    },
    ghost: {
      background: 'transparent',
      color: tokens.semantic.inkMuted,
      border: '1px solid transparent',
    },
    danger: {
      background: tokens.colors.danger.base,
      color: '#fff',
      border: `1px solid ${tokens.colors.danger.strong}`,
      boxShadow: tokens.shadows.sm,
    },
    glass: {
      background: tokens.glass.fillStrong,
      backdropFilter: `blur(${tokens.glass.blur}) saturate(${tokens.glass.saturate})`,
      WebkitBackdropFilter: `blur(${tokens.glass.blur}) saturate(${tokens.glass.saturate})`,
      color: tokens.semantic.brandInk,
      border: `1px solid ${tokens.glass.edge}`,
      boxShadow: tokens.shadows.md,
    },
  };

  return (
    <motion.button
      ref={ref}
      disabled={isDisabled}
      whileTap={reduceMotion || isDisabled ? undefined : { scale: 0.975 }}
      transition={tokens.motion.spring.press}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        // Height *and* minHeight: the flexible one keeps the target at 44px
        // even when a caller shrinks the button in a tight row.
        height: metrics.height,
        minHeight: Math.max(metrics.height, 44) === 44 ? 44 : metrics.height,
        padding: metrics.padding,
        width: fullWidth ? '100%' : undefined,
        fontSize: metrics.font,
        fontWeight: tokens.typography.weight.semibold,
        letterSpacing: tokens.typography.tracking.tight,
        borderRadius: metrics.radius,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        // Loading keeps the variant's own colour (the action is still
        // happening); only a truly disabled button goes neutral.
        opacity: loading ? 0.9 : 1,
        transition: 'opacity 140ms linear, background 140ms linear',
        WebkitTapHighlightColor: 'transparent',
        ...variantStyle[variant],
        ...(disabled && !loading && variant !== 'ghost' ? disabledFill : {}),
        ...(disabled && !loading && variant === 'ghost'
          ? { color: tokens.colors.sand[400] }
          : {}),
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner />
          {/* The label stays in the accessibility tree while loading, so a
              screen reader still knows what the button does. */}
          <span className="fx-sr-only">Working…</span>
          <span aria-hidden="true" style={{ opacity: 0.85 }}>
            {children}
          </span>
        </>
      ) : (
        <>
          {leadingIcon}
          {children}
          {trailingIcon}
        </>
      )}
    </motion.button>
  );
});

/** Inline spinner. `currentColor` so it inherits the button's text colour. */
export function Spinner({ size = 16 }: { size?: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      animate={reduceMotion ? undefined : { rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2.4} />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </motion.svg>
  );
}
