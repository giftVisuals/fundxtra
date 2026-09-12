# Security

Fundxtra holds balances that convert to real money, so this document states
what each defence is actually for — and, where a defence is structural rather
than a runtime check, why that distinction matters.

---

## The one sentence version

The client is never trusted with anything: not the balance, not task
completion, not referral qualification, not admin status, not the reward price.
Every one of those is decided server-side, and the important ones are decided
inside a Firestore transaction.

---

## Identity

**Telegram `initData`, verified server-side.** The documented HMAC scheme:
`secret = HMAC_SHA256("WebAppData", bot_token)`, then the hash over the sorted
data-check string. Note the inversion — the constant is the *key* and the token
is the *message*. Getting that backwards is the classic implementation bug and
produces a verifier that rejects every legitimate request.

The user object supplied by the client is never read until the signature over
the whole payload validates. Tests cover a tampered user id, an appended
unsigned field, a foreign bot token, and the replay window
(`apps/api/src/lib/telegram-auth.test.ts`).

**The user document id is the Telegram id.** This makes "one account per
Telegram identity" a property of the schema rather than a rule to enforce, and
`create()` on a deterministically-named document means two simultaneous
first-opens cannot produce two users.

**Sessions carry no authority.** The JWT holds the user id, the username and a
`pinVerified` flag — nothing else. Admin status and balance are re-read from
Firestore on every request, so a stolen or forged token cannot assert "I am an
admin" or "I have money", and revoking an admin takes effect on their next
request rather than when their session happens to expire.

---

## The PIN

A 4-digit PIN has 10,000 possible values, so the hash must be slow enough that
an attacker with the database cannot simply enumerate them.

- **scrypt at N=2¹⁵**, roughly 145ms per attempt, with a 16-byte per-user salt.
  A full sweep of the keyspace becomes hours per user, and the salt means that
  work cannot be shared across users.
- **Parameters are encoded in the hash** (`scrypt$N$r$p$salt$hash`) and upgraded
  opportunistically on the next successful sign-in.
- **Hashes live in `pins/{userId}`**, a separate collection from `users`,
  specifically so that no profile query, admin listing or export can carry PIN
  material with it.
- **Lockout is persisted in Firestore**, not held in memory: a restart or a
  redeploy must not hand an attacker a fresh set of attempts. Five failures
  locks the account for 15 minutes, and a locked account is refused *without*
  the hash being compared, so lockout costs the attacker the full wait.
- **Malformed or cost-downgraded hashes fail closed.** A tampered record with
  `N=1024` is rejected rather than verified cheaply.
- **Nothing logs a PIN.** The logger redacts `pin`, `currentPin`, `newPin`,
  `confirmPin`, `pinHash`, `initData` and every secret by path, so a stray
  `logger.info({ body })` cannot leak one.
- **An admin reset deletes the hash** rather than setting a known value, so no
  administrator ever learns a user's PIN.

Money-moving endpoints require the PIN **in the request body**, not just a
PIN-verified session. The session flag proves the user unlocked the app at some
point; the body PIN proves the person authorising *this* payment is present —
which is what matters if a phone is handed over unlocked.

---

## Money

**Balances only move inside a Firestore transaction that also writes the
immutable ledger row.** The cached `balanceKobo` and the ledger therefore cannot
disagree.

**Idempotency keys are written with `create()` inside that same transaction.**
Firestore fails a `create()` on an existing document, so a retried request — a
double tap, a network retry, a webhook redelivery — reuses the original entry.
This is the whole double-credit defence, and it is enforced by the database
rather than by a check-then-act read that a concurrent request could slip
between. `test/ledger.test.ts` covers both the sequential retry and a genuine
race.

**Task rewards additionally require creating `taskCompletions/{userId}__{taskId}`
in the same transaction.** The id is derived from the pair, so a second attempt
fails and rolls back the credit with it.

**Corrections are compensating `REVERSAL` rows, never edits.** Every row in the
ledger moved the balance when it was written; a correction adds a row rather
than changing one. `auditUserBalance()` recomputes from the ledger and reports
disagreement — it is exposed to admins, and a mismatch is shown in red with
"investigate before adjusting".

**Withdrawals debit on request.** A pending withdrawal is money already taken
from the spendable balance. Leaving the balance intact until payout would let a
user request their full balance three times over.

**Redemptions debit, then call the provider, then settle.** `FAILED` reverses
immediately; `PENDING` stays pending. Those two are kept strictly distinct
because reversing an uncertain outcome gives the user both the refund and the
airtime.

**Prices come from the catalogue, never the request.** A test sends ₦1 for a
₦2,400 Stars bundle and is charged ₦2,400.

**The ₦1,000 per-task cap is enforced in the service.** The admin form shows it;
the server is what applies it.

---

## Authorisation

Every admin route declares the **permission** it needs; no handler compares a
role string. Adding a role or moving a capability is one edit in
`packages/shared/src/permissions.ts` rather than an audit of every handler.

- **Super-admin-only permissions** (`admins:manage`, `settings:manage`,
  `finance:manage`) are filtered out of any extra grant to a lower role — in
  the shared helper *and* again when the admin record is written.
- **The primary admin (6438544386) is synthesised in code**, not read from the
  database, so the platform cannot lock itself out of its own admin panel.
  Their record cannot be modified or removed, and no admin can remove
  themselves.
- **Usernames are never an identity.** Adding an admin by username creates a
  *pending invite* claimed the first time that handle signs in. Telegram
  usernames can be given up and claimed by someone else; treating one as an
  identity would be a privilege-escalation path.

`test/api.test.ts` walks all nine admin routes unauthenticated (401), as an
ordinary user (403) and as the primary admin (200), and asserts that a
moderator attempting a balance adjustment gets 403 with the victim's balance
unchanged, and that `extraPermissions: ['admins:manage', …]` is stored as `[]`.

---

## Firestore and Storage rules

**No client writes, anywhere.** Every mutation goes through the API, which holds
Admin SDK credentials and bypasses rules entirely. That is the point: the
backend guarantees things rules cannot express. A rule as innocuous as "a user
may update their own document" would let a client set its own `balanceKobo`.

Reads are equally closed, with two narrow exceptions for the marketing site:
`counters/publicStats` (aggregate totals, no user data) and published
announcements whose audience is PUBLIC or BOTH. Users, PIN hashes,
transactions, withdrawals, submissions, admins and audit logs are unreachable
from any client.

Storage denies both read and write. Proofs are uploaded through the API and
shown to admins through short-lived signed URLs, so the bucket is never
publicly readable and a link cannot be forwarded indefinitely.

---

## Uploads

- Validated by **magic bytes**, not the client's `Content-Type`. Only PNG, JPEG
  and WebP signatures are accepted.
- Size capped at 5MB, empty files rejected.
- The storage path is **derived server-side** from the user, the task and the
  clock, so a user cannot choose where their file lands or overwrite someone
  else's proof.
- Signing refuses any path outside the proofs prefix, so a crafted path cannot
  be turned into a read of arbitrary bucket contents.

---

## Abuse prevention

Flags and risk scores queue accounts for **human review**; nothing auto-bans. A
genuinely popular referrer and a referral farm look identical at this
resolution, and blocking the wrong one is worse than flagging both.

| Signal | Response |
| --- | --- |
| Self-referral | Refused outright, flagged, security event |
| Duplicate referral attribution | Structurally impossible (document id) |
| Referral velocity (15+ qualified in an hour) | Flagged, +20 risk |
| Task completed faster than the dwell minimum | Flagged, +8 risk; not blocked |
| Withdrawal of nearly all lifetime earnings within hours of signup | Flagged |
| Repeated failed PINs | Persistent lockout, security event |

Rate limits are per user id where a session exists, falling back to IP. That
ordering matters for a Nigerian mobile-first product: many users share a
carrier egress IP, so IP-only limiting would let one abusive account exhaust
the budget for everyone behind the same NAT.

**Limits are per process.** The API runs at one replica for this reason; see
`docs/DEPLOYMENT.md`.

---

## Audit trail

Two records, answering different questions.

**Audit log** — "who changed this, and why". Append-only and attributed. For
financial actions the write is **awaited and allowed to throw**, so the record
is a precondition of the change rather than a side effect: an unrecorded
balance adjustment is worse than a failed one. Balance adjustments require a
reason of at least 8 characters and record before/after.

**Security events** — "what is happening to accounts". Failed PINs, blocked
self-referrals, rate limits, forbidden access attempts. Best-effort on purpose:
a logging failure must never turn a rejected login into a successful one.

---

## Errors

Users see stable, friendly copy from a shared error table plus a request id
they can quote to support. Diagnostic detail goes to the log and is attached to
a response only for authenticated admins. That split is what keeps raw backend
errors off users' screens without blinding operators.

---

## Secrets

Nothing is hardcoded. `.env.example` documents, for every variable, what it is,
where to obtain it and where it goes on Railway and Vercel. `.env` is
gitignored, as are service-account JSON files. The environment is validated at
boot, and `/health` reports which variables are missing rather than crash-looping.

`ALLOW_DEV_AUTH` is fenced four ways: the flag must be on, `NODE_ENV` must not
be production, no bot token may be configured, and it refuses to mint the
primary admin's id. `/health` and the admin console both warn loudly if it is
ever enabled in production.

---

## Known limits

Stated plainly rather than left to be discovered.

- **Rate limits are per process**, so horizontal scaling multiplies them. Swap
  `MemoryRateLimiter` for a Redis-backed implementation of the same interface
  before scaling out.
- **Admin search is exact-match** on Telegram id, username or referral code.
  Firestore has no substring index, and a search box that silently returns
  nothing for a partial name is worse than one that states what it matches.
- **Account-name verification for withdrawals is not implemented**, because no
  payout provider has been selected. The user enters the name and the form says
  it must match.
- **No 2FA beyond the PIN.** Telegram account security is the outer layer, and
  that is the user's own Telegram 2FA.
- **Statistics are maintained incrementally** with `FieldValue.increment` and
  are fire-and-forget, so a missed update is possible. `recomputeStats()`
  rebuilds them from source collections; it is admin-triggered rather than
  scheduled because it scans whole collections.
