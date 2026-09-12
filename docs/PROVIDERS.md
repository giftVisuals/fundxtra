# Reward fulfilment providers

Fundxtra decides **what** a user is owed. A provider decides **how** it is
delivered. Keeping that seam narrow is what will make the NasfamPay integration
a single-file change once their public API ships.

```
Reward service  →  RewardProvider  →  { none | mock | nasfampay }
```

- `apps/api/src/providers/types.ts` — the interface
- `apps/api/src/providers/none.ts` — the default; fails closed
- `apps/api/src/providers/mock.ts` — development
- `apps/api/src/providers/nasfampay.ts` — **not implemented yet**
- `apps/api/src/providers/index.ts` — the registry, driven by `REWARD_PROVIDER`

---

## Why NasfamPay is not implemented

NasfamPay have confirmed their public API is still in development, with
documentation and a testing environment expected next month.

`NasfamPayProvider` therefore contains **no endpoint paths, no authentication
scheme, no request bodies and no response parsing.** Every one of those would
be a guess, and a guess that looks like working code is worse than an honest
gap: it would pass review, ship, and then fail against the real API — having
already debited users' balances.

What it does instead is fail loudly and specifically, so that everything
*around* it could be built and tested today: the balance debit, the reversal on
failure, status transitions, reconciliation of unknown outcomes, and the admin
views over all of it.

---

## The two rules any implementation must honour

**1. Respect `idempotencyKey`.** Fundxtra debits the user's balance *before*
calling out, so a retry must not deliver twice. Providers that accept a client
reference should pass this through; those that do not must dedupe locally.

**2. Distinguish failure from uncertainty.** `FAILED` means "definitely did not
happen" and triggers an automatic reversal to the user's balance. `PENDING`
means "outcome unknown" and must be resolved later. Returning `FAILED` for a
request that actually succeeded hands the user their refund *and* their
airtime — so a timeout, a 5xx and anything ambiguous must map to `PENDING`,
never `FAILED`.

---

## When the documentation arrives

Everything that needs to change is in `nasfampay.ts`:

1. **Credentials.** Make `configured` depend on what the docs actually require.
   `NASFAMPAY_BASE_URL` and `NASFAMPAY_API_KEY` are already wired through
   `config/env.ts` as placeholders — rename or extend them as needed.

2. **`fulfil()`.** Implement against the documented endpoint. It must:
   - pass `request.idempotencyKey` as the provider's client reference;
   - map terminal states onto `COMPLETED` / `FAILED`, and anything ambiguous
     onto `PENDING`;
   - return the provider's reference in `providerReference`;
   - keep the user-facing `message` generic and put provider text in `detail`.

3. **`checkStatus()`.** Implement it if the API offers a lookup, and set
   `statusLookup: true` in `capabilities()`. The reconciliation job in
   `services/rewards.ts` then resolves `PENDING` redemptions automatically;
   without it they wait for manual settlement, which is the honest outcome
   rather than guessing.

4. **Product codes.** Data bundles and Stars packs almost certainly need a code
   per SKU. Store it on the `rewardProducts` document rather than hardcoding a
   mapping here.

5. **Timeouts and retries.** Add a request timeout and a bounded retry policy
   for *idempotent* calls only.

Then:

```bash
# Railway
REWARD_PROVIDER=nasfampay
NASFAMPAY_BASE_URL=...
NASFAMPAY_API_KEY=...
```

…and enable the relevant reward methods in **Settings** in the admin console.
The overview page shows the active provider and, per reward, whether the switch
is on and whether the provider can actually deliver — so "why can nobody redeem
airtime" is answerable from the UI.

Nothing outside `nasfampay.ts` should need to change.

---

## Testing against the mock

```bash
REWARD_PROVIDER=mock   # development only; refused in production
```

`MockProvider` simulates the awkward cases as well as the happy one, because
the reversal and reconciliation paths are exactly the code that never gets
tested when a mock always succeeds. Behaviour is driven by the target:

| Target contains | Outcome | What it exercises |
| --- | --- | --- |
| `fail` | `FAILED` | Automatic reversal; the balance must come back in full |
| `pending` | `PENDING` | The money stays debited; reconciliation resolves it |
| anything else | `COMPLETED` | The happy path |

It also honours idempotency: the same key returns the same result rather than
delivering again. `test/payouts.test.ts` asserts all of this, including that a
failed redemption leaves the ledger reconciling exactly.

---

## Cash payouts

Cash withdrawal has no provider integration either, and the same reasoning
applies: no payment provider has been selected, so none is assumed.

Withdrawals are recorded, tracked through `PENDING → PROCESSING → COMPLETED`,
and settled by an operator making the bank transfer and recording the bank's own
reference. That is how this would be operated on day one regardless, and it
leaves the provider integration a contained change: implement a payout provider
behind the same kind of interface and have it drive the `COMPLETE` transition
instead of an operator.

The user's balance is debited the moment the request is accepted, so a pending
withdrawal is money the platform owes — not a reservation against an untouched
balance. Rejecting or failing one posts a compensating `REVERSAL` credit, and
both entries stay on the ledger.
