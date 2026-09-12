'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tokens } from '@fundxtra/shared';
import { AdminButton, AdminCard } from './primitives';

/**
 * Keeps one broken section from taking down the console.
 *
 * Without this, an exception while rendering any section replaces the entire
 * page — navigation included — with the framework's blank "This page couldn't
 * load". The operator then has no way to reach the other sections, which is
 * the worst possible moment to lose them: something is already wrong, and the
 * console is where you go to find out what.
 *
 * A class component because error boundaries have no hook equivalent. Keyed on
 * the section id by the caller, so switching section clears a previous failure
 * rather than leaving the console stuck on it.
 */

interface Props {
  children: ReactNode;
  section: string;
}

interface State {
  message: string | null;
}

export class SectionBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : 'Unexpected failure' };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Logged rather than swallowed: the message shown to the operator is
    // deliberately short, and the stack is what actually identifies the bug.
    console.error(`[fundxtra] admin section "${this.props.section}" failed`, error, info);
  }

  override render(): ReactNode {
    const { message } = this.state;
    if (message === null) return this.props.children;

    return (
      <AdminCard title="This section could not be displayed">
        <p
          style={{
            fontSize: tokens.typography.size.sm,
            color: tokens.semantic.inkMuted,
            lineHeight: tokens.typography.leading.relaxed,
          }}
        >
          Something in <strong>{this.props.section}</strong> failed to render. Every other section
          still works — use the menu to switch.
        </p>
        <p
          style={{
            marginTop: 10,
            fontFamily: tokens.typography.fontMono,
            fontSize: tokens.typography.size['2xs'],
            color: tokens.semantic.inkFaint,
            wordBreak: 'break-word',
          }}
        >
          {message}
        </p>
        <div style={{ marginTop: 14 }}>
          <AdminButton onClick={() => this.setState({ message: null })}>
            Try this section again
          </AdminButton>
        </div>
      </AdminCard>
    );
  }
}
