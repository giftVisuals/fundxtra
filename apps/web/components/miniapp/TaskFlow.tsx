'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ACCEPTED_PROOF_MIME_TYPES,
  LIMITS,
  TASK_CATEGORY_LABELS,
  VERIFICATION_HINTS,
  VERIFICATION_LABELS,
  formatNaira,
  tokens,
  type TaskListItem,
} from '@fundxtra/shared';
import { Badge, Button, Card, ErrorState, SuccessState } from '@/components/ui';
import { api, ApiError, errorMessage, errorRequestId } from '@/lib/api';
import { haptic, openExternal } from '@/lib/telegram';
import { BudgetBar } from '@/components/ui/BudgetBar';

/**
 * Completing a task, as a page with steps rather than one long sheet.
 *
 * The sheet asked for everything at once — read the task, go and do it, come
 * back, attach a screenshot, submit — in a panel the user had to scroll inside
 * while also leaving the app halfway through. Two things went wrong with that.
 * The submit button sat at the bottom whether or not a screenshot had been
 * attached, so tapping it with nothing chosen produced a small error line
 * further up the scroll that read, from the user's seat, as nothing happening
 * at all. And the one thing the task actually requires — leaving the app and
 * coming back — is exactly what a modal is worst at.
 *
 * Split into steps, each one asks for a single thing and cannot be left until
 * it has it. The button says what is missing instead of failing when pressed,
 * which is the whole difference between "nothing happened" and "attach your
 * screenshot first".
 */

type Step = 'brief' | 'proof' | 'confirm' | 'done';

type Outcome =
  | { kind: 'credited'; rewardKobo: number; message: string }
  | { kind: 'queued'; message: string };

export function TaskFlow({
  task,
  supportUrl,
  onClose,
  onCompleted,
}: {
  task: TaskListItem;
  supportUrl: string;
  onClose: () => void;
  onCompleted: (balanceAfterKobo?: number) => Promise<void>;
}) {
  const reduceMotion = useReducedMotion();

  /*
    A task can be opened from the "already handled" list, and it must not offer
    itself again when it does. The sheet this replaced gated its buttons on
    this and the rewrite dropped it, which is how a completed task came back
    looking available — the server refused a second attempt, but only after the
    user had done the whole thing again, which reads as the first one not
    having counted.
  */
  const openForCompletion = task.userState === 'AVAILABLE' || task.userState === 'REJECTED';
  const retrying = task.userState === 'REJECTED';

  const needsProof = task.requiresProof;
  const needsAnswer = task.verification === 'MANUAL_REVIEW';
  const steps: Step[] = needsProof ? ['brief', 'proof', 'confirm'] : ['brief', 'confirm'];

  const [step, setStep] = useState<Step>('brief');
  const [opened, setOpened] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; requestId?: string } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const openedAt = useRef<number>(0);

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  // A preview of what is about to be sent, so "is that the right screenshot?"
  // is answered before submitting rather than after.
  useEffect(() => {
    if (!proofFile) {
      setProofPreview(null);
      return;
    }
    const url = URL.createObjectURL(proofFile);
    setProofPreview(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [proofFile]);

  /** Why this step cannot be left, or null when it can. */
  const blocker = ((): string | null => {
    if (step === 'brief') {
      if (task.targetUrl && !opened) return 'Open the task first';
      return null;
    }
    if (step === 'proof') {
      if (!proofFile) return 'Attach your screenshot';
      return null;
    }
    if (step === 'confirm' && needsAnswer && !answer.trim()) return 'Write your answer';
    return null;
  })();

  const goBack = useCallback(() => {
    if (submitting) return;
    const index = steps.indexOf(step);
    if (index <= 0) {
      onClose();
      return;
    }
    setFailure(null);
    setStep(steps[index - 1] as Step);
  }, [step, steps, submitting, onClose]);

  const chooseFile = useCallback((file: File | null) => {
    setProofError(null);
    if (file && file.size > LIMITS.MAX_PROOF_BYTES) {
      setProofError(
        `That file is too large. Please keep it under ${Math.floor(LIMITS.MAX_PROOF_BYTES / 1024 / 1024)}MB.`,
      );
      setProofFile(null);
      return;
    }
    setProofFile(file);
    if (file) haptic.light();
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setFailure(null);

    try {
      let proofPath: string | undefined;

      if (needsProof) {
        if (!proofFile) {
          setProofError('Please attach your screenshot.');
          setStep('proof');
          return;
        }
        const form = new FormData();
        form.append('proof', proofFile);
        const uploaded = await api.upload<{ proofPath: string }>(`/tasks/${task.id}/proof`, form);
        proofPath = uploaded.proofPath;
      }

      const result = await api.post<{
        state: 'CREDITED' | 'PENDING_REVIEW';
        rewardKobo: number;
        balanceAfterKobo?: number;
        message: string;
      }>(`/tasks/${task.id}/complete`, {
        ...(proofPath ? { proofPath } : {}),
        ...(answer.trim() ? { answer: answer.trim() } : {}),
        dwellSeconds: Math.round((Date.now() - openedAt.current) / 1000),
      });

      if (result.state === 'CREDITED') {
        haptic.success();
        setOutcome({ kind: 'credited', rewardKobo: result.rewardKobo, message: result.message });
      } else {
        haptic.light();
        setOutcome({ kind: 'queued', message: result.message });
      }
      setStep('done');
      await onCompleted(result.balanceAfterKobo);
    } catch (caught) {
      haptic.error();
      // A problem with the file belongs on the step that asked for it, not on
      // the confirmation screen where it cannot be fixed.
      if (caught instanceof ApiError && caught.fieldError('proof')) {
        setProofError(caught.fieldError('proof') ?? null);
        setStep('proof');
        return;
      }
      setFailure({
        message: errorMessage(caught),
        ...(errorRequestId(caught) ? { requestId: errorRequestId(caught) } : {}),
      });
    } finally {
      setSubmitting(false);
    }
  }, [needsProof, proofFile, answer, task.id, onCompleted]);

  const stepIndex = steps.indexOf(step);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {step !== 'done' && (
          <button
            type="button"
            onClick={goBack}
            disabled={submitting}
            aria-label={step === 'brief' ? 'Back to tasks' : 'Back a step'}
            style={backButtonStyle(submitting)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        )}

        <h1 style={{ flex: 1, fontSize: tokens.typography.size.lg }}>
          {step === 'brief' && task.title}
          {step === 'proof' && 'Your screenshot'}
          {step === 'confirm' && 'Check and submit'}
          {step === 'done' && (outcome?.kind === 'credited' ? 'Paid' : 'Submitted')}
        </h1>

        {step !== 'done' && (
          <div aria-hidden="true" style={{ display: 'flex', gap: 4 }}>
            {steps.map((entry, index) => (
              <span
                key={entry}
                style={{
                  width: index === stepIndex ? 18 : 6,
                  height: 6,
                  borderRadius: tokens.radii.pill,
                  background:
                    index <= stepIndex ? tokens.semantic.brand : tokens.semantic.borderStrong,
                  transition: 'width 180ms ease, background 180ms ease',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {failure && (
        <ErrorState
          title="Could not submit that"
          message={failure.message}
          {...(failure.requestId ? { requestId: failure.requestId } : {})}
          supportUrl={supportUrl}
        />
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduceMotion ? undefined : { opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, x: -14 }}
          transition={tokens.motion.spring.panel}
          style={{ display: 'grid', gap: 16 }}
        >
          {step === 'brief' && retrying && (
            <Card padding={14}>
              <p style={{ fontSize: tokens.typography.size.sm, fontWeight: tokens.typography.weight.semibold }}>
                Your last try was turned down
              </p>
              <p
                style={{
                  marginTop: 4,
                  fontSize: tokens.typography.size.sm,
                  lineHeight: tokens.typography.leading.relaxed,
                  color: tokens.semantic.inkMuted,
                }}
              >
                {task.rejectionReason ?? 'It did not show what the task asked for.'}
              </p>
              <p
                style={{
                  marginTop: 6,
                  fontSize: tokens.typography.size.sm,
                  color: tokens.semantic.inkMuted,
                }}
              >
                Nothing was deducted. Fix that and send a new screenshot — you can try again.
              </p>
            </Card>
          )}

          {step === 'brief' && (
            <BriefStep task={task} opened={opened || !openForCompletion} onOpen={() => {
              setOpened(true);
              haptic.light();
              openExternal(task.targetUrl as string);
            }} />
          )}

          {step === 'proof' && (
            <ProofStep
              fileInputRef={fileInputRef}
              proofFile={proofFile}
              proofPreview={proofPreview}
              proofError={proofError}
              onChoose={chooseFile}
            />
          )}

          {step === 'confirm' && (
            <ConfirmStep
              task={task}
              proofPreview={proofPreview}
              proofFile={proofFile}
              needsAnswer={needsAnswer}
              answer={answer}
              onAnswer={setAnswer}
            />
          )}

          {step === 'done' && outcome && (
            <div style={{ display: 'grid', gap: 16 }}>
              {outcome.kind === 'credited' ? (
                <SuccessState
                  title={`${formatNaira(outcome.rewardKobo)} added`}
                  message={outcome.message}
                />
              ) : (
                <SuccessState title="Sent for review" message={outcome.message} />
              )}
              <Button fullWidth size="lg" onClick={onClose}>
                Back to tasks
              </Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {!openForCompletion && (
        <ClosedNotice state={task.userState} reason={task.rejectionReason} onClose={onClose} />
      )}

      {step !== 'done' && openForCompletion && (
        <Button
          fullWidth
          size="lg"
          disabled={Boolean(blocker) || submitting}
          loading={submitting}
          onClick={() => {
            if (step === 'confirm') {
              void submit();
              return;
            }
            haptic.light();
            setFailure(null);
            setStep(steps[stepIndex + 1] as Step);
          }}
        >
          {blocker
            ? blocker
            : step === 'confirm'
              ? needsProof
                ? 'Submit screenshot'
                : `Claim ${formatNaira(task.rewardKobo)}`
              : 'Continue'}
        </Button>
      )}
    </div>
  );
}

/**
 * Why this task cannot be done right now.
 *
 * Shown instead of the submit button rather than alongside it. A disabled
 * button with an explanation beside it still reads as "try again"; no button
 * with a sentence reads as an answer.
 */
function ClosedNotice({
  state,
  reason,
  onClose,
}: {
  state: TaskListItem['userState'];
  reason: string | null;
  onClose: () => void;
}) {
  const copy: Record<string, { title: string; body: string }> = {
    COMPLETED: {
      title: 'You have done this one',
      body: 'It is finished and the reward is in your wallet. Nothing more to do here.',
    },
    PENDING_REVIEW: {
      title: 'Waiting for review',
      body: 'Your submission is with our team. You will get a message either way, usually within 24 hours.',
    },
    REJECTED: {
      title: 'This was turned down',
      body: reason ?? 'Our team could not accept this submission. Nothing was deducted.',
    },
    UNAVAILABLE: {
      title: 'Not available right now',
      body: 'This campaign is closed or fully claimed. New ones are added regularly.',
    },
  };

  const message = copy[state] ?? copy.UNAVAILABLE!;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card tone={state === 'REJECTED' ? 'plain' : 'brand'} padding={14}>
        <p
          style={{
            fontSize: tokens.typography.size.sm,
            fontWeight: tokens.typography.weight.semibold,
          }}
        >
          {message.title}
        </p>
        <p
          style={{
            marginTop: 4,
            fontSize: tokens.typography.size.sm,
            lineHeight: tokens.typography.leading.relaxed,
            color: tokens.semantic.inkMuted,
          }}
        >
          {message.body}
        </p>
      </Card>
      <Button variant="secondary" fullWidth size="lg" onClick={onClose}>
        Back to tasks
      </Button>
    </div>
  );
}

/** Step 1: what the task is, and the trip out to go and do it. */
function BriefStep({
  task,
  opened,
  onOpen,
}: {
  task: TaskListItem;
  opened: boolean;
  onOpen: () => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={rowStyle}>
        <div>
          <p style={labelStyle}>Reward</p>
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

      <Card tone="brand" padding={12}>
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

      <div>
        <h2 style={headingStyle}>Steps</h2>
        <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
          {task.instructions.map((instruction, index) => (
            <li key={index} style={{ display: 'flex', gap: 10 }}>
              <span aria-hidden="true" style={stepNumberStyle}>
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
      </div>

      {task.targetUrl && (
        <Button fullWidth size="lg" variant={opened ? 'secondary' : 'primary'} onClick={onOpen}>
          {opened ? 'Open it again' : 'Open task'}
        </Button>
      )}

      {opened && (
        <p style={{ fontSize: tokens.typography.size.xs, color: tokens.semantic.inkSubtle, textAlign: 'center' }}>
          Done it? Continue below.
        </p>
      )}

      <div>
        <h2 style={headingStyle}>Campaign</h2>
        <BudgetBar budget={task.budget} />
      </div>

      {task.minimumDwellSeconds > 0 && (
        <p style={{ fontSize: tokens.typography.size.xs, color: tokens.semantic.inkSubtle }}>
          Take your time — completing this properly takes at least {task.minimumDwellSeconds}{' '}
          seconds.
        </p>
      )}
    </div>
  );
}

/** Step 2: the screenshot, and nothing else on the screen to distract from it. */
function ProofStep({
  fileInputRef,
  proofFile,
  proofPreview,
  proofError,
  onChoose,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  proofFile: File | null;
  proofPreview: string | null;
  proofError: string | null;
  onChoose: (file: File | null) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p
        style={{
          fontSize: tokens.typography.size.base,
          lineHeight: tokens.typography.leading.relaxed,
          color: tokens.semantic.inkMuted,
        }}
      >
        Attach a screenshot showing you completed the task. A person checks every one.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_PROOF_MIME_TYPES.join(',')}
        onChange={(event) => onChoose(event.target.files?.[0] ?? null)}
        style={{ display: 'none' }}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        style={{
          display: 'grid',
          gap: 10,
          placeItems: 'center',
          width: '100%',
          minHeight: proofPreview ? 0 : 160,
          padding: 16,
          background: proofFile ? tokens.colors.success.soft : tokens.semantic.bgSubtle,
          border: `1.5px dashed ${
            proofError
              ? tokens.colors.danger.base
              : proofFile
                ? '#cfe7d7'
                : tokens.semantic.borderStrong
          }`,
          borderRadius: tokens.radii.lg,
          textAlign: 'center',
        }}
      >
        {proofPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proofPreview}
            alt="Your screenshot"
            style={{
              maxWidth: '100%',
              maxHeight: 280,
              borderRadius: tokens.radii.md,
              border: `1px solid ${tokens.semantic.border}`,
            }}
          />
        ) : (
          <span aria-hidden="true" style={uploadGlyphStyle}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 11V3.5M5 6.5 8 3.5l3 3M3 11.5v1A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-1" />
            </svg>
          </span>
        )}

        <span>
          <span
            style={{
              display: 'block',
              fontSize: tokens.typography.size.sm,
              fontWeight: tokens.typography.weight.semibold,
            }}
          >
            {proofFile ? 'Tap to choose a different one' : 'Choose a screenshot'}
          </span>
          <span
            style={{
              display: 'block',
              marginTop: 2,
              fontSize: tokens.typography.size.xs,
              color: tokens.semantic.inkMuted,
            }}
          >
            {proofFile ? fileSize(proofFile.size) : 'PNG, JPEG or WebP'}
          </span>
        </span>
      </button>

      {proofError && (
        <p
          role="alert"
          style={{ fontSize: tokens.typography.size.xs, color: tokens.colors.danger.strong }}
        >
          {proofError}
        </p>
      )}
    </div>
  );
}

/** Step 3: everything that is about to be sent, on one screen. */
function ConfirmStep({
  task,
  proofPreview,
  proofFile,
  needsAnswer,
  answer,
  onAnswer,
}: {
  task: TaskListItem;
  proofPreview: string | null;
  proofFile: File | null;
  needsAnswer: boolean;
  answer: string;
  onAnswer: (value: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card padding={14}>
        <div style={rowStyle}>
          <span style={{ fontSize: tokens.typography.size.sm, color: tokens.semantic.inkMuted }}>
            Task
          </span>
          <span
            style={{
              fontSize: tokens.typography.size.sm,
              fontWeight: tokens.typography.weight.semibold,
              textAlign: 'right',
            }}
          >
            {task.title}
          </span>
        </div>
        <div style={{ ...rowStyle, marginTop: 10 }}>
          <span style={{ fontSize: tokens.typography.size.sm, color: tokens.semantic.inkMuted }}>
            Reward
          </span>
          <span
            className="fx-tabular"
            style={{
              fontSize: tokens.typography.size.base,
              fontWeight: tokens.typography.weight.bold,
              color: tokens.semantic.brandInk,
            }}
          >
            {formatNaira(task.rewardKobo)}
          </span>
        </div>
      </Card>

      {proofPreview && (
        <div>
          <h2 style={headingStyle}>Your screenshot</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={proofPreview}
            alt="Your screenshot"
            style={{
              width: '100%',
              maxHeight: 260,
              objectFit: 'contain',
              background: tokens.semantic.bgSubtle,
              borderRadius: tokens.radii.md,
              border: `1px solid ${tokens.semantic.border}`,
            }}
          />
          <p style={{ marginTop: 6, fontSize: tokens.typography.size.xs, color: tokens.semantic.inkSubtle }}>
            {proofFile?.name}
          </p>
        </div>
      )}

      {needsAnswer && (
        <div>
          <label htmlFor="fx-task-answer" style={{ ...headingStyle, display: 'block' }}>
            Your answer
          </label>
          <textarea
            id="fx-task-answer"
            value={answer}
            onChange={(event) => onAnswer(event.target.value)}
            rows={3}
            maxLength={600}
            placeholder="Paste your completion code or the details requested"
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

      <p
        style={{
          fontSize: tokens.typography.size.xs,
          lineHeight: tokens.typography.leading.relaxed,
          color: tokens.semantic.inkSubtle,
        }}
      >
        {task.requiresProof
          ? 'A person checks your screenshot. You will get a message either way — nothing is deducted if it is turned down.'
          : VERIFICATION_HINTS[task.verification]}
      </p>
    </div>
  );
}

/** Phone screenshots are often well under a megabyte, and "0.0MB" reads as an
 *  empty file rather than a small one. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString('en-NG')}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: tokens.typography.size['2xs'],
  letterSpacing: tokens.typography.tracking.wider,
  textTransform: 'uppercase',
  color: tokens.semantic.inkSubtle,
};

const headingStyle: React.CSSProperties = {
  marginBottom: 10,
  fontSize: tokens.typography.size.sm,
  fontWeight: tokens.typography.weight.semibold,
  letterSpacing: tokens.typography.tracking.wider,
  textTransform: 'uppercase',
  color: tokens.semantic.inkSubtle,
};

const stepNumberStyle: React.CSSProperties = {
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
};

const uploadGlyphStyle: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 46,
  height: 46,
  borderRadius: tokens.radii.md,
  background: '#fff',
  border: `1px solid ${tokens.semantic.border}`,
  color: tokens.semantic.brand,
};

function backButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'grid',
    placeItems: 'center',
    width: 34,
    height: 34,
    flex: 'none',
    background: tokens.semantic.bgSubtle,
    color: tokens.semantic.brandInk,
    border: `1px solid ${tokens.semantic.border}`,
    borderRadius: tokens.radii.pill,
    opacity: disabled ? 0.5 : 1,
  };
}
