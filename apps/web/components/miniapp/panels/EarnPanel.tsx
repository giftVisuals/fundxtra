'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACCEPTED_PROOF_MIME_TYPES,
  LIMITS,
  TASK_CATEGORY_LABELS,
  VERIFICATION_HINTS,
  VERIFICATION_LABELS,
  formatNaira,
  initials,
  tokens,
  type TaskCategory,
  type TaskListItem,
} from '@fundxtra/shared';
import { api, ApiError, errorMessage, errorRequestId } from '@/lib/api';
import { supportUrl } from '@/lib/config';
import { haptic, openExternal } from '@/lib/telegram';
import { useSession } from '@/lib/session';
import {
  Badge,
  BudgetBar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Sheet,
  SkeletonList,
  SuccessState,
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

type CompletionState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'credited'; rewardKobo: number; message: string }
  | { kind: 'queued'; message: string }
  | { kind: 'failed'; message: string; requestId?: string | undefined };

export function EarnPanel() {
  const { refresh, applyBalance } = useSession();
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await api.get<{ tasks: TaskListItem[] }>('/tasks');
      setTasks(result.tasks);

      const wanted = requestedTask.current;
      if (wanted) {
        requestedTask.current = null;
        const match = result.tasks.find((task) => task.id === wanted);
        // A link to a task that has ended or is fully claimed simply shows the
        // list, which already explains why nothing is there.
        if (match) setOpenTask(match);
      }
    } catch (caught) {
      setLoadError(errorMessage(caught));
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      await Promise.all([load(), refresh()]);
    },
    [applyBalance, load, refresh],
  );

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

      {/*
        Keyed by task id so opening a different task remounts the sheet with
        clean state, instead of resetting five fields inside an effect.
      */}
      <TaskSheet
        key={openTask?.id ?? 'none'}
        task={openTask}
        onClose={() => setOpenTask(null)}
        onCompleted={handleCompleted}
      />
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
function TaskSheet({
  task,
  onClose,
  onCompleted,
}: {
  task: TaskListItem | null;
  onClose: () => void;
  onCompleted: (balanceAfterKobo?: number) => Promise<void>;
}) {
  const [state, setState] = useState<CompletionState>({ kind: 'idle' });
  const [answer, setAnswer] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  /*
    Set when the sheet opens, in the effect below — not in this initialiser.
    `Date.now()` during render makes the render impure, and a ref initialiser
    runs during render.
  */
  const openedAt = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /*
    Record when the sheet was opened, for the dwell signal sent with the
    completion. State is NOT reset here — the parent gives this component a
    `key` of the task id, so opening a different task remounts it with fresh
    state. Resetting five pieces of state in an effect would cause a
    cascading render on every open.
  */
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const submit = useCallback(async () => {
    if (!task) return;
    setState({ kind: 'working' });
    setProofError(null);

    try {
      let proofPath: string | undefined;

      if (task.requiresProof) {
        if (!proofFile) {
          setProofError('Please attach your screenshot.');
          setState({ kind: 'idle' });
          return;
        }
        const formData = new FormData();
        formData.append('proof', proofFile);
        const uploaded = await api.upload<{ proofPath: string }>(
          `/tasks/${task.id}/proof`,
          formData,
        );
        proofPath = uploaded.proofPath;
      }

      const dwellSeconds = Math.round((Date.now() - openedAt.current) / 1000);
      const result = await api.post<{
        state: 'CREDITED' | 'PENDING_REVIEW';
        rewardKobo: number;
        balanceAfterKobo?: number;
        message: string;
      }>(`/tasks/${task.id}/complete`, {
        ...(proofPath ? { proofPath } : {}),
        ...(answer.trim() ? { answer: answer.trim() } : {}),
        dwellSeconds,
      });

      if (result.state === 'CREDITED') {
        haptic.success();
        setState({ kind: 'credited', rewardKobo: result.rewardKobo, message: result.message });
        await onCompleted(result.balanceAfterKobo);
      } else {
        haptic.light();
        setState({ kind: 'queued', message: result.message });
        await onCompleted();
      }
    } catch (caught) {
      haptic.error();
      if (caught instanceof ApiError && caught.fieldError('proof')) {
        setProofError(caught.fieldError('proof') ?? null);
        setState({ kind: 'idle' });
        return;
      }
      setState({
        kind: 'failed',
        message: errorMessage(caught),
        requestId: errorRequestId(caught),
      });
    }
  }, [task, proofFile, answer, onCompleted]);

  if (!task) return null;

  return (
    <Sheet
      open={Boolean(task)}
      onClose={onClose}
      title={task.title}
      dismissible={state.kind !== 'working'}
      footer={
        state.kind === 'credited' || state.kind === 'queued' ? (
          <Button fullWidth size="lg" onClick={onClose}>
            Done
          </Button>
        ) : task.userState === 'AVAILABLE' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {task.targetUrl && !opened && (
              <Button
                fullWidth
                size="lg"
                onClick={() => {
                  setOpened(true);
                  openExternal(task.targetUrl as string);
                }}
              >
                {task.verification === 'TELEGRAM_MEMBERSHIP' ? 'Open and join' : 'Open task'}
              </Button>
            )}
            <Button
              fullWidth
              size="lg"
              variant={task.targetUrl && !opened ? 'secondary' : 'primary'}
              loading={state.kind === 'working'}
              disabled={state.kind === 'working'}
              onClick={() => void submit()}
            >
              {task.verification === 'TELEGRAM_MEMBERSHIP'
                ? 'Verify and claim'
                : task.requiresProof
                  ? 'Submit screenshot'
                  : `Claim ${formatNaira(task.rewardKobo)}`}
            </Button>
          </div>
        ) : null
      }
    >
      <AnimatePresence mode="wait">
        {state.kind === 'credited' && (
          <motion.div key="credited" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <SuccessState
              title={`${formatNaira(state.rewardKobo)} added`}
              message={state.message}
            />
          </motion.div>
        )}

        {state.kind === 'queued' && (
          <motion.div key="queued" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <SuccessState title="Submitted for review" message={state.message} />
          </motion.div>
        )}

        {(state.kind === 'idle' || state.kind === 'working' || state.kind === 'failed') && (
          <motion.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
                paddingBottom: 14,
                marginBottom: 14,
                borderBottom: `1px solid ${tokens.semantic.divider}`,
              }}
            >
              <div>
                <p
                  style={{
                    fontSize: tokens.typography.size['2xs'],
                    letterSpacing: tokens.typography.tracking.wider,
                    textTransform: 'uppercase',
                    color: tokens.semantic.inkSubtle,
                  }}
                >
                  Reward
                </p>
                <p
                  className="fx-tabular"
                  style={{
                    fontFamily: tokens.typography.fontDisplay,
                    fontSize: tokens.typography.size['2xl'],
                    fontWeight: tokens.typography.weight.bold,
                    color: tokens.semantic.brandInk,
                  }}
                >
                  {formatNaira(task.rewardKobo)}
                </p>
              </div>
              <Badge tone="neutral" mark="none">
                {TASK_CATEGORY_LABELS[task.category]}
              </Badge>
            </div>

            <p
              style={{
                fontSize: tokens.typography.size.base,
                lineHeight: tokens.typography.leading.relaxed,
                color: tokens.semantic.inkMuted,
              }}
            >
              {task.description}
            </p>

            {/* How the reward is verified, stated before the user starts. */}
            <Card tone="brand" padding={12} style={{ marginTop: 16 }}>
              <p
                style={{
                  fontSize: tokens.typography.size.sm,
                  lineHeight: tokens.typography.leading.relaxed,
                  color: tokens.colors.cocoa[800],
                }}
              >
                <strong>{VERIFICATION_LABELS[task.verification]}.</strong>{' '}
                {VERIFICATION_HINTS[task.verification]}
              </p>
            </Card>

            <h3
              style={{
                marginTop: 20,
                marginBottom: 10,
                fontSize: tokens.typography.size.sm,
                fontWeight: tokens.typography.weight.semibold,
                letterSpacing: tokens.typography.tracking.wider,
                textTransform: 'uppercase',
                color: tokens.semantic.inkSubtle,
              }}
            >
              Steps
            </h3>
            <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
              {task.instructions.map((instruction, index) => (
                <li key={index} style={{ display: 'flex', gap: 10 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: tokens.colors.cocoa[50],
                      border: `1px solid ${tokens.colors.cocoa[200]}`,
                      color: tokens.colors.cocoa[700],
                      fontSize: tokens.typography.size['2xs'],
                      fontWeight: tokens.typography.weight.bold,
                    }}
                  >
                    {index + 1}
                  </span>
                  <span
                    style={{
                      fontSize: tokens.typography.size.base,
                      lineHeight: tokens.typography.leading.snug,
                    }}
                  >
                    {instruction}
                  </span>
                </li>
              ))}
            </ol>

            <div style={{ marginTop: 20 }}>
              <h3
                style={{
                  marginBottom: 10,
                  fontSize: tokens.typography.size.sm,
                  fontWeight: tokens.typography.weight.semibold,
                  letterSpacing: tokens.typography.tracking.wider,
                  textTransform: 'uppercase',
                  color: tokens.semantic.inkSubtle,
                }}
              >
                Campaign
              </h3>
              <BudgetBar budget={task.budget} />
            </div>

            {/* Free-text answer for manual-review tasks. */}
            {task.verification === 'MANUAL_REVIEW' && task.userState === 'AVAILABLE' && (
              <div style={{ marginTop: 20 }}>
                <label
                  htmlFor="fx-task-answer"
                  style={{
                    display: 'block',
                    marginBottom: 6,
                    fontSize: tokens.typography.size.sm,
                    fontWeight: tokens.typography.weight.medium,
                  }}
                >
                  Your answer
                </label>
                <textarea
                  id="fx-task-answer"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  rows={3}
                  maxLength={600}
                  placeholder="Paste your completion code or the details requested above"
                  style={{
                    width: '100%',
                    padding: 12,
                    fontSize: tokens.typography.size.base,
                    background: tokens.semantic.bgSubtle,
                    border: `1px solid ${tokens.semantic.border}`,
                    borderRadius: tokens.radii.md,
                    resize: 'vertical',
                  }}
                />
              </div>
            )}

            {/* Screenshot upload for proof tasks. */}
            {task.requiresProof && task.userState === 'AVAILABLE' && (
              <div style={{ marginTop: 20 }}>
                <p
                  style={{
                    marginBottom: 8,
                    fontSize: tokens.typography.size.sm,
                    fontWeight: tokens.typography.weight.medium,
                  }}
                >
                  Your screenshot
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_PROOF_MIME_TYPES.join(',')}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setProofError(null);
                    if (file && file.size > LIMITS.MAX_PROOF_BYTES) {
                      setProofError(
                        `That file is too large. Please keep it under ${Math.floor(
                          LIMITS.MAX_PROOF_BYTES / 1024 / 1024,
                        )}MB.`,
                      );
                      setProofFile(null);
                      return;
                    }
                    setProofFile(file);
                  }}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    minHeight: 60,
                    padding: 12,
                    background: proofFile ? tokens.colors.success.soft : tokens.semantic.bgSubtle,
                    border: `1.5px dashed ${
                      proofError
                        ? tokens.colors.danger.base
                        : proofFile
                          ? '#cfe7d7'
                          : tokens.semantic.borderStrong
                    }`,
                    borderRadius: tokens.radii.md,
                    textAlign: 'left',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 34,
                      height: 34,
                      borderRadius: tokens.radii.sm,
                      background: '#fff',
                      border: `1px solid ${tokens.semantic.border}`,
                      color: proofFile ? tokens.colors.success.strong : tokens.semantic.brand,
                    }}
                  >
                    {proofFile ? (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8.5 6 11.5 13 4.5" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 11V3.5M5 6.5 8 3.5l3 3M3 11.5v1A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-1" />
                      </svg>
                    )}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: tokens.typography.size.sm,
                        fontWeight: tokens.typography.weight.medium,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {proofFile ? proofFile.name : 'Choose a screenshot'}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 2,
                        fontSize: tokens.typography.size.xs,
                        color: tokens.semantic.inkMuted,
                      }}
                    >
                      {proofFile
                        ? `${(proofFile.size / 1024 / 1024).toFixed(1)}MB · tap to change`
                        : 'PNG, JPEG or WebP'}
                    </span>
                  </span>
                </button>
                {proofError && (
                  <p
                    role="alert"
                    style={{
                      marginTop: 8,
                      fontSize: tokens.typography.size.xs,
                      color: tokens.colors.danger.strong,
                    }}
                  >
                    {proofError}
                  </p>
                )}
              </div>
            )}

            {/*
              Static advice rather than a live countdown. A countdown would
              need `Date.now()` during render, and the server treats a fast
              completion as a signal to flag for review, not a hard block —
              so an accurate ticking number would imply a gate that does not
              exist.
            */}
            {task.minimumDwellSeconds > 0 && task.userState === 'AVAILABLE' && (
              <p
                style={{
                  marginTop: 16,
                  fontSize: tokens.typography.size.xs,
                  color: tokens.semantic.inkSubtle,
                }}
              >
                Take your time — completing this properly takes at least{' '}
                {task.minimumDwellSeconds} seconds.
              </p>
            )}

            {state.kind === 'failed' && (
              <div style={{ marginTop: 18 }}>
                <ErrorState
                  title="Could not complete that"
                  message={state.message}
                  requestId={state.requestId}
                  onRetry={() => setState({ kind: 'idle' })}
                  supportUrl={supportUrl}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}

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
