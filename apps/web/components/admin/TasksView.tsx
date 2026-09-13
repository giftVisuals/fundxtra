'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  LIMITS,
  TASK_CATEGORY_LABELS,
  VERIFICATION_LABELS,
  formatNaira,
  parseNairaInput,
  percentageOf,
  taskLink,
  toTaskSlug,
  tokens,
  type Task,
  type TaskCategory,
  type VerificationMethod,
} from '@fundxtra/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { config } from '@/lib/config';
import { useAdmin } from '@/lib/admin-session';
import { AdminButton, AdminCard, AdminField, Pill, Table, Td, adminInputStyle } from './primitives';

/**
 * Campaign management.
 *
 * The create form mirrors the server's rules rather than inventing its own: the
 * ₦1,000 ceiling, the requirement that budget covers at least one reward, and
 * the derivation of maximum completions from budget ÷ reward. The server
 * enforces all three regardless — this just avoids a pointless round trip and
 * shows the operator the completion count they are funding *before* they commit.
 */
export function TasksView() {
  const { refresh: refreshDashboard } = useAdmin();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.get<{ tasks: Task[] }>('/admin/tasks');
      setTasks(result.tasks);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = useCallback(
    async (task: Task, status: 'ACTIVE' | 'PAUSED' | 'DRAFT') => {
      setBusyId(task.id);
      setError(null);
      try {
        await api.post(`/admin/tasks/${task.id}/status`, { status });
        setNotice(`"${task.title}" is now ${status.toLowerCase()}.`);
        await load();
        await refreshDashboard();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusyId(null);
      }
    },
    [load, refreshDashboard],
  );

  /*
    Read back from the freshly loaded list rather than held in state, so the
    form always edits what the table is showing. Holding a copy is how an edit
    form ends up submitting a value the admin can no longer see.
  */
  const editingTask = editing === null ? null : (tasks ?? []).find((entry) => entry.id === editing);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ fontSize: tokens.typography.size.xl }}>Campaigns</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <AdminButton onClick={() => void load()}>Refresh</AdminButton>
          <AdminButton tone="primary" onClick={() => setCreating((open) => !open)}>
            {creating ? 'Close' : 'New campaign'}
          </AdminButton>
        </div>
      </div>

      {notice && (
        <AdminCard>
          <p role="status" style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.success.strong }}>
            {notice}
          </p>
        </AdminCard>
      )}
      {error && (
        <AdminCard>
          <p role="alert" style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.danger.strong }}>
            {error}
          </p>
        </AdminCard>
      )}

      {creating && (
        <CreateTaskForm
          onCreated={() => {
            setCreating(false);
            setNotice('Campaign created as a draft. Activate it when you are ready.');
            void load();
            void refreshDashboard();
          }}
        />
      )}

      <AdminCard padded={false}>
        <Table
          columns={['Campaign', 'Reward', 'Budget', 'Claimed', 'Verification', 'Status', 'Actions']}
          empty={tasks !== null && tasks.length === 0}
        >
          {(tasks ?? []).map((task) => {
            const percent = percentageOf(task.spentKobo, task.budgetKobo);
            return (
              <tr key={task.id}>
                <Td>
                  <div style={{ fontWeight: tokens.typography.weight.semibold }}>{task.title}</div>
                  <div
                    style={{
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.inkSubtle,
                    }}
                  >
                    {TASK_CATEGORY_LABELS[task.category]}
                    {task.sponsor ? ` · ${task.sponsor.name}` : ''}
                  </div>
                  {/* The campaign's own share link, ready to copy. Opening it
                      in Telegram lands on this task inside the Mini App. */}
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(taskLink(config.botUsername, task.id))
                        .then(() => setNotice(`Link for "${task.title}" copied.`))
                        .catch(() => setNotice('Could not copy — long-press the link instead.'));
                    }}
                    style={{
                      marginTop: 4,
                      padding: 0,
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      fontFamily: tokens.typography.fontMono,
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.brand,
                      wordBreak: 'break-all',
                    }}
                  >
                    {taskLink(config.botUsername, task.id)}
                  </button>
                  {/* Admin-facing configuration warning, e.g. the bot is not
                      an administrator of the target chat. */}
                  {task.verificationWarning && (
                    <div
                      style={{
                        marginTop: 5,
                        padding: '5px 8px',
                        background: tokens.colors.danger.soft,
                        border: '1px solid #f3d3ce',
                        borderRadius: tokens.radii.xs,
                        fontSize: tokens.typography.size['2xs'],
                        color: tokens.colors.danger.strong,
                        maxWidth: 320,
                      }}
                    >
                      <strong>Verification problem:</strong> {task.verificationWarning}
                    </div>
                  )}
                </Td>
                <Td align="right" nowrap>{formatNaira(task.rewardKobo)}</Td>
                <Td align="right" nowrap>
                  <div>{formatNaira(task.budgetKobo)}</div>
                  <div
                    style={{
                      fontSize: tokens.typography.size['2xs'],
                      color: tokens.semantic.inkSubtle,
                    }}
                  >
                    {formatNaira(Math.max(0, task.budgetKobo - task.spentKobo))} left
                  </div>
                </Td>
                <Td align="right" nowrap>
                  <div>
                    {task.completionCount} / {task.maxCompletions}
                  </div>
                  {task.pendingCount > 0 && (
                    <div
                      style={{
                        fontSize: tokens.typography.size['2xs'],
                        color: tokens.colors.warning.strong,
                      }}
                    >
                      +{task.pendingCount} pending
                    </div>
                  )}
                  <div
                    aria-hidden="true"
                    style={{
                      marginTop: 4,
                      height: 3,
                      borderRadius: 3,
                      background: tokens.colors.sand[200],
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${percent}%`,
                        height: '100%',
                        background: tokens.semantic.brand,
                      }}
                    />
                  </div>
                </Td>
                <Td nowrap>{VERIFICATION_LABELS[task.verification]}</Td>
                <Td>
                  <Pill
                    tone={
                      task.status === 'ACTIVE'
                        ? 'success'
                        : task.status === 'PAUSED' || task.status === 'DRAFT'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {task.status}
                  </Pill>
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {task.status !== 'ACTIVE' && (
                      <AdminButton
                        size="xs"
                        tone="success"
                        disabled={busyId !== null}
                        onClick={() => void setStatus(task, 'ACTIVE')}
                      >
                        Activate
                      </AdminButton>
                    )}
                    {task.status === 'ACTIVE' && (
                      <AdminButton
                        size="xs"
                        disabled={busyId !== null}
                        onClick={() => void setStatus(task, 'PAUSED')}
                      >
                        Pause
                      </AdminButton>
                    )}
                    <AdminButton
                      size="xs"
                      disabled={busyId !== null}
                      onClick={() => setEditing(editing === task.id ? null : task.id)}
                    >
                      {editing === task.id ? 'Close' : 'Edit'}
                    </AdminButton>
                  </div>

                  {/* A campaign that spent its budget pauses itself, which is
                      right — but an admin looking at COMPLETED needs to be
                      told that adding money is what starts it again. */}
                  {task.status === 'COMPLETED' && (
                    <p style={exhaustedNoteStyle}>
                      Budget spent, so it stopped itself. Add to the budget to run it again.
                    </p>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </AdminCard>

      {editingTask && (
        <EditTaskForm
          key={editingTask.id}
          task={editingTask}
          onDone={(message) => {
            setEditing(null);
            setNotice(message);
            void load();
            void refreshDashboard();
          }}
        />
      )}
    </div>
  );
}

function CreateTaskForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [category, setCategory] = useState<TaskCategory>('TELEGRAM');
  const [verification, setVerification] = useState<VerificationMethod>('TELEGRAM_MEMBERSHIP');
  const [reward, setReward] = useState('');
  const [budget, setBudget] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [chatId, setChatId] = useState('');
  const [sponsorName, setSponsorName] = useState('');
  const [dwell, setDwell] = useState('8');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const rewardKobo = parseNairaInput(reward);
  const budgetKobo = parseNairaInput(budget);
  const maxCompletions =
    rewardKobo && budgetKobo && rewardKobo > 0 ? Math.floor(budgetKobo / rewardKobo) : 0;
  const overCap = rewardKobo !== null && rewardKobo > LIMITS.MAX_TASK_REWARD_KOBO;

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api.post('/admin/tasks', {
        title: title.trim(),
        description: description.trim(),
        instructions: instructions
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        category,
        verification,
        rewardKobo,
        budgetKobo,
        perUserLimit: 1,
        minimumDwellSeconds: Number.parseInt(dwell, 10) || 0,
        sortWeight: 100,
        status: 'DRAFT',
        ...(slug.trim() ? { slug: slug.trim().toLowerCase() } : {}),
        ...(targetUrl.trim() ? { targetUrl: targetUrl.trim() } : {}),
        ...(chatId.trim() ? { telegramChatId: chatId.trim() } : {}),
        ...(sponsorName.trim() ? { sponsorName: sponsorName.trim() } : {}),
      });
      onCreated();
    } catch (caught) {
      if (caught instanceof ApiError && caught.fields) setFieldErrors(caught.fields);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [
    title, slug, description, instructions, category, verification, rewardKobo, budgetKobo,
    dwell, targetUrl, chatId, sponsorName, onCreated,
  ]);

  // Shown live, so the admin sees the link their id produces before saving.
  const previewSlug = slug.trim() ? toTaskSlug(slug) : toTaskSlug(title);

  const ready =
    title.trim().length >= 4 &&
    description.trim().length >= 10 &&
    instructions.trim().length > 0 &&
    rewardKobo !== null &&
    budgetKobo !== null &&
    !overCap &&
    budgetKobo >= rewardKobo &&
    (verification !== 'TELEGRAM_MEMBERSHIP' || chatId.trim().length > 0);

  return (
    <AdminCard title="New campaign">
      <div style={{ display: 'grid', gap: 12 }}>
        <AdminField label="Title" hint={fieldErrors.title}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Join the Fundxtra announcements channel"
            style={adminInputStyle}
          />
        </AdminField>

        {/*
          The link id. One short word instead of a generated string: it names
          the campaign in its own share link, and because it is also the task's
          document id, two campaigns cannot end up sharing one.
        */}
        <AdminField
          label="Link id"
          hint={fieldErrors.slug ?? 'Optional — taken from the title if you leave it blank.'}
        >
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="crediplex"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={adminInputStyle}
          />
          {previewSlug && (
            <p
              style={{
                marginTop: 6,
                fontFamily: tokens.typography.fontMono,
                fontSize: tokens.typography.size['2xs'],
                color: tokens.semantic.inkMuted,
                wordBreak: 'break-all',
              }}
            >
              Share link: {taskLink(config.botUsername, previewSlug)}
            </p>
          )}
        </AdminField>

        <AdminField label="Description" hint={fieldErrors.description}>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="What the user is being asked to do, in their words."
            style={{ ...adminInputStyle, minHeight: 60, padding: 10, resize: 'vertical' }}
          />
        </AdminField>

        <AdminField label="Instructions" hint="One step per line. Shown as a numbered list.">
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={4}
            placeholder={'Tap Open Channel\nTap Join at the bottom\nCome back and tap Verify'}
            style={{ ...adminInputStyle, minHeight: 90, padding: 10, resize: 'vertical' }}
          />
        </AdminField>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
            gap: 12,
          }}
        >
          <AdminField label="Category">
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as TaskCategory)}
              style={adminInputStyle}
            >
              {Object.entries(TASK_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </AdminField>

          <AdminField
            label="Verification"
            hint={
              verification === 'HONOUR'
                ? 'Credits on click with no check at all. Use only for zero-cost tasks.'
                : undefined
            }
          >
            <select
              value={verification}
              onChange={(event) => setVerification(event.target.value as VerificationMethod)}
              style={adminInputStyle}
            >
              {Object.entries(VERIFICATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </AdminField>

          <AdminField
            label="Reward in Naira"
            hint={
              overCap
                ? `The maximum is ${formatNaira(LIMITS.MAX_TASK_REWARD_KOBO)} per task`
                : (fieldErrors.rewardKobo ?? undefined)
            }
          >
            <input
              inputMode="decimal"
              value={reward}
              onChange={(event) => setReward(event.target.value)}
              placeholder="150"
              style={{
                ...adminInputStyle,
                borderColor: overCap ? tokens.colors.danger.base : tokens.semantic.border,
              }}
            />
          </AdminField>

          <AdminField
            label="Campaign budget in Naira"
            hint={
              maxCompletions > 0
                ? `Funds ${maxCompletions.toLocaleString('en-NG')} completions`
                : (fieldErrors.budgetKobo ?? 'Must cover at least one reward')
            }
          >
            <input
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder="50000"
              style={adminInputStyle}
            />
          </AdminField>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
            gap: 12,
          }}
        >
          <AdminField label="Task URL" hint={fieldErrors.targetUrl}>
            <input
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              placeholder="https://t.me/fundxtra"
              style={adminInputStyle}
            />
          </AdminField>

          {verification === 'TELEGRAM_MEMBERSHIP' && (
            <AdminField
              label="Telegram chat"
              hint={
                fieldErrors.telegramChatId ??
                'The @username or -100… id. The bot must be an administrator there, and we check on save.'
              }
            >
              <input
                value={chatId}
                onChange={(event) => setChatId(event.target.value)}
                placeholder="@fundxtra"
                style={adminInputStyle}
              />
            </AdminField>
          )}

          <AdminField label="Sponsor (optional)">
            <input
              value={sponsorName}
              onChange={(event) => setSponsorName(event.target.value)}
              placeholder="Kredi"
              style={adminInputStyle}
            />
          </AdminField>

          <AdminField
            label="Minimum time on task (seconds)"
            hint="Completions faster than this are flagged for review, not blocked."
          >
            <input
              inputMode="numeric"
              value={dwell}
              onChange={(event) => setDwell(event.target.value.replace(/\D/g, ''))}
              style={adminInputStyle}
            />
          </AdminField>
        </div>

        {error && (
          <p role="alert" style={{ fontSize: tokens.typography.size.sm, color: tokens.colors.danger.strong }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <AdminButton tone="primary" disabled={!ready} loading={busy} onClick={() => void submit()}>
            Create as draft
          </AdminButton>
          <span style={{ fontSize: tokens.typography.size['2xs'], color: tokens.semantic.inkSubtle }}>
            Campaigns are created paused so you can check them before users see them.
          </span>
        </div>
      </div>
    </AdminCard>
  );
}

const exhaustedNoteStyle: React.CSSProperties = {
  marginTop: 6,
  maxWidth: 220,
  fontSize: tokens.typography.size['2xs'],
  lineHeight: tokens.typography.leading.snug,
  color: tokens.semantic.inkMuted,
};

/**
 * Editing a live campaign.
 *
 * Everything a campaign has can be changed here, because the alternative —
 * which is what existed before — is an admin who mistypes a reward or a link
 * having to create a second campaign and pause the first, leaving two rows
 * where there should be one and a share link that now points at the wrong
 * thing.
 *
 * The budget is the exception, and it has its own control. Setting it to an
 * absolute figure asks an admin to do arithmetic against what has already been
 * spent, and getting that wrong cuts a running campaign off. Adding to it
 * cannot be got wrong, so that is what the form offers.
 *
 * Fields are sent only when they are touched. An edit form that submits every
 * field it rendered will happily overwrite something another admin changed
 * while it sat open.
 */
function EditTaskForm({ task, onDone }: { task: Task; onDone: (message: string) => void }) {
  const [patch, setPatch] = useState<Record<string, unknown>>({});
  const [topUp, setTopUp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (field: string, value: unknown) => {
    setPatch((current) => ({ ...current, [field]: value }));
  };

  const touched = Object.keys(patch).length > 0;
  const topUpKobo = parseNairaInput(topUp);
  const remainingKobo = Math.max(0, task.budgetKobo - task.spentKobo);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      if (touched) {
        await api.patch(`/admin/tasks/${task.id}`, patch);
      }
      if (topUpKobo !== null && topUpKobo > 0) {
        await api.post(`/admin/tasks/${task.id}/budget`, { addKobo: topUpKobo });
      }
      onDone(
        topUpKobo && topUpKobo > 0
          ? `Added ${formatNaira(topUpKobo)} to "${task.title}".`
          : `"${task.title}" updated.`,
      );
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fields ?? {});
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, [task, patch, touched, topUpKobo, onDone]);

  const textField = (field: keyof Task, label: string, current: string, hint?: string) => (
    <AdminField label={label} hint={fieldErrors[field] ?? hint}>
      <input
        defaultValue={current}
        onChange={(event) => set(field, event.target.value)}
        style={adminInputStyle}
      />
    </AdminField>
  );

  return (
    <AdminCard title={`Edit "${task.title}"`}>
      <div style={{ display: 'grid', gap: 12 }}>
        {/* Budget first: it is the reason most people open this form. */}
        <AdminField
          label="Add to the campaign budget"
          hint={
            fieldErrors.addKobo ??
            `${formatNaira(task.budgetKobo)} total, ${formatNaira(task.spentKobo)} spent, ${formatNaira(remainingKobo)} left.${
              task.status === 'COMPLETED' ? ' Adding to it will start the campaign again.' : ''
            }`
          }
        >
          <input
            inputMode="decimal"
            value={topUp}
            onChange={(event) => setTopUp(event.target.value)}
            placeholder="5000"
            style={adminInputStyle}
          />
        </AdminField>

        {topUpKobo !== null && topUpKobo > 0 && (
          <p style={{ fontSize: tokens.typography.size.xs, color: tokens.semantic.brandInk }}>
            New budget: <strong>{formatNaira(task.budgetKobo + topUpKobo)}</strong> — funds{' '}
            {Math.floor((remainingKobo + topUpKobo) / task.rewardKobo).toLocaleString('en-NG')} more
            completions.
          </p>
        )}

        <hr style={{ border: 'none', borderTop: `1px solid ${tokens.semantic.divider}`, margin: '2px 0' }} />

        {textField('title', 'Title', task.title)}

        <AdminField label="Description" hint={fieldErrors.description}>
          <textarea
            defaultValue={task.description}
            onChange={(event) => set('description', event.target.value)}
            rows={2}
            style={{ ...adminInputStyle, minHeight: 60, padding: 10, resize: 'vertical' }}
          />
        </AdminField>

        <AdminField label="Instructions" hint={fieldErrors.instructions ?? 'One step per line.'}>
          <textarea
            defaultValue={task.instructions.join('\n')}
            onChange={(event) =>
              set(
                'instructions',
                event.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
              )
            }
            rows={4}
            style={{ ...adminInputStyle, minHeight: 90, padding: 10, resize: 'vertical' }}
          />
        </AdminField>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
            gap: 12,
          }}
        >
          <AdminField label="Category">
            <select
              defaultValue={task.category}
              onChange={(event) => set('category', event.target.value)}
              style={adminInputStyle}
            >
              {Object.entries(TASK_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </AdminField>

          <AdminField
            label="Verification"
            hint={
              fieldErrors.verification ??
              (task.pendingCount > 0
                ? `Locked while ${String(task.pendingCount)} submission(s) wait on the current rule.`
                : undefined)
            }
          >
            <select
              defaultValue={task.verification}
              disabled={task.pendingCount > 0}
              onChange={(event) => set('verification', event.target.value)}
              style={adminInputStyle}
            >
              {Object.entries(VERIFICATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </AdminField>

          <AdminField
            label="Reward in Naira"
            hint={
              fieldErrors.rewardKobo ??
              (task.completionCount > 0
                ? 'Can be raised, never lowered — people have already earned at the current rate.'
                : undefined)
            }
          >
            <input
              inputMode="decimal"
              defaultValue={String(task.rewardKobo / 100)}
              onChange={(event) => {
                const parsed = parseNairaInput(event.target.value);
                if (parsed !== null) set('rewardKobo', parsed);
              }}
              style={adminInputStyle}
            />
          </AdminField>

          <AdminField label="Times each person may complete it" hint={fieldErrors.perUserLimit}>
            <input
              inputMode="numeric"
              defaultValue={String(task.perUserLimit)}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(parsed)) set('perUserLimit', parsed);
              }}
              style={adminInputStyle}
            />
          </AdminField>
        </div>

        <AdminField
          label="Where the task sends people"
          hint={fieldErrors.targetUrl ?? 'A Telegram name, or a full web address.'}
        >
          <input
            defaultValue={task.targetUrl ?? ''}
            onChange={(event) => set('targetUrl', event.target.value || null)}
            style={adminInputStyle}
          />
        </AdminField>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
            gap: 12,
          }}
        >
          <AdminField label="Telegram chat" hint={fieldErrors.telegramChatId}>
            <input
              defaultValue={task.telegramChatLabel ?? ''}
              onChange={(event) => set('telegramChatId', event.target.value || null)}
              style={adminInputStyle}
            />
          </AdminField>

          <AdminField label="Sponsor" hint={fieldErrors.sponsorName}>
            <input
              defaultValue={task.sponsor?.name ?? ''}
              onChange={(event) => set('sponsorName', event.target.value || null)}
              style={adminInputStyle}
            />
          </AdminField>

          <AdminField label="Minimum seconds on the task" hint={fieldErrors.minimumDwellSeconds}>
            <input
              inputMode="numeric"
              defaultValue={String(task.minimumDwellSeconds)}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(parsed)) set('minimumDwellSeconds', parsed);
              }}
              style={adminInputStyle}
            />
          </AdminField>

          <AdminField label="Order in the list" hint={fieldErrors.sortWeight ?? 'Higher shows first.'}>
            <input
              inputMode="numeric"
              defaultValue={String(task.sortWeight)}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(parsed)) set('sortWeight', parsed);
              }}
              style={adminInputStyle}
            />
          </AdminField>
        </div>

        {error && (
          <p style={{ fontSize: tokens.typography.size.xs, color: tokens.colors.danger.strong }}>
            {error}
          </p>
        )}

        <AdminButton
          tone="primary"
          loading={busy}
          disabled={busy || (!touched && !(topUpKobo !== null && topUpKobo > 0))}
          onClick={() => void save()}
        >
          {!touched && !(topUpKobo !== null && topUpKobo > 0) ? 'Nothing changed yet' : 'Save changes'}
        </AdminButton>
      </div>
    </AdminCard>
  );
}
