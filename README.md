# Fundxtra

A Telegram-first rewards platform. Users complete sponsored tasks, earn Naira,
refer friends, and withdraw as cash or redeem for airtime, data, Telegram Stars
and Telegram Premium.

**Complete tasks. Earn rewards. Refer friends.**

- Public site: [fundxtra.name.ng](https://fundxtra.name.ng)
- Mini App: `/app` (opened from the Telegram bot)
- Admin console: `/admin`
- Support: [@fundxtracarebot](https://t.me/fundxtracarebot)

---

## What is in this repository

```
fundxtra/
├─ apps/
│  ├─ api/            Express + TypeScript backend  → Railway
│  └─ web/            Next.js frontend              → Vercel
│     ├─ app/(marketing)/   public website
│     ├─ app/app/           Telegram Mini App
│     └─ app/admin/         admin console
├─ packages/
│  └─ shared/         types, zod schemas, design tokens, money helpers
├─ firebase/          Firestore rules, indexes, Storage rules
└─ docs/              launch, operations, architecture, data model, security, deployment
```

One shared package is the reason the three surfaces agree with each other: the
API and both frontends compile against the same domain types, validate with the
same zod schemas, and read colour from the same tokens.

---

## Quick start

```bash
npm ci
cp .env.example .env          # then fill it in — see the file's own notes
npm run build:shared          # the API and web app compile against this

npm run dev:api               # http://localhost:8080
npm run dev:web               # http://localhost:3000
```

`GET http://localhost:8080/health` reports exactly which configuration is
missing, so a half-configured environment tells you what to fix rather than
failing at the first request that needs a secret.

### Working on the UI without a bot token

Set `ALLOW_DEV_AUTH=true` and send `initData` as `dev:<telegramId>:<name>:<username>`.
It is fenced three ways: the flag must be on, `NODE_ENV` must not be
production, no bot token may be configured, and it refuses to mint the primary
admin's id. `/health` warns loudly if it is ever enabled in production.

### Seeding

```bash
npm run seed --workspace @fundxtra/api
```

Creates settings, the primary admin, the reward catalogue and five campaigns
across every verification method. It refuses to run against production, and it
goes through the real services — so the ₦1,000 per-task cap applies to demo
data too.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Build shared, then the API and the web app |
| `npm test` | 145 tests across the shared package and the API |
| `npm run typecheck` | Strict TypeScript across every workspace |
| `npm run lint` | ESLint on the web app |
| `npm run seed` | Seed development data |

---

## The parts worth knowing about

**Money is integer kobo, everywhere.** Naira floats are never stored, summed or
compared. `formatNaira()` in the shared package is the only thing that turns an
amount into text. See `packages/shared/src/money.ts`.

**The ledger is authoritative; the balance is a cache.** A balance never moves
outside a Firestore transaction that also writes the immutable ledger row, and
every movement carries an idempotency key written with `create()` inside that
same transaction — so a retry or a genuine race reuses the original entry
rather than paying twice. Corrections are compensating `REVERSAL` rows, never
edits. `auditUserBalance()` recomputes from the ledger and is exposed to admins
for dispute investigation.

**Telegram identity is the primary key.** The user document id *is* the Telegram
id, which makes "one account per Telegram user" structural rather than enforced.
`initData` is verified server-side with the documented HMAC scheme before the
user object inside it is read at all.

**Duplicate rewards are impossible by construction.** A task reward is only ever
credited by a transaction that also creates `taskCompletions/{userId}__{taskId}`.
The id is derived from the pair, so a second `create()` fails and rolls the
credit back with it.

**Campaign budgets cannot overspend.** `spentKobo` counts approved completions
*plus* pending submissions, budget moves in the same transaction as the record
that justifies it, and a task closes itself when it can no longer fund another
reward. A test races five users for one funded reward: exactly one is paid.

**Reward fulfilment is behind a provider interface.** NasfamPay's public API is
still in development, so `NasfamPayProvider` contains no endpoints, no auth
scheme and no request bodies — only a precise description of what to implement
when the documentation lands. The default provider fails closed so a
misconfigured deployment cannot take money for undeliverable rewards.

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/LAUNCH.md](docs/LAUNCH.md) | **Owner:** what to do before going live or stepping back |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | **Daily work:** hand this to whoever reviews and pays |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit, and why |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Every collection, field and invariant |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model and what defends against what |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Railway, Vercel, Firebase, custom domain |
| [docs/PROVIDERS.md](docs/PROVIDERS.md) | Wiring NasfamPay when their API ships |

---

## Status

Built and working:

- Telegram authentication, PIN security with persistent lockout, sessions
- Atomic idempotent ledger, transaction history, balance audit
- Task marketplace with campaign budgets, three verification methods,
  screenshot review
- ₦100 qualified referrals with self-referral and duplicate protection
- Cash withdrawals with a schedulable portal, limits and reversal on failure
- Reward catalogue, priced and honest about what is not yet deliverable
- Admin console: users, review queue, withdrawals, campaigns, settings,
  admins, audit log
- Public marketing site with live statistics and an honest early-stage state

Waiting on an external dependency:

- Airtime, data, Stars and Premium **delivery**. Priced, catalogued and
  switchable, but the fulfilment provider's API does not exist yet. See
  [docs/PROVIDERS.md](docs/PROVIDERS.md).
- A **cash payout provider**. Withdrawals are tracked end to end and settled by
  an operator recording the bank reference, which is how this would be run on
  day one regardless.
