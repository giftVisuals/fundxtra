# Architecture

```
        Vercel                                    Railway
┌──────────────────────────┐              ┌────────────────────────┐
│ apps/web  (Next.js 16)   │   HTTPS      │ apps/api  (Express 5)  │
│                          │ ───────────► │                        │
│ (marketing)  public site │  Bearer JWT  │  initData HMAC verify   │
│ /app         Mini App    │              │  PIN (scrypt) + lockout │
│ /admin       admin panel │              │  atomic ledger          │
└──────────────────────────┘              │  task/budget engine     │
             │                            │  provider abstraction   │
             │  Firebase Web SDK          └───────────┬────────────┘
             │  (public stats only)                   │ Admin SDK
             ▼                                        ▼
      ┌──────────────────────────────────────────────────────┐
      │  Firestore   imgbb (proofs)    Telegram Bot API      │
      └──────────────────────────────────────────────────────┘

              packages/shared
              types · zod schemas · design tokens · money
```

---

## The decisions that shaped this

### One shared package, three surfaces

`@fundxtra/shared` holds the domain types, the zod schemas, the design tokens
and the money helpers. The API and both frontends compile against it, so client
and server cannot disagree about what a valid withdrawal request looks like, and
no component invents a colour.

It is the reason the Mini App, the marketing site and the admin console look
like one product while doing three different jobs.

### Money is integer kobo

Every monetary value that crosses a boundary is an integer number of kobo. Naira
floats are never stored, summed or compared — `0.1 + 0.2 !== 0.3` is not an
acceptable property for a system that owes people money. Variables holding kobo
end in `Kobo`, and `formatNaira()` is the only thing that turns an amount into
text.

### The ledger is authoritative; the balance is a cache

`users/{id}.balanceKobo` exists so a dashboard can render in one read. The
authoritative record is the immutable row in `transactions`. Both are written in
the same Firestore transaction, so they cannot disagree, and
`auditUserBalance()` recomputes from the ledger to prove it.

Corrections are compensating `REVERSAL` rows, never edits. Every row in the
ledger moved the balance when it was written, so no status is excluded from the
sum — a rule that was learned the hard way (see the commit that fixed
`failRedemption` overwriting `REVERSED` with `FAILED`).

### Uniqueness through document ids

Three places use a deterministic document id as a database-enforced constraint
rather than a runtime check:

| Document | Id | Guarantees |
| --- | --- | --- |
| `users/{telegramId}` | Telegram id | One Fundxtra account per Telegram account |
| `referrals/{referredId}` | Referred user's id | One Telegram account can be "referred" once, ever |
| `taskCompletions/{userId}__{taskId}` | The pair | A user is paid once per task |

`create()` fails on an existing document, which aborts the whole transaction —
including the credit. A check-then-act read could be raced; this cannot.

### The frontend never writes to Firestore

Every mutation goes through the API. That costs a round trip and buys the things
security rules cannot express: atomic ledger writes, idempotency keys, campaign
budget limits, rate limiting, audit records, and server-side price resolution.

Firestore rules deny all client writes and nearly all reads. The Firebase Web
SDK is used for exactly one thing — live public statistics on the marketing
site, from a document that contains only aggregate totals.

### Telegram identity, not a password

There is no email and no password, so there is nothing of that kind to phish or
leak. `initData` is verified server-side and exchanged for a short-lived JWT
that carries no authority: admin status and balance are re-read per request.

The PIN is a second factor for money movement, not the identity system. Money
endpoints require it in the request body, not just in the session.

---

## Request flow: completing a task

```
Mini App                       API                          Firestore
   │                            │                               │
   ├─ POST /tasks/:id/complete ─►                                │
   │   (PIN-verified session)   │                               │
   │                            ├─ settings: earning enabled?   │
   │                            ├─ task available? budget left? │
   │                            ├─ already completed?           │
   │                            │                               │
   │                            ├─ getChatMember ──► Telegram    │
   │                            │   JOINED / NOT_JOINED /        │
   │                            │   CONFIG_ERROR / UNAVAILABLE   │
   │                            │                               │
   │                            ├─ runTransaction: ─────────────►│
   │                            │    re-read task (budget)       │
   │                            │    reserve budget              │
   │                            │    create idempotency key      │
   │                            │    create transaction row      │
   │                            │    update balance cache        │
   │                            │    create taskCompletions/pair │
   │                            │    increment tasksCompleted    │
   │                            │   all of it, or none of it     │
   ◄── { CREDITED, balanceAfter }│                               │
```

The three Telegram outcomes are kept distinct deliberately. `NOT_JOINED` tells
the user. `CONFIG_ERROR` — the bot is not an administrator of the target chat —
tells the *admin*, stores the advice on the task, and credits nobody.
`UNAVAILABLE` is retryable. Collapsing them is how a verifier ends up paying
out on a broken campaign.

---

## Request flow: a referral qualifying

Qualification is the exact moment the spec defines: started Fundxtra, created a
PIN, reached the dashboard. Completing a task is explicitly not required.

```
Friend opens the link  ─► POST /auth/telegram
                            ├─ user created
                            └─ attributeReferral → referrals/{friendId} PENDING

Friend creates a PIN   ─► POST /auth/pin

Friend loads dashboard ─► GET /auth/session
                            ├─ markOnboarded → transitioned? (once, ever)
                            └─ qualifyReferral
                                 runTransaction:
                                   referral → QUALIFIED
                                   referrer counters += 1
                                   ledger credit ₦100
                                   (idempotency key: referral__A__B)
```

Two independent guards make a double payment impossible: `markOnboarded`
reports whether *this* call was the transition, and the ledger's idempotency key
would refuse a second ₦100 even if it did not.

---

## Campaign budgets

`spentKobo` counts **approved completions plus pending submissions**. A
screenshot awaiting review already has a claim on the campaign; without that, an
admin could approve a queue that collectively exceeds the funded amount.

- Budget moves in the same transaction as the record that justifies it.
- A task closes itself (`COMPLETED`) the moment its remaining budget cannot fund
  another reward, or its completion cap is reached.
- Rejecting a submission releases the reservation, which can reactivate a task
  that had closed.
- `maxCompletions` is derived from budget ÷ reward, never accepted from the
  client, so the two cannot contradict each other.

A test races five users for a single funded reward: exactly one is paid, and the
total paid across all five equals one reward.

---

## The Fluid Lucid Glass navigation

The signature UI component, and the reason `/app` is a single route rather than
one route per tab: a route change would unmount the tab bar and restart its
springs, and the continuity of one moving lens is the whole effect.

- **One lens, not a cross-fade.** A single element whose `x` and `width` are
  both springs, so it visibly stretches while it travels.
- **Spring-driven, never duration-driven**, so the target can be re-aimed
  mid-flight — which is what lets it track a finger instead of playing an
  animation.
- **Glass in layers.** `backdrop-filter: blur() saturate() url(#…)` is invalid
  in Chromium and causes the *entire* property to be dropped, leaving no blur at
  all. The blur and the SVG displacement are therefore separate properties on a
  childless layer, so both apply and the icons above stay undistorted.
- **Tokens are inlined into `<head>`**, not imported as CSS, because Tailwind v4
  prunes custom properties it cannot see referenced and silently dropped two
  thirds of them — including the glass fill and blur.
- **Reduced motion** replaces the springs with instant positioning and disables
  the drag, leaving a plain, fully usable tab bar.

The admin console deliberately does *not* use it. The glass belongs to five
thumb-reachable sections on a phone; an operator working a review queue on a
laptop needs a list they can scan, and translucency over a data table makes
numbers harder to read.

---

## Provider abstraction

```
Reward service → RewardProvider → { none | mock | nasfampay }
```

`none` is the default and fails closed, so a misconfigured deployment cannot
take money for undeliverable rewards. `mock` simulates failure and pending
outcomes as well as success, because the reversal and reconciliation paths are
exactly the code that never gets tested when a mock always succeeds.
`nasfampay` is an honest, documented gap — see [PROVIDERS.md](PROVIDERS.md).

---

## Testing approach

145 tests, weighted towards the things that would cost real money.

An in-memory Firestore double (`apps/api/test/fake-firestore.ts`) implements the
semantics the financial guarantees depend on: `create()` fails on an existing
document, transactions buffer writes and commit atomically, reads are
version-tracked so a concurrent modification forces the same optimistic retry
the real SDK performs, and `FieldValue` sentinels are applied the way the
backend applies them.

That last property is what makes the concurrency tests meaningful rather than
decorative — `Promise.all` of two competing requests genuinely races.

The frontend is verified by driving the built app in a real browser with
Telegram and the API stubbed: the tab morph measured at 154px active vs 46px
collapsed, a drag from Profile committing to Home, arrow-key and End
navigation, and no horizontal overflow at 390px, 834px or 1280px. Four real
bugs were found that way which no amount of reading the source would have
surfaced.
