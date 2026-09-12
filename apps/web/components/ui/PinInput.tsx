'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LIMITS, tokens } from '@fundxtra/shared';

/**
 * 4-digit PIN entry.
 *
 * Implemented as a **single hidden input** with four rendered dots, rather than
 * four separate inputs. Four inputs is the more common approach and it is worse
 * on mobile: focus-shuffling between them fights the software keyboard, breaks
 * paste, breaks backspace across boundaries, and confuses password managers.
 * One input keeps the OS keyboard behaviour intact and the dots become purely
 * presentational.
 *
 * Details that matter for a numeric secret on a phone:
 *   - `inputMode="numeric"` so the number pad opens, not the full keyboard.
 *   - `autoComplete="one-time-code"` so the OS never offers to save the PIN as
 *     a password.
 *   - Non-digits are stripped on input, so a keyboard that inserts a space
 *     cannot silently produce an invalid PIN.
 *   - The value is never echoed as text and never logged.
 */

export interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired when the last digit is entered. */
  onComplete?: (value: string) => void;
  label: string;
  error?: string | null | undefined;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function PinInput({
  value,
  onChange,
  onComplete,
  label,
  error,
  disabled = false,
  autoFocus = false,
}: PinInputProps) {
  const reduceMotion = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const length = LIMITS.PIN_LENGTH;

  useEffect(() => {
    if (autoFocus) {
      // A frame's delay: focusing during mount can be ignored inside the
      // Telegram WebView while it is still settling its viewport.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [autoFocus]);

  const handleInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const digits = event.target.value.replace(/\D/g, '').slice(0, length);
      onChange(digits);
      if (digits.length === length) onComplete?.(digits);
    },
    [length, onChange, onComplete],
  );

  return (
    <div>
      <label
        htmlFor="fx-pin"
        style={{
          display: 'block',
          marginBottom: 12,
          fontSize: tokens.typography.size.sm,
          fontWeight: tokens.typography.weight.medium,
          color: tokens.semantic.inkMuted,
          textAlign: 'center',
        }}
      >
        {label}
      </label>

      <div
        onClick={() => inputRef.current?.focus()}
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 12,
          cursor: disabled ? 'not-allowed' : 'text',
        }}
      >
        {Array.from({ length }).map((_, index) => {
          const filled = index < value.length;
          const isNext = index === value.length && focused;

          return (
            <motion.div
              key={index}
              animate={
                reduceMotion
                  ? undefined
                  : { scale: filled ? 1 : isNext ? 1.04 : 1 }
              }
              transition={tokens.motion.spring.press}
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 54,
                height: 62,
                borderRadius: tokens.radii.md,
                background: filled ? tokens.colors.cocoa[50] : tokens.semantic.bgSubtle,
                border: `1.5px solid ${
                  error
                    ? tokens.colors.danger.base
                    : isNext
                      ? tokens.semantic.brand
                      : filled
                        ? tokens.colors.cocoa[200]
                        : tokens.semantic.border
                }`,
                boxShadow: isNext ? `0 0 0 3px ${tokens.colors.cocoa[100]}` : 'none',
                transition: 'background 140ms linear, border-color 140ms linear, box-shadow 140ms linear',
              }}
            >
              {filled ? (
                <motion.span
                  initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 24 }}
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: tokens.semantic.brand,
                  }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 2,
                    borderRadius: 2,
                    background: tokens.colors.sand[300],
                  }}
                />
              )}
            </motion.div>
          );
        })}
      </div>

      {/*
        The real field. Visually hidden but focusable and on-screen, so the
        software keyboard opens and the caret stays where the OS expects. It is
        NOT `display:none` — that would make it unfocusable on iOS.
      */}
      <input
        ref={inputRef}
        id="fx-pin"
        type="password"
        inputMode="numeric"
        // Tells the OS this is a transient code, so it is never offered for
        // saving as a password.
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={length}
        value={value}
        onChange={handleInput}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        aria-label={label}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'fx-pin-error' : undefined}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

      {error && (
        <motion.p
          id="fx-pin-error"
          role="alert"
          initial={reduceMotion ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            marginTop: 14,
            textAlign: 'center',
            fontSize: tokens.typography.size.sm,
            color: tokens.colors.danger.strong,
          }}
        >
          {error}
        </motion.p>
      )}
    </div>
  );
}
