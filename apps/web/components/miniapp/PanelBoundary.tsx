'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tokens } from '@fundxtra/shared';
import { Button, Card } from '@/components/ui';
import { openExternal } from '@/lib/telegram';
import { supportUrl } from '@/lib/config';

/**
 * Keeps one broken panel from taking the whole Mini App down.
 *
 * Without this, a single unexpected value anywhere in a panel — a field the
 * API stopped sending, a shape that changed between a deploy and a client
 * that had not reloaded — replaces everything with a blank white screen. No
 * balance, no navigation, no way back. For somebody whose money is in there,
 * a white screen does not read as a rendering bug; it reads as the platform
 * being gone.
 *
 * So a failure is contained to the panel it happened in. The tab bar keeps
 * working, every other tab still opens, and the balance is one tap away.
 *
 * A class component because error boundaries have no hook equivalent. The
 * caller keys it on the tab, so switching tabs clears a previous failure
 * instead of leaving the app stuck on it.
 */

interface Props {
  children: ReactNode;
  /** The tab this is wrapping, named the way a user would say it. */
  panel: string;
  onRetry?: (() => void) | undefined;
}

interface State {
  failed: boolean;
}

export class PanelBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The user is shown something calm and short; the stack is what identifies
    // the bug, so it goes to the console rather than on screen.
    console.error(`[fundxtra] the ${this.props.panel} panel failed`, error, info);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <Card padding={18} style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: tokens.typography.size.base }}>
          This screen could not be shown
        </h2>
        <p
          style={{
            marginTop: 8,
            fontSize: tokens.typography.size.sm,
            lineHeight: tokens.typography.leading.relaxed,
            color: tokens.semantic.inkMuted,
          }}
        >
          Something went wrong drawing {this.props.panel}. Nothing has happened to your balance or
          to anything you have earned — the other tabs still work.
        </p>
        <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          <Button
            fullWidth
            onClick={() => {
              this.setState({ failed: false });
              this.props.onRetry?.();
            }}
          >
            Try again
          </Button>
          <Button variant="secondary" fullWidth onClick={() => openExternal(supportUrl)}>
            Contact Fundxtra Support
          </Button>
        </div>
      </Card>
    );
  }
}
