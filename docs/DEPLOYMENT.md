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
**Generate new private key**. That downloads a JSON file.

Paste the **entire file** — from the opening `{` to the closing `}` — as one
variable on Railway:

```
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"fundxtra",...}
```

One variable, one paste. The split form (`FIREBASE_CLIENT_EMAIL` +
`FIREBASE_PRIVATE_KEY`) still works and takes second place when both are set,
but prefer the single variable: a multi-line PEM key pasted into a dashboard
field is the most common way this deploy breaks. Base64 of the same JSON is
accepted too, for a form that rewrites newlines.

Parsing is strict and every failure is reported on `/health` with its reason —
truncated paste, missing `client_email`, a `private_key` that is not a PEM key.
A credential that is present but unusable is worse than an absent one, because
without a reason the deploy looks configured while every request fails, so it is
never reported as merely "missing".

**These credentials bypass every security rule.** They belong only in the API's
environment — never in the frontend, never in the repository.

### Cloud Storage is not needed

Screenshot proofs go to imgbb, not to Firebase. That is one fewer thing to
switch on, and it is why `IMGBB_API_KEY` appears in the Railway variables
below. See **Screenshot proofs** at the end of this document for what that
choice costs.

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

The live service is **https://fundxtra.up.railway.app**, listening on port
8080. That origin is also baked into `apps/web/lib/config.ts`, so changing the
Railway domain means changing it there too.

Create a project from this repository. `nixpacks.toml` owns install, build and
start; `railway.json` sets only the builder, the health check and the restart
policy. Do not add a `buildCommand` to `railway.json`: it replaces the build
phase but runs *after* install, so a command beginning with `npm ci` tries to
delete a `node_modules` that Railway has mounted as a build cache and the
deploy fails with `EBUSY / rmdir / errno -16`.

Two probes, deliberately different:

- `GET /health` — liveness. Always 200 while the process is up, with
  `ready` and `missingConfiguration` in the body. Railway's health check
  points here, so a first deploy goes live and *tells you* what to set
  instead of crash-looping with the answer unreachable.
- `GET /ready` — readiness. 503 until every required secret is present. Use
  this one for a real dependency probe.

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
FIREBASE_SERVICE_ACCOUNT=  # the whole service-account JSON, one paste
FIREBASE_PROJECT_ID=fundxtra
IMGBB_API_KEY=           # from https://api.imgbb.com/ → Get API key
REWARD_PROVIDER=none
PRIMARY_ADMIN_TELEGRAM_ID=6438544386
PUBLIC_WEB_URL=https://fundxtra.vercel.app
```

Do **not** set `PORT` — Railway injects it. Do **not** set `ALLOW_DEV_AUTH`.

### After the first deploy

```bash
curl https://fundxtra.up.railway.app/health
```

`ready: true` means everything is configured. `ready: false` lists exactly what
is unset — or, for a credential that is set but unusable, what is wrong with it
— in `missingConfiguration`, plus any `warnings` such as a mock reward provider
or dev auth being enabled in production. The response is 200 either way, by
design: see the probe note above.

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

Two Root Directory settings are valid, because Vercel's import wizard picks a
folder *before* the screen that shows the framework preset, and Vercel's mobile
dashboard hides the setting needed to change it afterwards:

| Root Directory | Config used | Works |
| --- | --- | --- |
| *(empty — repository root)* | `vercel.json` | yes |
| `apps/web` | `apps/web/vercel.json` | yes |
| `apps/api` | — | **no** — that is the backend, it runs on Railway |

The wizard defaults to `apps/api` (Express, alphabetically first). Both valid
configs build the same thing; `apps/web/vercel.json` reaches back to the
repository root to install the workspace and build `@fundxtra/shared` first.
Keep them in step — a header added to one belongs in the other.

Import the repository. Vercel hosts **only the frontend** (`apps/web`); the API
lives on Railway. Leave **Root Directory** at the repository root and the preset
at **Next.js** — `vercel.json` is at the root and already points the build at
`apps/web`. Pointing a Vercel project at `apps/api` with the Express preset
cannot work: the API is a long-running Express server with in-process rate
limiting, not a set of serverless functions.

`next` is declared at the **repository root** as well as in `apps/web`, at the
same exact version. Vercel resolves the framework from the Root Directory's
`package.json`, and npm only hoists `next` to the root `node_modules` for a
`^16.3.x` range — every 16.2.x specifier, caret, tilde or exact, nests it under
`apps/web/node_modules` instead. Vercel then fails with `No Next.js version
detected` before running the build at all. Declaring it at the root pins the
hoist. `eslint-config-next` is held at the same version so the lint config
matches the framework it lints.

`next` is pinned to an exact `16.2.12`, not a caret range. Next 16.3 uploads
static files immutably, and Vercel's deploy step then fails *after* a completely
successful build with `Cannot patch preview comments when immutable static file
upload is enabled. Upgrade to next@v16.3.0-canary.32 or newer` — advice that
cannot be followed, since 16.3.5 is already newer than the canary it names. The
build artifacts were fine; only the upload was refused. 16.2.12 is the last
release before that feature. Revisit the pin once Vercel and Next agree, and
change it only after a real deploy proves the newer version uploads.

Both configs install with `npm ci --include=dev`. Vercel runs the build with
`NODE_ENV=production`, and npm then omits devDependencies — where `tailwindcss`,
`@tailwindcss/postcss` and `typescript` live. Without the flag the install
succeeds with 315 of 710 packages and the build dies inside PostCSS on
`globals.css`, which reads as a CSS problem rather than a missing dependency.
Same failure mode as the Railway build; see `nixpacks.toml`.

`vercel.json` sets the build command, output directory and headers. Note that
none of its objects may carry extra keys — Vercel validates the file against a
strict schema and rejects an unknown property (including a `comment` key used
to annotate a header) with `Invalid request: ... should NOT have additional
property`. Explanations therefore live here rather than in the file.

`/app` and `/admin` are served with `Content-Security-Policy: frame-ancestors`
limited to Telegram's own origins rather than `X-Frame-Options: DENY`, because
the Mini App is loaded inside a Telegram WebView and must be framable by
Telegram — and by nothing else. Both the exact paths and their subtrees are
listed, so a future nested route cannot quietly ship without the header.

### Variables

**None.** The frontend reads no environment variables in production.

Every value it needs is public by nature — the API origin, the bot handle, the
support handle, the site URL — and all of them are committed in
`apps/web/lib/config.ts`. Two consequences, both wanted: a Vercel deploy cannot
break because someone forgot a variable, and there is no dashboard field that
could tempt a secret into the browser bundle. Every real secret lives on the
API, which is the only place one can be used safely.

To change the API origin or the bot handle, edit `apps/web/lib/config.ts` and
push. `NEXT_PUBLIC_*` overrides are still honoured in a local `.env` for
pointing a dev site at a different API.

The Firebase web SDK is not used at all — every read goes through the API — so
there is no `NEXT_PUBLIC_FIREBASE_*` configuration and the `firebase` client
dependency has been removed.

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

## 4b. The Telegram bot

Nothing to configure by hand. On boot the API calls the Bot API to:

1. `getMe` — confirm the token works, and log the bot's username.
2. `setMyCommands` — populate `/start`, `/help`, `/support` in the chat menu.
3. `setChatMenuButton` — point the button beside the message box at
   `PUBLIC_WEB_URL/app`.
4. `setWebhook` — register `<api origin>/telegram/webhook`, with a
   `secret_token`.

The API origin comes from `PUBLIC_API_URL` or, on Railway, the injected
`RAILWAY_PUBLIC_DOMAIN`. Every step is best-effort and non-fatal: the Mini App
authenticates through signed `initData` and does not depend on any of it. If
the webhook cannot be registered, `/start` goes unanswered and the log says so
at error level in production, because a silent bot means every referral link
opens an empty chat.

**Why the webhook is not optional.** A referral link is
`t.me/<bot>?start=<code>`, which opens a chat, not the Mini App. The bot's
reply is what carries the invited friend to the app, with the code on the
button's URL as `?ref=`.

**Authentication.** Telegram echoes the `secret_token` in
`X-Telegram-Bot-Api-Secret-Token`, and the route compares it in constant time
and refuses anything else — a forged `/start` would otherwise let anyone submit
a referral code. The secret is derived from `SESSION_SECRET` unless
`TELEGRAM_WEBHOOK_SECRET` is set, so it needs no variable of its own; rotating
`SESSION_SECRET` rotates it, and the next boot re-registers.

Check it with `getWebhookInfo`:

```
https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

`url` should be your API's webhook and `last_error_message` absent.

---

## 5. Verify the deployment

- [ ] `GET /health` returns `ready: true` with no warnings
- [ ] `GET /ready` returns 200
- [ ] `GET /public/config` returns the brand and pricing
- [ ] `GET /public/stats` returns `sufficientData: false` on a new platform —
      this is correct, and the site shows an early-stage state rather than
      fabricated numbers
- [ ] The landing page loads at the custom domain with no console errors
- [ ] `/start` in the bot replies with an "Open Fundxtra" button
- [ ] Opening the bot's menu button loads the Mini App and asks for a PIN
- [ ] A `t.me/<bot>?start=<code>` link replies and the button URL carries `?ref=`
- [ ] Creating a PIN reaches the dashboard
- [ ] `/admin` opens for Telegram id 6438544386 and refuses everyone else
- [ ] A referral link qualifies and pays ₦100 after the friend sets a PIN
- [ ] A screenshot task queues for review and credits only on approval
- [ ] Toggling the withdrawal portal changes what the wallet shows

---

## Backups

**Firebase console → Firestore → Backups → Create schedule.** Daily, retained a
week or more, and switch on point-in-time recovery in the same place.

Firestore holds the ledger: every naira earned, owed and paid. It exists in one
place until this is turned on, and there is no version of the platform that
survives losing it — you would not know who to pay or how much. It is five
minutes and it is not optional before real users arrive.

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

---

## Screenshot proofs

Tasks verified by a person ask the user for a screenshot. Those images are
uploaded through the API to **imgbb**, which needs one key and no console
setup — set `IMGBB_API_KEY` on Railway and screenshot tasks work.

What that choice costs, stated plainly:

- **An imgbb link is public.** Anyone who has the URL can open the image
  without signing in. The URLs are long random strings, and the only place one
  is ever shown is the admin screen reviewing that submission — but they are
  not access-controlled, and a screenshot can show more of someone's phone
  than they intended.
- **Uploads expire.** `IMGBB_EXPIRATION_SECONDS` defaults to 180 days, imgbb's
  maximum, so a proof outlives any realistic payout dispute and then goes away
  on its own. Expiry is the only thing that removes an upload: imgbb's delete
  link is a web page a person visits, not an endpoint, so nothing in the API
  can delete one for you.
- **The key never leaves the server.** The browser uploads to our API, which
  checks the file's actual magic bytes and then forwards it. The key travels in
  the request body rather than the query string, so it cannot be captured in a
  proxy or access log.

If that trade is ever not acceptable — carrying identity documents, say —
private object storage with signed URLs is the thing to move to, and
`services/uploads.ts` is the only file that would change.
