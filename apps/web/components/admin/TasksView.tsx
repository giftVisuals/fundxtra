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
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      </AdminCard>
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
