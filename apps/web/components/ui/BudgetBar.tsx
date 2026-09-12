'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { formatNaira, percentageOf, tokens, type TaskBudgetView } from '@fundxtra/shared';

/**
 * Campaign budget progress.
 *
 * This is a user-facing feature, not an admin detail: seeing that a campaign
 * has ₦31,450 of ₦50,000 left is what makes "this task is real and funded"
 * believable, and what makes a fully-claimed task feel like a missed
 * opportunity rather than a broken button.
 *
 * The bar reports the same numbers the server enforces, so it cannot flatter
 * the campaign. Text carries every figure, so the bar is decorative and the
 * information is available to a screen reader through a single labelled
 * progressbar.
 */
export function BudgetBar({
  budget,
  compact = false,
}: {
  budget: TaskBudgetView;
  compact?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const percent = percentageOf(budget.spentKobo, budget.budgetKobo);
  const exhausted = budget.remainingKobo < budget.rewardKobo;

  return (
    <div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Campaign ${Math.round(percent)}% claimed, ${formatNaira(budget.remainingKobo)} remaining`}
        style={{
          position: 'relative',
          height: compact ? 5 : 7,
          borderRadius: tokens.radii.pill,
          background: tokens.colors.sand[100],
          overflow: 'hidden',
        }}
      >
        <motion.div
          initial={reduceMotion ? false : { width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
          style={{
            height: '100%',
            borderRadius: tokens.radii.pill,
            background: exhausted
              ? tokens.colors.sand[400]
              : `linear-gradient(90deg, ${tokens.colors.cocoa[400]}, ${tokens.semantic.brand})`,
          }}
        />
      </div>

      {!compact && (
        <div
          className="fx-tabular"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            marginTop: 8,
            fontSize: tokens.typography.size.xs,
            color: tokens.semantic.inkMuted,
          }}
        >
          <span>
            <strong style={{ color: tokens.semantic.ink, fontWeight: tokens.typography.weight.semibold }}>
              {formatNaira(budget.remainingKobo)}
            </strong>{' '}
            left of {formatNaira(budget.budgetKobo)}
          </span>
          <span>
            {budget.completionCount.toLocaleString('en-NG')} / {budget.maxCompletions.toLocaleString('en-NG')} claimed
          </span>
        </div>
      )}
    </div>
  );
}
