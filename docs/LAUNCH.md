# Before you step back

Everything here needs the owner. None of it can be done in code, and each item
is something that hurts later if it is skipped.

Work top to bottom. The first four are the ones that matter.

---

## 1. Turn on database backups

**Firebase console → Firestore → Backups → Create schedule.** Daily, retained
for 7 days or more. Also switch on **point-in-time recovery** in the same
place.

Your Firestore database is the record of every naira earned, every naira owed,
and every payout. It currently exists in exactly one place. If it is lost or
corrupted, there is no version of this platform that survives it — you would
not know who to pay or how much.

This is five minutes and it is the most important item on the page.

---

## 2. Set the payout ceiling

**Admin console → Settings → Whole-platform payout ceiling per day.**

This is the stop button. Once the total paid out across everyone reaches it in
a day, nothing more can be marked paid until tomorrow. It exists because
somebody else now has the power to send money.

Set it to **roughly twice what you expect a normal day to cost**. If you expect
₦20,000 a day, set ₦40,000. Too tight and you will be unblocking it constantly;
too loose and it is not a stop button.

Only you can change it. Your operations hire cannot, and that is the point.

---

## 3. Tighten the limits for a quiet period

Also in **Settings**, while you are not watching closely:

- **Daily limit per user** — currently ₦200,000. That is a number for a
  platform you are checking hourly. Something like ₦5,000 is saner for a first
  few weeks.
- **Maximum per request** — same reasoning.

You can raise both in seconds once things are proven. Starting loose and
tightening after something goes wrong is the wrong order.

---

## 4. Add your operations person

**Admin console → Admins → Add admin**, with their Telegram username.

Give them **Admin**, not Moderator. A Moderator can review screenshots but
cannot mark a withdrawal paid, so if they are handling payouts, Moderator will
leave them stuck. Admin still cannot change settings, fees, limits, or add
other admins.

Then send them `docs/OPERATIONS.md`. Do not explain it verbally instead —
they will need to re-read it in week three when something unusual happens.

---

## 5. Prove one withdrawal end to end, with your own money

Before anyone else is invited:

1. Complete a task on your own account, or add yourself a small balance.
2. Request a withdrawal of the minimum.
3. Pay it from your bank, mark it paid with the reference.
4. Check the bot sent you the confirmation, and that the receipt opens.

If any step surprises you, it will surprise a user, and they will be far less
patient than you.

---

## 6. Buy the domain

`fundxtra.name.ng` is printed on every receipt and rides along in the share
text when someone shares one. Right now it does not resolve.

Buy it, then add it in **Vercel → Project → Settings → Domains** and follow
the DNS records Vercel gives you. Then set `PUBLIC_WEB_URL` on Railway to the
new address, and add the same address to `CORS_ORIGINS`.

Until that is done, every receipt points somewhere dead. It is not urgent for
five test users. It is embarrassing at five hundred.

---

## 7. Check the money you are about to owe

Not a settings screen — a decision.

Every naira a user earns is a naira you owe them in cash. Sponsored campaigns
are supposed to fund that. Until you have sponsors actually paying, every
payout comes from your own pocket.

Before you advertise, answer honestly: **if 200 people each earn ₦500 this
week, can you pay ₦100,000?** If not, lower the task rewards or cap the
campaign budgets so the platform cannot promise more than you can honour.

The one thing that kills a platform like this permanently is not paying
someone. Everything else is recoverable.

---

## While you are away

The bot sends you a brief every morning: what is waiting, what was paid
yesterday, what you owe users. If your operations person goes quiet, you also
get a separate alert when work has been sitting untouched.

You do not need to open anything. Read the morning message. If it says nothing
is waiting, nothing is waiting.

To see it on demand rather than waiting for the morning, an admin call to
`POST /admin/maintenance/brief` sends it immediately.
