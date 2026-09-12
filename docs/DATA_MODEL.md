# Data model

Firestore. Every monetary field is an **integer number of kobo** (100 kobo = ₦1)
and its name ends in `Kobo`. Timestamps are Firestore `Timestamp` in storage and
ISO-8601 strings at every API boundary.

Three collections use a **deterministic document id as a database-enforced
constraint** rather than a runtime check. Those are called out below, because
they are where the platform's integrity actually lives.

---

## `users/{telegramId}`

**The document id is the Telegram id.** One Telegram account can therefore only
ever be one Fundxtra account — structural, not enforced. Two simultaneous
first-opens cannot produce two users, because creation uses `create()` on a
deterministically-named document.

| Field | Type | Notes |
| --- | --- | --- |
| `telegramId` | string | Same as the id |
| `username`, `firstName`, `lastName` | string \| null | Refreshed from Telegram on every sign-in |
| `photoUrl`, `languageCode`, `isPremiumTelegram` | — | Display only |
| `status` | `ACTIVE` \| `SUSPENDED` \| `BANNED` | Checked before any state change |
| `hasPin` | boolean | The hash itself is in `pins/{id}` |
| `onboardedAt` | timestamp \| null | **The referral qualification gate.** Set once |
| `balanceKobo` | int | **A cache of the ledger.** Only written inside a transaction that also writes a `transactions` row |
| `lifetimeEarnedKobo`, `lifetimePaidOutKobo` | int | Incremented by the ledger |
| `pendingOutKobo` | int | Display only: money already debited and in flight |
| `tasksCompleted` | int | |
| `referralCode` | string | 8 chars, no 0/O/1/I/L — these get read aloud |
| `referredBy` | string \| null | Written once, never changed |
| `referralCount`, `qualifiedReferralCount`, `referralEarningsKobo` | — | |
| `riskScore` (0–100), `riskBand`, `flags[]` | — | Queue review; never auto-ban |
| `createdAt`, `updatedAt`, `lastSeenAt` | timestamp | |

---

## `pins/{userId}`

A **separate collection from `users`**, specifically so that no profile query,
admin listing or export can carry PIN material with it.

| Field | Type | Notes |
| --- | --- | --- |
| `hash` | string | `scrypt$N$r$p$salt_b64$hash_b64` — parameters are encoded so they can be raised later |
| `failedAttempts` | int | |
| `lockedUntil` | timestamp \| null | **Persisted, not in memory** — a redeploy must not grant fresh attempts |
| `lastVerifiedAt`, `createdAt`, `updatedAt` | timestamp | |
| `resetByAdminId` | string \| null | |

An admin reset **deletes** this document rather than setting a known value, so
no administrator ever learns a user's PIN.

---

## `transactions/{txId}`

**The authoritative record of every balance movement.** Immutable: written once,
never edited. A correction is a new `REVERSAL` row pointing back via
`reversalOf`.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | string | |
| `type` | enum | `TASK_REWARD`, `REFERRAL_REWARD`, `CASH_WITHDRAWAL`, `AIRTIME_REDEMPTION`, `DATA_REDEMPTION`, `TELEGRAM_STARS_REDEMPTION`, `TELEGRAM_PREMIUM_REDEMPTION`, `REVERSAL`, `ADMIN_ADJUSTMENT`, `BONUS` |
| `direction` | `CREDIT` \| `DEBIT` | Asserted to agree with the sign of `amountKobo` |
| `amountKobo` | int | **Signed.** Negative for debits |
| `status` | `PENDING` \| `COMPLETED` \| `FAILED` \| `REVERSED` | Describes *external fulfilment*, not whether money moved |
| `balanceAfterKobo` | int | Makes a dispute auditable without replaying the whole ledger |
| `description` | string | Shown in the user's history |
| `reference` | string \| null | Provider reference, withdrawal id or task id |
| `idempotencyKey` | string | The key that authorised this row |
| `reversalOf` | string \| null | Set on `REVERSAL` rows |
| `actorAdminId` | string \| null | Set when an admin caused it |
| `metadata` | map | |

**Every row moved the balance when it was written**, whatever its status. So no
status is excluded when recomputing a balance — excluding `FAILED` while
counting its reversal double-counts, which was a real bug caught by the audit
assertions.

---

## `idempotencyKeys/{key}`

Created with `create()` **inside** the ledger transaction. Firestore fails a
`create()` on an existing document, so a retried request reuses the original
entry instead of creating a second one. This is the double-credit defence, and
it is enforced by the database rather than by a check-then-act read that a
concurrent request could slip between.

| Field | Type |
| --- | --- |
| `transactionId`, `userId`, `type` | string |
| `createdAt`, `expiresAt` | timestamp (prunable after 30 days) |

Key shapes: `task__{userId}__{taskId}`, `referral__{referrerId}__{referredId}`,
`withdrawal__{withdrawalId}`, `redemption__{redemptionId}`,
`adjustment__{userId}__{uuid}`.

The adjustment key includes a UUID on purpose: two identical corrections are two
real events, and a shared key would silently swallow the second.

---

## `referrals/{referredUserId}`

**The document id is the referred user's id.** One Telegram account can appear
as "the referred party" exactly once, ever — duplicate attribution is
impossible rather than merely guarded against.

| Field | Type | Notes |
| --- | --- | --- |
| `referrerId`, `referredId` | string | |
| `referredUsername`, `referredFirstName` | — | For the referrer's list |
| `status` | `PENDING` \| `QUALIFIED` \| `REJECTED` | |
| `rewardKobo` | int | Captured at attribution, so a later settings change does not alter a promised amount |
| `transactionId` | string \| null | The ₦100 credit; null until qualified |
| `rejectionReason` | string \| null | |
| `createdAt`, `qualifiedAt` | timestamp | |

Qualification requires: started Fundxtra → created a PIN → reached the
dashboard. A task completion is **not** required.

---

## `tasks/{taskId}`

| Field | Type | Notes |
| --- | --- | --- |
| `title`, `description`, `instructions[]` | — | |
| `category` | enum | `TELEGRAM`, `SOCIAL`, `APP_INSTALL`, `SURVEY`, `CONTENT`, `SIGNUP`, `OTHER` |
| `status` | enum | `DRAFT`, `ACTIVE`, `PAUSED`, `EXPIRED`, `COMPLETED` — where `COMPLETED` specifically means *fully claimed* |
| `rewardKobo` | int | ≤ ₦1,000, enforced server-side |
| `budgetKobo` | int | Total campaign funding |
| `spentKobo` | int | **Approved completions + pending submissions.** A submission awaiting review already holds budget |
| `maxCompletions` | int | Derived from budget ÷ reward, never taken from the client |
| `completionCount`, `pendingCount` | int | |
| `perUserLimit` | int | Usually 1 |
| `verification` | enum | `TELEGRAM_MEMBERSHIP`, `SCREENSHOT`, `MANUAL_REVIEW`, `HONOUR` |
| `requiresProof` | boolean | |
| `targetUrl` | string \| null | |
| `telegramChatId`, `telegramChatLabel` | string \| null | `@username` or `-100…` |
| `verificationWarning` | string \| null | **Admin-facing.** Set when the bot cannot read the chat's members; shown on the campaign row |
| `sponsor` | map \| null | `{ name, logoUrl, verified }` |
| `startsAt`, `endsAt` | timestamp \| null | |
| `minimumDwellSeconds` | int | A soft anti-bot signal; flags for review, never blocks |
| `sortWeight`, `createdBy`, `createdAt`, `updatedAt` | — | |

Reward and budget may only be **raised** once users have started completing —
lowering either would strand approved completions or retroactively change what
someone was promised.

---

## `taskCompletions/{userId}__{taskId}`

**The document id is the (user, task) pair.** A reward is only ever credited by
a transaction that also creates this document, so a second attempt fails and
rolls the credit back with it. This is what makes duplicate task rewards
impossible under concurrency.

| Field | Type |
| --- | --- |
| `taskId`, `userId`, `transactionId` | string |
| `rewardKobo` | int |
| `verification` | enum |
| `submissionId` | string \| null |
| `completedAt` | timestamp |

---

## `taskSubmissions/{submissionId}`

| Field | Type | Notes |
| --- | --- | --- |
| `taskId`, `taskTitle` | — | Title denormalised so the review queue needs one read |
| `userId`, `userTelegramId`, `username` | — | |
| `status` | `PENDING_REVIEW` \| `APPROVED` \| `REJECTED` | |
| `rewardKobo` | int | Captured at submission |
| `proofPath` | string \| null | Storage path; admins see a short-lived signed URL |
| `answer` | string \| null | For `MANUAL_REVIEW` |
| `reviewedBy`, `reviewedAt` | — | |
| `rejectionReason` | string \| null | Shown verbatim to the user |
| `transactionId` | string \| null | Set on approval; guards against double credit |
| `submittedAt` | timestamp | |

**No reward is credited before approval.** Approval credits inside a transaction
with the same `taskCompletions` uniqueness guard, so a double-clicked approve
button cannot pay twice.

---

## `withdrawals/{withdrawalId}`

| Field | Type | Notes |
| --- | --- | --- |
| `userId`, `userTelegramId`, `username` | — | |
| `amountKobo`, `feeKobo`, `netKobo` | int | |
| `status` | `PENDING` \| `PROCESSING` \| `COMPLETED` \| `FAILED` \| `REJECTED` \| `CANCELLED` | Transitions are validated, so a completed payout cannot return to pending |
| `bank` | map | `{ bankCode, bankName, accountNumber, accountName }` |
| `transactionId` | string | The debit, created when the request was accepted |
| `reversalTransactionId` | string \| null | The compensating credit if it fails |
| `providerReference`, `providerName`, `failureReason` | — | |
| `reviewedBy`, `reviewedAt`, `requestedAt`, `updatedAt` | — | |

The balance is debited **on request**, so a pending withdrawal is money the
platform owes — not a reservation against an untouched balance.

---

## `redemptions/{redemptionId}`

| Field | Type | Notes |
| --- | --- | --- |
| `userId`, `userTelegramId` | — | |
| `kind` | `AIRTIME` \| `DATA` \| `TELEGRAM_STARS` \| `TELEGRAM_PREMIUM` | |
| `productId`, `productName`, `amountKobo` | — | Price from the catalogue, never the request |
| `status` | `PENDING` \| `PROCESSING` \| `COMPLETED` \| `FAILED` \| `CANCELLED` | |
| `target` | string | Phone number, or Telegram username for Stars/Premium |
| `transactionId`, `reversalTransactionId` | — | |
| `providerName`, `providerReference`, `failureReason` | — | |

---

## `rewardProducts/{productId}`

| Field | Notes |
| --- | --- |
| `kind`, `name`, `description`, `priceKobo` | |
| `openAmount`, `minAmountKobo`, `maxAmountKobo` | Airtime is open-amount |
| `network`, `dataVolume`, `validityDays`, `stars`, `months` | Kind-specific |
| `available`, `unavailableReason` | Seeded **false**: pricing a reward is not the same as being able to deliver it |
| `sortWeight` | |

The catalogue API further requires that the setting is on *and* the active
provider can deliver that kind, so it cannot advertise something undeliverable.

---

## `admins/{telegramId}` and `adminInvites/{username}`

Telegram ID is the identity. A username creates only a **pending invite**,
claimed the first time that handle signs in — Telegram usernames can be given
up and claimed by someone else, so treating one as an identity would be a
privilege-escalation path.

| `admins` field | Notes |
| --- | --- |
| `role` | `SUPER_ADMIN` \| `ADMIN` \| `MODERATOR` |
| `extraPermissions[]` | Super-admin-only permissions are filtered out on write |
| `active` | Removal deactivates rather than deletes, so audit entries keep a resolvable actor |
| `addedBy`, `createdAt`, `lastActiveAt` | |

The primary admin (`6438544386`) is **synthesised in code**, not read from this
collection, so the platform cannot lock itself out of its own admin panel.

---

## `auditLogs/{logId}` and `securityEvents/{eventId}`

Two records, different questions.

**`auditLogs`** — who changed this, and why. `action`, `actorId`,
`actorUsername`, `actorRole`, `targetType`, `targetId`, `summary`, `before`,
`after`, `reason`, `ip`. For financial actions the write is awaited and allowed
to throw, so the record is a precondition of the change.

**`securityEvents`** — what is happening to accounts. `type`, `severity`,
`userId`, `message`, `ip`, `userAgent`, `metadata`. Best-effort on purpose: a
logging failure must never turn a rejected login into a successful one.

---

## `systemSettings/global`

One document, five sections: `withdrawals`, `rewards`, `referrals`, `tasks`,
`platform`. Cached in the API for 15 seconds and invalidated on write.

**Defaults are fail-closed**: withdrawals off, every reward method off. A money
path should open deliberately, not by default.

The scheduled window (`opensAt`/`closesAt`) takes precedence over the manual
`enabled` toggle, so an admin can schedule "open Friday 9am, close Sunday 6pm"
without having to remember to flip a switch.

---

## `announcements/{announcementId}` and `counters/publicStats`

Announcements carry `audience` (`APP` \| `PUBLIC` \| `BOTH`), `published`,
`publishAt`, `expiresAt` and `pinned`. Scheduling is evaluated **at read time**,
so an announcement set for 8am appears at 8am without a job having run.

`counters/publicStats` holds aggregate totals only, maintained incrementally
with `FieldValue.increment`. It is the one document the marketing site reads
directly through the Firebase Web SDK. `sufficientData` is computed on read:
below 25 users or 50 completed tasks the public site shows an early-stage
message instead of numbers.
