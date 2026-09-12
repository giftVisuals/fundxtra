'use client';

import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'framer-motion';
import { useCallback, useState, type ReactNode } from 'react';
import { tokens } from '@fundxtra/shared';

/**
 * Swipeable section container.
 *
 * Pairs with `FluidGlassTabBar`: the bar changes the active id, this renders
 * the matching panel, and a horizontal swipe here changes the active id back.
 *
 * Two decisions worth stating:
 *
 * 1. **Only the active panel is mounted.** Keeping all five alive would make
 *    swiping cheaper but would also keep five subscriptions and five scroll
 *    positions alive inside a Telegram WebView, which is where memory actually
 *    matters. The panels animate with a spring on transform only, so mounting
 *    one at a time is still smooth.
 *
 * 2. **The swipe is committed by velocity or distance, whichever fires first.**
 *    A flick should work even if it barely moves, and a slow deliberate drag
 *    should work even with no velocity at the end. Requiring both is the usual
 *    reason a carousel feels unresponsive.
 *
 * Vertical scrolling always wins: the gesture only claims the pointer once
 * horizontal movement clearly dominates, so scrolling a long task list never
 * accidentally changes tab.
 */

export interface SwipeablePanelsProps {
  ids: string[];
  activeId: string;
  onChange: (id: string) => void;
  children: ReactNode;
}

/** Distance, in px, that commits a slow drag. */
const DISTANCE_THRESHOLD = 72;
/** Velocity, in px/s, that commits a flick. */
const VELOCITY_THRESHOLD = 420;

export function SwipeablePanels({
  ids,
  activeId,
  onChange,
  children,
}: SwipeablePanelsProps) {
  const reduceMotion = useReducedMotion();
  const activeIndex = Math.max(0, ids.indexOf(activeId));

  /*
    Which side a panel enters from.

    This was a ref read during render, which is impure: a ref's value is not
    part of the render it is read in, so the animation could disagree with the
    panel actually being drawn. It is now derived from state the moment the
    prop changes, using React's documented pattern for adjusting state during
    render — and `activeId` can change from the tab bar as well as from a
    swipe, so comparing against a remembered previous value catches both.
  */
  const [seen, setSeen] = useState(activeId);
  const [direction, setDirection] = useState(0);

  if (seen !== activeId) {
    const previousIndex = ids.indexOf(seen);
    setDirection(previousIndex === -1 || activeIndex >= previousIndex ? 1 : -1);
    setSeen(activeId);
  }

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), ids.length - 1);
      const next = ids[clamped];
      if (!next || next === activeId) return;
      onChange(next);
    },
    [ids, activeId, onChange],
  );

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const { offset, velocity } = info;

      // Ignore anything that was mostly a vertical scroll.
      if (Math.abs(offset.x) < Math.abs(offset.y)) return;

      const flicked = Math.abs(velocity.x) > VELOCITY_THRESHOLD;
      const dragged = Math.abs(offset.x) > DISTANCE_THRESHOLD;
      if (!flicked && !dragged) return;

      goTo(offset.x < 0 ? activeIndex + 1 : activeIndex - 1);
    },
    [activeIndex, goTo],
  );

  if (reduceMotion) {
    // No transform animation and no swipe: the tab bar remains the only way to
    // change section, which is exactly what a reduced-motion user expects.
    return (
      <div
        role="tabpanel"
        id={`fx-panel-${activeId}`}
        aria-labelledby={`fx-tab-${activeId}`}
        tabIndex={0}
      >
        {children}
      </div>
    );
  }

  return (
    <AnimatePresence initial={false} mode="wait" custom={direction}>
      <motion.div
        key={activeId}
        role="tabpanel"
        id={`fx-panel-${activeId}`}
        aria-labelledby={`fx-tab-${activeId}`}
        tabIndex={0}
        custom={direction}
        // Enter from the side the user swiped from, so the motion agrees with
        // the gesture that caused it.
        initial={{ opacity: 0, x: direction >= 0 ? 24 : -24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: direction >= 0 ? -16 : 16 }}
        transition={tokens.motion.spring.panel}
        drag="x"
        dragDirectionLock
        dragElastic={0.16}
        // Zero constraints plus elasticity: the panel gives a little and
        // springs back, signalling the edge without ever leaving a gap.
        dragConstraints={{ left: 0, right: 0 }}
        onDragEnd={handleDragEnd}
        style={{ touchAction: 'pan-y', willChange: 'transform' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
