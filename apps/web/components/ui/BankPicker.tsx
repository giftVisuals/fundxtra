'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { NIGERIAN_BANKS, tokens } from '@fundxtra/shared';

/**
 * Bank selector.
 *
 * Not a `<select>`. A native select on Android opens an opaque OS sheet: no
 * search across thirty banks, no sort code, no room for the two-letter mark
 * that makes a list of similar names scannable, and no way to look like the
 * rest of the app. This is a listbox we own.
 *
 * Everything the keyboard needs is here — arrows, Enter, Escape, type-to-filter
 * — because a bank list is exactly where someone reaches for the keyboard, and
 * the control is also used in the admin console on a desktop.
 */

export interface BankPickerProps {
  /** Selected bank code, or '' for none. */
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  /** Rendered when nothing is selected yet. */
  placeholder?: string;
  id?: string;
}

/**
 * Two letters for the mark, skipping the words every bank shares.
 *
 * "Access Bank" and "ALAT by Wema" must not both come out as "AB".
 */
function initials(name: string): string {
  const skip = /^(bank|of|by|the|microfinance|nigeria|plc|mfb)$/i;
  const words = name.replace(/[()]/g, '').split(/\s+/).filter((word) => word.length > 1 && !skip.test(word));
  const source = words.length > 0 ? words : name.split(/\s+/);
  const first = source[0] ?? name;
  const second = source[1] ?? '';
  return `${first[0] ?? ''}${second[0] ?? first[1] ?? ''}`.toUpperCase();
}

export function BankPicker({
  value,
  onChange,
  disabled = false,
  placeholder = 'Choose your bank',
  id = 'fx-bank',
}: BankPickerProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => NIGERIAN_BANKS.find((bank) => bank.code === value) ?? null,
    [value],
  );

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return NIGERIAN_BANKS;
    return NIGERIAN_BANKS.filter(
      (bank) =>
        bank.name.toLowerCase().includes(needle) || bank.code.toLowerCase().startsWith(needle),
    );
  }, [term]);

  const close = useCallback(() => {
    setOpen(false);
    setTerm('');
    setActive(-1);
  }, []);

  const choose = useCallback(
    (code: string) => {
      onChange(code);
      close();
    },
    [onChange, close],
  );

  // Focus the search box when the panel opens, so typing filters immediately.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // A click anywhere else closes it. Pointerdown rather than click so the
  // panel is gone before the tapped control reacts.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Keep the highlighted row in view while arrowing through thirty banks.
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${String(active)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === 'Enter' && active >= 0) {
        event.preventDefault();
        const bank = matches[active];
        if (bank) choose(bank.code);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => {
        const next = current + step;
        if (next < 0) return matches.length - 1;
        if (next >= matches.length) return 0;
        return next;
      });
    },
    [active, matches, choose, close],
  );

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          width: '100%',
          textAlign: 'left',
          padding: '10px 12px',
          background: tokens.semantic.surface,
          border: `1px solid ${open ? tokens.colors.cocoa[400] : tokens.semantic.borderStrong}`,
          borderRadius: tokens.radii.md,
          boxShadow: open ? `0 0 0 3px rgba(185, 128, 88, 0.16)` : tokens.shadows.xs,
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'border-color 140ms ease, box-shadow 140ms ease',
        }}
      >
        <span aria-hidden="true" style={markStyle}>
          {selected ? initials(selected.name) : '—'}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: tokens.typography.size.base,
              fontWeight: selected
                ? tokens.typography.weight.semibold
                : tokens.typography.weight.regular,
              color: selected ? tokens.semantic.ink : tokens.semantic.inkFaint,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {selected ? selected.name : placeholder}
          </span>
          <span
            style={{
              display: 'block',
              marginTop: 1,
              fontSize: tokens.typography.size.xs,
              color: tokens.semantic.inkSubtle,
            }}
          >
            {selected ? `Sort code ${selected.code}` : `${String(NIGERIAN_BANKS.length)} banks and wallets`}
          </span>
        </span>
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          style={{
            flex: 'none',
            color: tokens.semantic.inkSubtle,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: reduceMotion ? undefined : 'transform 180ms cubic-bezier(0.2, 0.9, 0.25, 1)',
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <motion.div
          role="presentation"
          onKeyDown={onKeyDown}
          initial={reduceMotion ? undefined : { opacity: 0, y: -6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={tokens.motion.spring.pill}
          style={{
            position: 'absolute',
            zIndex: tokens.zIndex.raised + 20,
            left: 0,
            right: 0,
            top: 'calc(100% + 6px)',
            background: tokens.semantic.surface,
            border: `1px solid ${tokens.semantic.border}`,
            borderRadius: tokens.radii.lg,
            boxShadow: tokens.shadows.lg,
            overflow: 'hidden',
            transformOrigin: 'top center',
          }}
        >
          <div style={{ padding: 10, borderBottom: `1px solid ${tokens.semantic.divider}` }}>
            <input
              ref={searchRef}
              type="search"
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                setActive(-1);
              }}
              placeholder="Search bank or wallet"
              aria-label="Search banks"
              autoComplete="off"
              style={{
                width: '100%',
                padding: '9px 12px',
                background: tokens.semantic.surface,
                border: `1px solid ${tokens.semantic.borderStrong}`,
                borderRadius: tokens.radii.sm,
                fontSize: tokens.typography.size.base,
              }}
            />
          </div>

          <div
            ref={listRef}
            role="listbox"
            aria-label="Nigerian banks"
            style={{ maxHeight: 236, overflowY: 'auto', padding: 6 }}
          >
            {matches.length === 0 ? (
              <p
                style={{
                  padding: '18px 12px',
                  textAlign: 'center',
                  fontSize: tokens.typography.size.sm,
                  color: tokens.semantic.inkSubtle,
                }}
              >
                No bank matches “{term.trim()}”.
              </p>
            ) : (
              matches.map((bank, index) => {
                const isSelected = bank.code === value;
                const isActive = index === active;
                return (
                  <button
                    key={bank.code}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    onClick={() => choose(bank.code)}
                    onPointerEnter={() => setActive(index)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 9px',
                      border: 0,
                      borderRadius: tokens.radii.sm,
                      background: isSelected
                        ? tokens.colors.cocoa[100]
                        : isActive
                          ? tokens.colors.cocoa[50]
                          : 'transparent',
                    }}
                  >
                    <span aria-hidden="true" style={{ ...markStyle, width: 30, height: 30, fontSize: 11 }}>
                      {initials(bank.name)}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: tokens.typography.size.base,
                        fontWeight: tokens.typography.weight.medium,
                      }}
                    >
                      {bank.name}
                    </span>
                    {isSelected ? (
                      <svg
                        aria-hidden="true"
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={tokens.semantic.brand}
                        strokeWidth={2.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : (
                      <span
                        style={{
                          fontFamily: tokens.typography.fontMono,
                          fontSize: tokens.typography.size['2xs'],
                          color: tokens.semantic.inkFaint,
                        }}
                      >
                        {bank.code}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}

const markStyle: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  flex: 'none',
  width: 34,
  height: 34,
  borderRadius: tokens.radii.sm,
  background: tokens.colors.cocoa[100],
  border: `1px solid ${tokens.colors.cocoa[200]}`,
  color: tokens.semantic.brandInk,
  fontSize: 12,
  fontWeight: tokens.typography.weight.bold,
};
