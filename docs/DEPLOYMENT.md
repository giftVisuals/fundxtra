# Deployment

Three services: Firebase (data), Railway (API), Vercel (frontend). Set them up
in that order — the API needs Firebase credentials, and the frontend needs the
API's URL.

---

## 1. Firebase

The project already exists: **fundxtra**.

### Deploy rules and indexes

```bash
npm install -g firebase-tools
firebase login
cd firebase
firebase deploy --project fundxtra --only firestore:rules,firestore:indexes,storage
```

The rules deny **all** client access except two narrow reads used by the public
marketing site (`counters/publicStats`, and published announcements whose
audience is PUBLIC or BOTH). That is deliberate: every mutation goes through the
API, which needs to guarantee things rules cannot express — atomic ledger
writes, idempotency, budget limits, rate limiting. A rule as innocuous as "a
user may update their own document" would let a client set its own balance.

Indexes take a few minutes to build. Until they finish, queries that need them
fail with a console link to create them — deploying them up front avoids that.

### Get the Admin SDK credentials

Firebase console → ⚙ **Project settings** → **Service accounts** →
**Generate new private key**. That downloads a JSON file. You need three fields
from it:

| JSON field | Environment variable |
| --- | --- |
| `project_id` | `FIREBASE_PROJECT_ID` |
| `client_email` | `FIREBASE_CLIENT_EMAIL` |
| `private_key` | `FIREBASE_PRIVATE_KEY` |

Keep the whole private key including the `-----BEGIN`/`-----END` lines. Railway
and Vercel store it with literal `\n` sequences; the API converts those back to
real newlines, so either form works.

**These credentials bypass every security rule.** They belong only in the API's
environment — never in the frontend, never in the repository.

### Enable Cloud Storage

Firebase console → **Storage** → get started, in the same region as Firestore.
The bucket is `fundxtra.firebasestorage.app`. Screenshot proofs go here through
the API; the bucket is never publicly readable.

---

## 2. Telegram

From [@BotFather](https://t.me/botfather):

1. `/newbot` (or use the existing Fundxtra bot) → copy the token into
   `TELEGRAM_BOT_TOKEN`. This token is what verifies Mini App signatures —
   without it the API cannot authenticate anyone. Treat it like a password.
2. `/setmenubutton` → point it at `https://fundxtra.name.ng/app`.
3. `/setdomain` → `fundxtra.name.ng`.

For each campaign that uses automatic membership verification, **add the bot to
the target channel or group and promote it to administrator.** Without
administrator rights `getChatMember` cannot read the member list, and the task
engine will record a configuration warning and refuse to credit anyone rather
than approving blind. The warning appears on the campaign row in the admin
console.

---

## 3. Railway (the API)

Create a project from this repository. `railway.json` and `nixpacks.toml` set
the build and start commands; the health check is `/health`.

### Variables

Railway → your service → **Variables**. Everything below is described in
`.env.example`, including where each value comes from.

```
NODE_ENV=production
LOG_LEVEL=info
CORS_ORIGINS=https://fundxtra.name.ng,https://fundxtra.vercel.app
SESSION_SECRET=            # openssl rand -base64 48
TELEGRAM_BOT_TOKEN=        # from @BotFather
TELEGRAM_BOT_USERNAME=fundxtrabot
FIREBASE_PROJECT_ID=fundxtra
FIREBASE_CLIENT_EMAIL=     # from the service account JSON
FIREBASE_PRIVATE_KEY=      # from the service account JSON
FIREBASE_STORAGE_BUCKET=fundxtra.firebasestorage.app
REWARD_PROVIDER=none
PRIMARY_ADMIN_TELEGRAM_ID=6438544386
PUBLIC_WEB_URL=https://fundxtra.name.ng
```

Do **not** set `PORT` — Railway injects it. Do **not** set `ALLOW_DEV_AUTH`.

### After the first deploy

```bash
curl https://<your-service>.up.railway.app/health
```

`ok: true` means everything is configured. `ok: false` lists exactly which
variables are missing in `missingConfiguration`, plus any `warnings` — such as
a mock reward provider or dev auth being enabled in production.

Then seed the reward catalogue and the primary admin record:

```bash
railway run npm run seed --workspace @fundxtra/api
```

### Keep it at one replica

`numReplicas` is 1 on purpose. Rate limits and the counters behind them are
per-process (`apps/api/src/lib/rate-limit.ts`), so N replicas multiply the
effective limits by N. Before scaling out, swap `MemoryRateLimiter` for a
Redis-backed implementation of the same interface — nothing else changes.

Persistent PIN lockout is *not* affected: that state lives in Firestore
precisely so a restart or a redeploy cannot hand an attacker fresh attempts.

---

## 4. Vercel (the frontend)

Import the repository. `vercel.json` sets the build command, output directory
and headers.

### Variables

Vercel → **Settings** → **Environment Variables**. Anything prefixed
`NEXT_PUBLIC_` is embedded in the browser bundle and is public — never put a
secret behind that prefix.

```
NEXT_PUBLIC_API_URL=https://<your-service>.up.railway.app
NEXT_PUBLIC_TELEGRAM_BOT=fundxtrabot
NEXT_PUBLIC_SUPPORT_HANDLE=@fundxtracarebot
NEXT_PUBLIC_SITE_URL=https://fundxtra.name.ng
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyCtBLHz9_rj9lSm2fDiJ-YUXvZPvkrjw1A
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=fundxtra.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=fundxtra
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=fundxtra.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=310281010469
NEXT_PUBLIC_FIREBASE_APP_ID=1:310281010469:web:90139ba733388546afaecc
```

Once the API URL is known, add the Vercel domain to `CORS_ORIGINS` on Railway
and redeploy the API — otherwise every browser request is rejected.

### Custom domain

Vercel → **Settings** → **Domains** → add `fundxtra.name.ng`, then point the
DNS records Vercel shows you at it. Vercel provisions HTTPS automatically.

Then, in order:

1. Add `https://fundxtra.name.ng` to `CORS_ORIGINS` on Railway.
2. Set `NEXT_PUBLIC_SITE_URL=https://fundxtra.name.ng`.
3. Update the bot's menu button and `/setdomain` in BotFather.

The Mini App is framed by Telegram, so `vercel.json` sets a
`frame-ancestors` CSP that permits Telegram's clients rather than
`X-Frame-Options: DENY` — which would stop the Mini App loading at all. `/app`
and `/admin` also carry `X-Robots-Tag: noindex`.

---

## 5. Verify the deployment

- [ ] `GET /health` returns `ok: true` with no warnings
- [ ] `GET /public/config` returns the brand and pricing
- [ ] `GET /public/stats` returns `sufficientData: false` on a new platform —
      this is correct, and the site shows an early-stage state rather than
      fabricated numbers
- [ ] The landing page loads at the custom domain with no console errors
- [ ] Opening the bot's menu button loads the Mini App and asks for a PIN
- [ ] Creating a PIN reaches the dashboard
- [ ] `/admin` opens for Telegram id 6438544386 and refuses everyone else
- [ ] A referral link qualifies and pays ₦100 after the friend sets a PIN
- [ ] A screenshot task queues for review and credits only on approval
- [ ] Toggling the withdrawal portal changes what the wallet shows

---

## Going live safely

Fundxtra ships **fail-closed**: withdrawals and every reward method start
switched off. That is intentional — a money path should open deliberately, not
by default. To open for business:

1. Create campaigns in the admin console. They are created as drafts; check
   them, then activate.
2. Open the withdrawal portal in **Settings**, with a specific maintenance
   message for when it closes again ("Opens Friday at 9am" beats "temporarily
   unavailable").
3. Leave the reward switches off until a fulfilment provider is live. The
   catalogue shows real prices marked "coming soon", and no balance can be
   spent on something that cannot be delivered.
4. Post an announcement so users know what is available.

### Rotating a leaked secret

- `SESSION_SECRET` — change it on Railway. Every active session is invalidated
  and users re-authenticate through Telegram automatically.
- `TELEGRAM_BOT_TOKEN` — revoke via BotFather (`/revoke`), set the new token.
  Existing JWTs stay valid until they expire; rotate `SESSION_SECRET` too if
  you want them gone immediately.
- Firebase service account — delete the key in the Firebase console, generate a
  new one, update Railway.
