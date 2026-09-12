'use client';

import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '@fundxtra/shared';

/**
 * Bottom sheet.
 *
 * The Mini App's modal pattern. Sheets rather than centred dialogs because the
 * interaction happens at the bottom of a phone, where the thumb already is, and
 * because a sheet can be dismissed by dragging — which is what users expect
 * from a native app.
 *
 * Rendered through a **portal to `document.body`**, which is load-bearing
 * rather than stylistic. Sheets are opened from inside the swipeable panel
 * container, and framer-motion puts a transform on that container — which
 * makes it the containing block for `position: fixed` descendants. Without the
 * portal, a sheet is positioned against the panel instead of the viewport, so
 * it floats mid-screen on a short page and disappears below the fold on a long
 * one. The portal escapes every transformed ancestor.
 *
 * Accessibility details that are easy to skip and matter a lot here:
 *   - Focus moves into the sheet on open and returns to the trigger on close.
 *   - Tab is trapped inside while open, so the page behind is unreachable.
 *   - Escape closes.
 *   - Background scroll is locked, because a sheet that scrolls the page behind
 *     it feels broken on iOS in particular.
 */

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hidden visually but announced — use when the title is rendered inside. */
  hideTitle?: boolean;
  description?: string;
  children: ReactNode;
  /** Disables drag-to-dismiss, for a sheet mid-transaction. */
  dismissible?: boolean;
  footer?: ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  hideTitle = false,
  description,
  children,
  dismissible = true,
  footer,
}: SheetProps) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  // Move focus in on open, and put it back where it came from on close.
  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      // Wait a frame so the panel exists before focusing it.
      const id = requestAnimationFrame(() => {
        const focusable = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
        (focusable ?? panelRef.current)?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    previouslyFocused.current?.focus();
    return undefined;
  }, [open]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Trap Tab within the sheet.
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [dismissible, onClose],
  );

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (!dismissible) return;
      // Dismiss on a downward flick or a decisive drag, matching the panel
      // swipe rules elsewhere: either signal alone is enough.
      if (info.velocity.y > 500 || info.offset.y > 120) onClose();
    },
    [dismissible, onClose],
  );

  /*
    The portal target only exists in the browser, so it is resolved after
    mount — rendering `createPortal` during SSR would reference a document
    that is not there.
  */
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const sheet = (
    <AnimatePresence>
      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: tokens.zIndex.sheet,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          {/* Scrim. Warm and light rather than the usual near-black, so the
              overlay still belongs to a white-dominant product. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={dismissible ? onClose : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(63, 37, 22, 0.32)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
            }}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            aria-describedby={description ? 'fx-sheet-description' : undefined}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            transition={tokens.motion.spring.sheet}
            drag={dismissible && !reduceMotion ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
            className="fx-scroll"
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: tokens.layout.appMaxWidth,
              maxHeight: '88dvh',
              overflowY: 'auto',
              background: tokens.semantic.surface,
              borderTopLeftRadius: tokens.radii['2xl'],
              borderTopRightRadius: tokens.radii['2xl'],
              boxShadow: '0 -12px 48px -12px rgba(80, 47, 30, 0.28)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              willChange: 'transform',
            }}
          >
            {/* Grab handle. Purely a visual affordance for the drag. */}
            {dismissible && (
              <div style={{ display: 'grid', placeItems: 'center', padding: '10px 0 2px' }}>
                <div
                  aria-hidden="true"
                  style={{
                    width: 38,
                    height: 4,
                    borderRadius: tokens.radii.pill,
                    background: tokens.colors.sand[300],
                  }}
                />
              </div>
            )}

            <div style={{ padding: '12px 20px 24px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: description ? 6 : 16,
                }}
              >
                <h2
                  className={hideTitle ? 'fx-sr-only' : undefined}
                  style={
                    hideTitle
                      ? undefined
                      : {
                          fontSize: tokens.typography.size.xl,
                          fontWeight: tokens.typography.weight.semibold,
                        }
                  }
                >
                  {title}
                </h2>
                {dismissible && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    style={{
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                      width: 32,
                      height: 32,
                      border: `1px solid ${tokens.semantic.border}`,
                      borderRadius: tokens.radii.pill,
                      background: tokens.semantic.bgSubtle,
                      color: tokens.semantic.inkMuted,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                )}
              </div>

              {description && (
                <p
                  id="fx-sheet-description"
                  style={{
                    marginBottom: 18,
                    fontSize: tokens.typography.size.base,
                    lineHeight: tokens.typography.leading.relaxed,
                    color: tokens.semantic.inkMuted,
                  }}
                >
                  {description}
                </p>
              )}

              {children}
            </div>

            {footer && (
              <div
                style={{
                  position: 'sticky',
                  bottom: 0,
                  padding: '14px 20px calc(14px + env(safe-area-inset-bottom, 0px))',
                  background: tokens.semantic.surface,
                  borderTop: `1px solid ${tokens.semantic.divider}`,
                }}
              >
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  // Before the portal target resolves there is nothing to render into; the
  // sheet mounts a frame later, which is imperceptible and avoids an SSR
  // mismatch.
  return portalTarget ? createPortal(sheet, portalTarget) : null;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
