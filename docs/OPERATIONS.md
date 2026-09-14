# Running Fundxtra day to day

This is for the person handling Fundxtra's daily work. You do not need to
understand the code, and nothing here asks you to.

Your job is one loop, twice a day:

1. Review the screenshots people send as proof they did a task.
2. Pay the withdrawals people have requested, and mark them paid.

That loop is the whole platform from a user's point of view. Everything else
runs itself. **If the loop stops, people do not get paid — and a rewards
platform that stops paying does not recover.** It is better to do it briefly
twice a day than thoroughly once a week.

---

## Getting in

Open the admin console at the address the owner gave you, signed in as
yourself through Telegram. If it says you are not an admin, the owner has not
added you yet — ask them, and do not try again in a different browser.

You will have the **Admin** role. That means you can do everything in this
document and nothing else. You cannot change fees, limits or settings, and you
cannot add other admins. That is deliberate and it is not about trust: it means
no mistake you make can be an expensive one.

---

## Part 1 — Screenshots

**Admin console → Submissions.**

Each row is one person claiming they completed a task. You will see the task,
the reward, who sent it, and their screenshot.

### Approve when

The screenshot plainly shows the task was done. If the task says "follow
Crediplex on X", the screenshot shows the Crediplex profile with Following on
it.

Tap **Approve and credit ₦X**. The money goes to their balance immediately and
the bot tells them.

### Reject when

- The screenshot shows something else entirely, or a different account.
- It is obviously edited, or a screenshot of someone else's screen.
- It is unreadable — too dark, too cropped, cut off.
- It is the same screenshot someone else already sent.

**A rejection reason is required, and the user reads it.** Write the actual
reason in plain words:

> "This shows the profile but not that you are following. Please send the
> screenshot after tapping Follow."

Not "rejected", not "invalid". A person is reading it and will try again if
they know what to fix. Nothing is deducted from them when you reject, and the
bot tells them that too.

### When you are not sure

Approve it. A ₦50 mistake in a user's favour costs ₦50. A wrong rejection costs
you a user who tells other people Fundxtra does not pay. If the same person
keeps sending doubtful screenshots, tell the owner rather than fighting them
one at a time.

### If someone is clearly cheating

Do not ban them. Note the username and tell the owner. Users are the owner's
call, not yours.

---

## Part 2 — Withdrawals

**Admin console → Withdrawals.**

Each row is someone asking for their money in their bank account. The money has
**already left their Fundxtra balance** — they cannot spend it twice, and you
are not racing anybody.

### Paying one

1. Read the row: **amount**, **bank**, **account number**, **account name**.
2. Open your banking app and send exactly that amount to that account.
3. **Check the name your bank shows matches the name on the row.** If the bank
   says a different name, stop. Do not send. Tap **Reject** with the reason
   "The account name does not match" — the money goes straight back to their
   Fundxtra balance and they can fix their details and try again.
4. Once the transfer has gone through, come back and tap **Mark paid**, and put
   your bank's transaction reference in the box.

**Mark paid means "I have sent the money."** Nothing else in the system sends
it. If you mark it paid without sending, the user is owed money nobody knows
about. If you send it and forget to mark it paid, you will probably send it
twice tomorrow. Do both, in that order, one at a time.

### Rejecting one

Same as screenshots: the reason is required and the user reads it. The money
returns to their balance automatically — say so in your reason, because the
first thing anyone thinks when a payout is refused is that their money is gone.

### If the transfer fails at your bank

Tap **Failed**, reason "The bank transfer did not go through." The money goes
back to their balance. They can request it again.

---

## Part 3 — The daily check

Twice a day, morning and evening:

- **Submissions** — anything waiting? Clear it.
- **Withdrawals** — anything pending? Pay it.
- **Dashboard** — does anything look strange? A day with ten times the usual
  withdrawals, a sudden pile of new users, a user withdrawing over and over.
  Strange is not your problem to solve. It is your problem to *report*.

The owner gets an automatic message every morning with what is waiting. If you
have cleared the queue, their message says nothing is waiting, and that is the
best thing they can read.

---

## If the owner closes the platform

There is a **Maintenance mode** switch in Settings. It is the owner's switch,
not yours — but you should know what it does, because users will ask.

While it is on:

- Every user sees one screen saying Fundxtra is being updated, with the
  owner's message on it. No dashboard, no balance, no tasks.
- Nobody can complete a task, submit a screenshot, or request a withdrawal.
- The bot answers `/start` and everything else with the same message and a
  support button. It does not offer to open the app.
- **You keep working.** The admin console is not locked, so screenshots and
  withdrawals can still be reviewed and paid during the outage.

If a user messages you while it is on, the true answer is short: the platform
is being updated, their balance is safe, nothing is lost, and tasks will be
there when it reopens. Do not guess at a reopening time — ask the owner.

---

## What to never do

- **Never mark a withdrawal paid before the transfer has actually left.**
- **Never approve a screenshot you cannot actually see.**
- **Never reject without a reason a person can act on.**
- **Never share a screenshot with anyone.** They are other people's phones.
- **Never take payment from a user to approve something.** It ends the job.
- **Never use someone else's admin login.** Every action is recorded against
  the person who did it, which protects you as much as anyone.

---

## When to call the owner, immediately

- The withdrawals page says the daily payout ceiling has been reached.
- A user says they were not paid and the row says paid.
- The admin console will not load, or the bot has stopped answering.
- Someone contacts you claiming to be the owner and asks you to pay someone.
  **The owner will never ask you this in a message.** Call them.
- Anything involving money that you do not understand.

You will never be in trouble for asking. You can be in trouble for guessing.

---

## Things that are not your job

Tasks and campaigns, settings, fees and limits, adding admins, announcements,
banning users, refunds outside the buttons above. If something seems to need
one of these, tell the owner.
