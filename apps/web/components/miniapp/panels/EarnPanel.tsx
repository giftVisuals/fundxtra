'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TASK_CATEGORY_LABELS,
  VERIFICATION_LABELS,
  formatNaira,
  initials,
  tokens,
  type TaskCategory,
  type TaskListItem,
} from '@fundxtra/shared';
import { invalidateResources, useResource } from '@/lib/resource';
import { TaskFlow } from '../TaskFlow';
import { supportUrl } from '@/lib/config';
import { useSession } from '@/lib/session';
import {
  Badge,
  BudgetBar,
  Card,
  EmptyState,
  ErrorState,
  SkeletonList,
} from '@/components/ui';
import { EarnIcon } from '@/components/glass';
import { PanelHeader, Section } from './shared';

/**
 * Earn.
 *
 * The task marketplace. Three things this screen is careful about:
 *
 * 1. **Campaign budget is shown, not hidden.** A funded campaign with visible
 *    remaining budget is what separates a real sponsored task from a "free
 *    money" claim, and it makes a fully-claimed task read as a missed
 *    opportunity rather than a broken button.
 *
 * 2. **Verification is described up front.** The card says whether the reward
 *    is instant, checked with Telegram, or reviewed by a person within 24
 *    hours — before the user starts. Discovering that afterwards is what makes
 *    a rewards platform feel dishonest.
 *
 * 3. **Nothing is claimed on the client.** Tapping complete asks the server,
 *    which verifies and decides. The optimistic balance update only happens
 *    after the server confirms the credit.
 */

export function EarnPanel() {
  const { refresh, applyBalance } = useSession();
  const [category, setCategory] = useState<TaskCategory | 'ALL'>('ALL');
  const [openTask, setOpenTask] = useState<TaskListItem | null>(null);

  /*
    A campaign link — t.me/<bot>?start=task_<id> — lands here as `?task=<id>`.

    Consumed once, on the first load that contains it, and then forgotten: a
    deep link should open the task it names, but re-opening that same sheet
    every time the list refreshes would fight the person trying to close it.
  */
  const requestedTask = useRef<string | null>(
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('task'),
  );

  // Cached: the campaign list is the same for everybody and changes rarely, so
  // revisiting this tab should not re-read it.
  const {
    data: taskPayload,
    error: loadError,
    reload: load,
  } = useResource<{ tasks: TaskListItem[] }>('/tasks');

  const tasks = taskPayload?.tasks ?? null;

  useEffect(() => {
    const wanted = requestedTask.current;
    if (!wanted || !tasks) return;
    requestedTask.current = null;
    // A link to a task that has ended or is fully claimed simply shows the
    // list, which already explains why nothing is there.
    const match = tasks.find((task) => task.id === wanted);
    if (match) setOpenTask(match);
  }, [tasks]);

  const categories = useMemo(() => {
    if (!tasks) return [];
    const present = new Set<TaskCategory>();
    for (const task of tasks) present.add(task.category);
    return [...present];
  }, [tasks]);

  const visible = useMemo(() => {
    if (!tasks) return [];
    return category === 'ALL' ? tasks : tasks.filter((task) => task.category === category);
  }, [tasks, category]);

  const available = visible.filter((task) => task.userState === 'AVAILABLE');
  const other = visible.filter((task) => task.userState !== 'AVAILABLE');

  const handleCompleted = useCallback(
    async (balanceAfterKobo?: number) => {
      if (typeof balanceAfterKobo === 'number') applyBalance(balanceAfterKobo);
      // Money moved, so nothing cached about the wallet is trustworthy now.
      invalidateResources('/wallet');
      await Promise.all([load(), refresh()]);
    },
    [applyBalance, load, refresh],
  );

  /*
    Completing a task replaces the list rather than covering it. The task
    requires leaving the app and coming back, which is the one thing a modal
    handles worst — and its own steps need the whole screen.

    Keyed by task id so opening a different task starts from a clean slate
    instead of carrying the previous one's screenshot into it.
  */
  if (openTask) {
    return (
      <div>
        <TaskFlow
          key={openTask.id}
          task={openTask}
          supportUrl={supportUrl}
          onClose={() => setOpenTask(null)}
          onCompleted={handleCompleted}
        />
      </div>
    );
  }

  return (
    <div>
      <PanelHeader
        title="Earn"
        subtitle="Complete sponsored tasks and get paid in Naira."
      />

      {categories.length > 1 && (
        <div className="fx-rail" style={{ gap: 8, marginBottom: 18, paddingBottom: 2 }}>
          <CategoryChip
            label="All"
            active={category === 'ALL'}
            onClick={() => setCategory('ALL')}
          />
          {categories.map((entry) => (
            <CategoryChip
              key={entry}
              label={TASK_CATEGORY_LABELS[entry]}
              active={category === entry}
              onClick={() => setCategory(entry)}
            />
          ))}
        </div>
      )}

      {tasks === null && <SkeletonList count={3} lines={4} />}

      {loadError && tasks !== null && (
        <ErrorState message={loadError} onRetry={() => void load()} supportUrl={supportUrl} />
      )}

      {tasks !== null && !loadError && visible.length === 0 && (
        <EmptyState
          icon={<EarnIcon active />}
          title="No tasks right now"
          description="New sponsored campaigns are added regularly. Refer a friend in the meantime — that earns without waiting for a task."
        />
      )}

      {available.length > 0 && (
        <Section title={`${available.length} available`}>
          {available.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={() => setOpenTask(task)} />
          ))}
        </Section>
      )}

      {other.length > 0 && (
        <Section title="Already handled">
          {other.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={() => setOpenTask(task)} />
          ))}
        </Section>
      )}

    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flexShrink: 0,
        minHeight: 36,
        padding: '0 14px',
        background: active ? tokens.semantic.brand : tokens.semantic.surface,
        color: active ? tokens.semantic.onBrand : tokens.semantic.inkMuted,
        border: `1px solid ${active ? tokens.colors.cocoa[700] : tokens.semantic.border}`,
        borderRadius: tokens.radii.pill,
        fontSize: tokens.typography.size.sm,
        fontWeight: tokens.typography.weight.medium,
        transition: 'background 140ms linear, color 140ms linear, border-color 140ms linear',
      }}
    >
      {label}
    </button>
  );
}

function TaskCard({ task, onOpen }: { task: TaskListItem; onOpen: () => void }) {
  const claimable = task.userState === 'AVAILABLE';

  return (
    <Card
      padding={0}
      tone={task.userState === 'REJECTED' ? 'danger' : 'plain'}
      style={{ overflow: 'hidden', opacity: claimable ? 1 : 0.82 }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="fx-focus-inset"
        style={{
          display: 'block',
          width: '100%',
          padding: 16,
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {/* Sponsor mark, or a monogram when a campaign has no logo. */}
          <div
            aria-hidden="true"
            style={{
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              width: 42,
              height: 42,
              borderRadius: tokens.radii.md,
              background: tokens.colors.cocoa[50],
              border: `1px solid ${tokens.colors.cocoa[200]}`,
              color: tokens.colors.cocoa[700],
              fontSize: tokens.typography.size.sm,
              fontWeight: tokens.typography.weight.bold,
              overflow: 'hidden',
            }}
          >
            {task.sponsor?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={task.sponsor.logoUrl} alt="" width={42} height={42} />
            ) : task.sponsor ? (
              initials(task.sponsor.name)
            ) : (
              // No sponsor: a category glyph, not initials of the task's own
              // title — "Join the Fundxtra channel" would render as "JC".
              <CategoryGlyph category={task.category} />
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <h3
                style={{
                  flex: 1,
                  fontSize: tokens.typography.size.base,
                  fontWeight: tokens.typography.weight.semibold,
                  lineHeight: tokens.typography.leading.snug,
                }}
              >
                {task.title}
              </h3>
              <span
                className="fx-tabular"
                style={{
                  flexShrink: 0,
                  fontFamily: tokens.typography.fontDisplay,
                  fontSize: tokens.typography.size.lg,
                  fontWeight: tokens.typography.weight.bold,
                  color: tokens.semantic.brandInk,
                }}
              >
                {formatNaira(task.rewardKobo)}
              </span>
            </div>

            <p
              style={{
                marginTop: 4,
                fontSize: tokens.typography.size.sm,
                lineHeight: tokens.typography.leading.snug,
                color: tokens.semantic.inkMuted,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {task.description}
            </p>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <TaskStateBadge state={task.userState} />
              <Badge tone="neutral" mark="none">
                {VERIFICATION_LABELS[task.verification]}
              </Badge>
              {task.sponsor && (
                <Badge tone="brand" mark="none">
                  {task.sponsor.name}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Campaign progress. Shown on every card, because the budget is part
            of what makes the offer credible. */}
        <div style={{ marginTop: 14 }}>
          <BudgetBar budget={task.budget} />
        </div>

        {task.userState === 'REJECTED' && task.rejectionReason && (
          <p
            style={{
              marginTop: 12,
              padding: '8px 10px',
              fontSize: tokens.typography.size.xs,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.colors.danger.strong,
              background: '#fff',
              border: '1px solid #f3d3ce',
              borderRadius: tokens.radii.sm,
            }}
          >
            <strong>Not approved:</strong> {task.rejectionReason}
          </p>
        )}
      </button>
    </Card>
  );
}

function TaskStateBadge({ state }: { state: TaskListItem['userState'] }) {
  switch (state) {
    case 'AVAILABLE':
      return <Badge tone="success" mark="dot">Available</Badge>;
    case 'PENDING_REVIEW':
      return <Badge tone="warning" mark="clock">Under review</Badge>;
    case 'COMPLETED':
      return <Badge tone="success" mark="tick">Completed</Badge>;
    case 'REJECTED':
      return <Badge tone="danger" mark="cross">Not approved</Badge>;
    default:
      return <Badge tone="neutral" mark="none">Fully claimed</Badge>;
  }
}

/**
 * Task detail and completion.
 *
 * A dwell timer starts when the sheet opens and its elapsed value is sent with
 * the completion. The server uses it as a soft anti-bot signal — it flags an
 * implausibly fast completion for review rather than blocking it, because a
 * fast user and a script look identical at this resolution and blocking the
 * wrong one is worse than flagging both.
 */
/**
 * Category glyph, used where a campaign has no sponsor logo. Drawn inline so
 * it inherits the tile's cocoa colour and adds no request.
 */
function CategoryGlyph({ category }: { category: TaskCategory }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };

  switch (category) {
    case 'TELEGRAM':
      return (
        <svg {...common}>
          <path d="M20.4 4.2 3.8 10.6l4.6 1.7 1.7 5.1 2.6-2.9 4.3 3.2z" />
          <path d="M8.4 12.3 17 7.4l-6 6.6" />
        </svg>
      );
    case 'SOCIAL':
      return (
        <svg {...common}>
          <circle cx="12" cy="8.4" r="3.2" />
          <path d="M5.4 19.6a6.6 6.6 0 0 1 13.2 0" />
        </svg>
      );
    case 'APP_INSTALL':
      return (
        <svg {...common}>
          <rect x="7" y="3.4" width="10" height="17.2" rx="2.4" />
          <path d="M10.6 17.8h2.8" />
        </svg>
      );
    case 'SURVEY':
      return (
        <svg {...common}>
          <path d="M6.6 4h10.8a1.4 1.4 0 0 1 1.4 1.4v13.2a1.4 1.4 0 0 1-1.4 1.4H6.6a1.4 1.4 0 0 1-1.4-1.4V5.4A1.4 1.4 0 0 1 6.6 4z" />
          <path d="M8.6 9h6.8M8.6 12.6h6.8M8.6 16.2h4" />
        </svg>
      );
    case 'CONTENT':
      return (
        <svg {...common}>
          <path d="M4.6 6.4h14.8M4.6 11h14.8M4.6 15.6h9.4" />
        </svg>
      );
    case 'SIGNUP':
      return (
        <svg {...common}>
          <path d="M15.4 20.2v-1.8a3.6 3.6 0 0 0-3.6-3.6H7.4a3.6 3.6 0 0 0-3.6 3.6v1.8" />
          <circle cx="9.6" cy="7.8" r="3.6" />
          <path d="M18 8.6v4.8M20.4 11h-4.8" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.4" />
          <path d="M12 8.2v4.4l3 2" />
        </svg>
      );
  }
}
