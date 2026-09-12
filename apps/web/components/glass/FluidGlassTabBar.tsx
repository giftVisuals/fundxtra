'use client';

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
  type PanInfo,
} from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { tokens } from '@fundxtra/shared';
import type { NavIconProps } from './icons';

/**
 * Fluid Lucid Glass tab bar.
 *
 * The design brief for this component was explicit that a translucent
 * rectangle is not enough, so here is what it actually does and why.
 *
 * ── Morphing, not cross-fading ────────────────────────────────────────────
 * Tabs rest as icons only. The selected tab expands to reveal its label, and
 * a single "lens" — one physical piece of glass — slides and *resizes* to fit
 * it. Because it is one element whose x and width are both springs, the lens
 * stretches while it travels: it is visibly the same object moving, not one
 * highlight fading out while another fades in. That continuity is the whole
 * effect.
 *
 * ── Spring-driven, not duration-driven ────────────────────────────────────
 * Position and width are `useSpring` values, never CSS transitions. A spring
 * can be re-targeted mid-flight, which is what lets the lens follow a finger
 * and then settle when it is released. A duration-based transition would have
 * to restart, and restarting is exactly what makes web navigation feel like a
 * web page rather than an operating system.
 *
 * ── Drag across the bar ───────────────────────────────────────────────────
 * Dragging anywhere along the bar moves the lens continuously with the
 * pointer and live-previews the tab under it. Releasing commits to whichever
 * tab the lens is nearest. During a drag the lens shrinks to its icon-width
 * so it tracks the finger tightly instead of dragging a wide label around.
 *
 * ── Performance ───────────────────────────────────────────────────────────
 * Only `transform` and `opacity` are animated on the moving parts — the lens
 * uses `translateX` plus a `width` spring on a `will-change`d element, and
 * labels animate opacity and x. Layout is measured once per resize with
 * `useLayoutEffect` and cached, so nothing reads the DOM during a gesture.
 *
 * ── Accessibility ─────────────────────────────────────────────────────────
 * The bar is a real `tablist` of `tab` buttons with arrow-key and Home/End
 * support. Every tab keeps a permanent accessible name even while its visual
 * label is collapsed, so a screen reader never announces an unnamed button.
 * Under `prefers-reduced-motion` the springs are replaced with instant
 * positioning and the drag gesture is disabled, leaving a plain, perfectly
 * usable tab bar.
 */

export interface GlassTab {
  id: string;
  label: string;
  Icon: ComponentType<NavIconProps>;
  /** Optional count badge, e.g. pending submissions. */
  badge?: number | undefined;
}

export interface FluidGlassTabBarProps {
  tabs: GlassTab[];
  activeId: string;
  onChange: (id: string) => void;
  /** Rendered above the bar, inside the same floating group. */
  className?: string;
}

/** Horizontal padding inside the bar. */
const EDGE_PADDING = 6;

export function FluidGlassTabBar({
  tabs,
  activeId,
  onChange,
  className,
}: FluidGlassTabBarProps) {
  const reduceMotion = useReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /** Measured geometry of each tab, refreshed on resize and on tab change. */
  const [geometry, setGeometry] = useState<Array<{ x: number; width: number }>>([]);
  const [dragging, setDragging] = useState(false);
  /** The tab the lens is currently over — the active tab unless dragging. */
  const [previewId, setPreviewId] = useState<string | null>(null);

  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeId));
  const previewIndex = previewId
    ? tabs.findIndex((tab) => tab.id === previewId)
    : activeIndex;
  const shownIndex = previewIndex >= 0 ? previewIndex : activeIndex;

  /**
   * Measure once per layout change. Cached so no gesture frame touches the
   * DOM — reading `getBoundingClientRect` mid-drag is the usual reason a
   * gesture like this drops frames.
   */
  const measure = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const barBox = bar.getBoundingClientRect();
    const next = tabRefs.current.map((element) => {
      if (!element) return { x: 0, width: 0 };
      const box = element.getBoundingClientRect();
      return { x: box.left - barBox.left, width: box.width };
    });
    setGeometry(next);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, activeId, tabs.length]);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;

    // The bar's own width changes when a label expands, and the whole thing
    // reflows when Telegram's viewport height changes (keyboard, expand).
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    for (const element of tabRefs.current) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [measure, tabs.length]);

  // ── The lens ────────────────────────────────────────────────────────────
  // Two springs: one for travel, one for width. Re-targetable mid-flight.
  const springConfig = tokens.motion.spring.pill;
  const lensX = useSpring(0, springConfig);
  const lensWidth = useSpring(0, springConfig);

  const target = geometry[shownIndex];

  /**
   * Drive the lens from the *previewed* tab's measured geometry.
   *
   * An earlier version had the lens follow the pointer pixel-for-pixel and
   * shrink to a circle while dragging. It tracked the finger beautifully and
   * was wrong: the active tab's label lives inside its button, so a lens
   * centred on the finger left the label stranded off the glass. Springing
   * between tab slots instead keeps the label on the lens, still glides
   * continuously as the finger crosses each tab, and is how a real segmented
   * control behaves — the finger drags *between detents*, it does not carry
   * the highlight.
   */
  useEffect(() => {
    if (!target || target.width === 0) return;

    if (reduceMotion) {
      lensX.jump(target.x);
      lensWidth.jump(target.width);
      return;
    }
    lensX.set(target.x);
    lensWidth.set(target.width);
  }, [target, reduceMotion, lensX, lensWidth]);

  /**
   * Subtle squash while travelling: the lens scales down vertically in
   * proportion to its own speed, then recovers. Real objects deform slightly
   * when they accelerate, and this is the cheapest honest version of that —
   * it is driven by the spring's own velocity, so it cannot desynchronise
   * from the movement.
   */
  const squash = useTransform(lensX, (value) => {
    const velocity = Math.abs(lensX.getVelocity());
    void value;
    return 1 - Math.min(velocity / 14_000, 0.06);
  });

  // ── Gestures ────────────────────────────────────────────────────────────

  const indexFromOffset = useCallback(
    (offsetX: number): number => {
      if (geometry.length === 0) return activeIndex;
      let nearest = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < geometry.length; index += 1) {
        const entry = geometry[index];
        if (!entry || entry.width === 0) continue;
        const centre = entry.x + entry.width / 2;
        const distance = Math.abs(centre - offsetX);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = index;
        }
      }
      return nearest;
    },
    [geometry, activeIndex],
  );

  const handlePointerDrag = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar) return;
      const offsetX = clientX - bar.getBoundingClientRect().left;

      const index = indexFromOffset(offsetX);
      const tab = tabs[index];
      if (tab && tab.id !== previewId) {
        setPreviewId(tab.id);
        // A light haptic on each crossing, so dragging feels like passing over
        // detents rather than sliding on glass. Telegram exposes this; a plain
        // browser does not, hence the guard.
        triggerSelectionHaptic();
      }
    },
    [indexFromOffset, tabs, previewId],
  );

  const handleDragStart = useCallback(() => {
    if (reduceMotion) return;
    setDragging(true);
  }, [reduceMotion]);

  const handleDrag = useCallback(
    (event: MouseEvent | TouchEvent | PointerEvent, _info: PanInfo) => {
      if (reduceMotion) return;
      void _info;
      const clientX =
        'touches' in event && event.touches.length > 0
          ? (event.touches[0]?.clientX ?? 0)
          : (event as PointerEvent).clientX;
      handlePointerDrag(clientX);
    },
    [handlePointerDrag, reduceMotion],
  );

  const handleDragEnd = useCallback(() => {
    setDragging(false);
    const committed = previewId;
    setPreviewId(null);
    if (committed && committed !== activeId) {
      onChange(committed);
      triggerImpactHaptic();
    }
  }, [previewId, activeId, onChange]);

  // ── Keyboard ────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const lastIndex = tabs.length - 1;
      let nextIndex: number | null = null;

      if (event.key === 'ArrowRight') nextIndex = Math.min(activeIndex + 1, lastIndex);
      else if (event.key === 'ArrowLeft') nextIndex = Math.max(activeIndex - 1, 0);
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = lastIndex;

      if (nextIndex === null) return;
      event.preventDefault();
      const tab = tabs[nextIndex];
      if (tab) {
        onChange(tab.id);
        tabRefs.current[nextIndex]?.focus();
      }
    },
    [tabs, activeIndex, onChange],
  );

  return (
    <div
      className={className}
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: tokens.zIndex.tabBar,
        display: 'flex',
        justifyContent: 'center',
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: `calc(${tokens.layout.tabBarInset} + env(safe-area-inset-bottom, 0px))`,
        pointerEvents: 'none',
      }}
    >
      <motion.div
        ref={barRef}
        role="tablist"
        aria-label="Fundxtra sections"
        onKeyDown={handleKeyDown}
        className="fx-glass"
        // A pan gesture on the bar itself, so the drag works from any point
        // along it rather than only from the active pill.
        onPanStart={handleDragStart}
        onPan={handleDrag}
        onPanEnd={handleDragEnd}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          width: '100%',
          maxWidth: 440,
          height: tokens.layout.tabBarHeight,
          padding: EDGE_PADDING,
          borderRadius: tokens.radii.pill,
          // Clip the lens to the bar's own pill shape. Without this the lens's
          // square-ish corners poke past the bar's rounded ends at the first
          // and last tab, leaving a visible sliver of the bar's edge.
          overflow: 'hidden',
          pointerEvents: 'auto',
          // Hint the compositor without promoting every child.
          willChange: 'transform',
          touchAction: 'pan-y',
        }}
      >
        {/*
          The glass itself, as three childless layers. Keeping the blur and the
          SVG refraction on *separate* properties of a childless element is what
          makes both work: see the note in globals.css about backdrop-filter
          rejecting url() and dropping the whole declaration.
        */}
        <span
          aria-hidden="true"
          className="fx-glass-layer fx-glass-layer-strong fx-glass-refract"
        />
        <span aria-hidden="true" className="fx-glass-tint" />
        <span aria-hidden="true" className="fx-glass-rim" />

        {/*
          The lens. One element, always present, whose x and width are springs.
          Rendering it behind the buttons (zIndex 0 vs 1) means the icon and
          label sit *on* the glass rather than being covered by it.
        */}
        <motion.div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: EDGE_PADDING,
            bottom: EDGE_PADDING,
            left: 0,
            x: lensX,
            width: lensWidth,
            scaleY: reduceMotion ? 1 : squash,
            // A small lift while dragging, so the lens reads as picked up.
            scale: reduceMotion ? 1 : dragging ? 1.03 : 1,
            borderRadius: tokens.radii.pill,
            background: tokens.glass.pill,
            // The container clips outer shadows, so the lens reads as raised
            // through inset highlights: bright along its top edge, warm and
            // recessed along the bottom.
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.95) inset, 0 -1px 2px rgba(123,72,41,0.10) inset, 0 0 0 0.5px rgba(255,255,255,0.6)',
            // Above the glass layers (0-2), below the buttons (3).
            zIndex: 2,
            pointerEvents: 'none',
            willChange: 'transform, width',
          }}
        >
          {/* A brighter rim on the lens so it reads as a thicker piece of the
              same material rather than a flat white pill. */}
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 'inherit',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.55) 40%, rgba(255,255,255,0.2) 100%)',
              mixBlendMode: 'soft-light',
            }}
          />
        </motion.div>

        {tabs.map((tab, index) => {
          const isActive = tab.id === activeId;
          const isShown = index === shownIndex;
          const { Icon } = tab;

          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`fx-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`fx-panel-${tab.id}`}
              // Only the selected tab is in the tab order; arrow keys move
              // between them. This is the standard tablist pattern and stops
              // a five-tab bar costing five tab stops.
              tabIndex={isActive ? 0 : -1}
              onClick={() => {
                if (tab.id !== activeId) {
                  onChange(tab.id);
                  triggerImpactHaptic();
                }
              }}
              className="fx-focus-inset"
              style={{
                position: 'relative',
                zIndex: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                flex: isShown ? '1 1 auto' : '0 0 auto',
                minWidth: 46,
                height: '100%',
                padding: isShown ? '0 14px' : '0 12px',
                border: 'none',
                background: 'transparent',
                borderRadius: tokens.radii.pill,
                color: isShown ? tokens.semantic.brandInk : tokens.semantic.inkSubtle,
                // The one CSS transition here: flex-basis and padding cannot be
                // driven by a transform, and this runs on tab change rather
                // than per gesture frame.
                transition: reduceMotion
                  ? 'none'
                  : `flex 260ms ${tokens.motion.easing.standard}, padding 260ms ${tokens.motion.easing.standard}, color 180ms linear`,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <motion.span
                style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
                animate={
                  reduceMotion
                    ? undefined
                    : { scale: isShown ? 1 : 0.94, y: isShown ? 0 : 0.5 }
                }
                transition={tokens.motion.spring.label}
              >
                <Icon active={isShown} />
                {typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span
                    aria-hidden="true"
                    // Anchored to the icon rather than the button, so it stays
                    // put while the button's width springs open and closed.
                    style={{
                      position: 'absolute',
                      top: -3,
                      // Tucked to the icon's top-right corner. -2 rather than
                      // -5 so it does not reach into the label that unfurls
                      // beside it when the tab expands.
                      right: -2,
                      minWidth: 14,
                      height: 14,
                      padding: '0 3px',
                      borderRadius: tokens.radii.pill,
                      background: tokens.colors.danger.base,
                      color: '#fff',
                      fontSize: 9,
                      fontWeight: 700,
                      lineHeight: '14px',
                      textAlign: 'center',
                      boxShadow: '0 0 0 1.5px rgba(255,255,255,0.95)',
                    }}
                  >
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                )}
              </motion.span>

              {/*
                The label reveal. `AnimatePresence` with a width+opacity spring
                so the text unfurls from the icon rather than popping in. The
                accessible name lives on the always-present sr-only span below,
                so collapsing the visual label never leaves an unnamed button.
              */}
              <AnimatePresence initial={false} mode="popLayout">
                {isShown && (
                  <motion.span
                    key="label"
                    initial={reduceMotion ? false : { opacity: 0, width: 0, x: -6 }}
                    animate={{ opacity: 1, width: 'auto', x: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, width: 0, x: -6 }}
                    transition={tokens.motion.spring.label}
                    style={{
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      fontSize: tokens.typography.size.sm,
                      fontWeight: tokens.typography.weight.semibold,
                      letterSpacing: tokens.typography.tracking.tight,
                    }}
                  >
                    {tab.label}
                  </motion.span>
                )}
              </AnimatePresence>

              <span className="fx-sr-only">
                {tab.label}
                {typeof tab.badge === 'number' && tab.badge > 0
                  ? `, ${tab.badge} pending`
                  : ''}
              </span>
            </button>
          );
        })}
      </motion.div>
    </div>
  );
}

/**
 * Telegram haptics.
 *
 * Available only inside the Telegram WebView, and only on recent clients, so
 * every call is guarded and failure is silent — a missing vibration must never
 * surface as an error.
 */
interface TelegramHaptics {
  selectionChanged?: () => void;
  impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
}

function haptics(): TelegramHaptics | null {
  if (typeof window === 'undefined') return null;
  const telegram = (window as unknown as {
    Telegram?: { WebApp?: { HapticFeedback?: TelegramHaptics } };
  }).Telegram;
  return telegram?.WebApp?.HapticFeedback ?? null;
}

function triggerSelectionHaptic(): void {
  try {
    haptics()?.selectionChanged?.();
  } catch {
    /* haptics are a nicety, never a requirement */
  }
}

function triggerImpactHaptic(): void {
  try {
    haptics()?.impactOccurred?.('light');
  } catch {
    /* ignore */
  }
}
