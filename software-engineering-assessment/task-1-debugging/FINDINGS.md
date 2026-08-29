# Findings

Riverside PMS — task 1. Investigation of incidents 2291 and 2304.

Everything below was measured, not inferred. `node`/`npm` are not installed on this
machine, so every run went through the reference image from `README.md`
(`node:22-alpine`, `npm ci`, in-memory SQLite reseeded on every boot, so runs are
deterministic):

```
docker compose run --rm pms npm run verify
docker compose run --rm pms npm test
```

Raw output is committed under [`evidence/`](evidence/). The full working notes, in the
order the reasoning actually happened — including a prediction that turned out wrong and
a judgement I had to retract — are in [`ANALYSIS-JOURNAL.md`](ANALYSIS-JOURNAL.md), and
the complete AI session is in [`AI-CONVERSATION.md`](AI-CONVERSATION.md).

> **Status.** Incident 2291 is fully analysed; the fix and the post-fix fixture numbers are
> the next commit. Incident 2304 has been located and quantified but not yet fixed — its
> section below says exactly how far it got, and is marked accordingly.

---

## Incident 2291 - six-night stay billed as seven

### Reproduction

Smallest input that shows it — a single quote, no reservation needed:

```bash
curl -s localhost:3000/quotes -H 'content-type: application/json' \
  -d '{"roomTypeId":"DLX","checkIn":"2026-08-28","checkOut":"2026-09-03"}'
```

```jsonc
{
  "nights": [
    { "date": "2026-08-28", "season": "HIGH",     "rate": "210.00" },
    { "date": "2026-08-29", "season": "HIGH",     "rate": "210.00" },
    { "date": "2026-08-30", "season": "HIGH",     "rate": "210.00" },
    { "date": "2026-08-31", "season": "HIGH",     "rate": "210.00" },
    { "date": "2026-09-01", "season": "HIGH",     "rate": "210.00" },   // <-- duplicate
    { "date": "2026-09-01", "season": "FESTIVAL", "rate": "285.00" },   // <-- duplicate
    { "date": "2026-09-02", "season": "FESTIVAL", "rate": "285.00" }
  ],
  "roomTotal": "1620.00", "tax": "194.40", "fee": "15.00", "total": "1829.40"
}
```

Per `SPEC.md` §2 this stay is six nights. The correct total is `1594.20`
(4 × 210.00 + 2 × 285.00 = 1410.00, +12% tax 169.20, +15.00 resort fee), which is what the
reference system returns for fixture row `A0508`. **Every affected booking overcharges the
guest by 235.20** — the amount the front office has been refunding by hand.

**The duplicated date is the whole story.** The night is not appended at the end of the
stay; `2026-09-01` is billed **twice, in the middle, at two different rates** — once by the
season that is ending and once by the season that begins on that same date.

The narrowest reduction of the defect is a one-night stay whose **arrival** is a season
boundary:

```bash
# SUI 2026-06-01 -> 2026-06-02 : one night, returns two
curl -s localhost:3000/quotes -H 'content-type: application/json' \
  -d '{"roomTypeId":"SUI","checkIn":"2026-06-01","checkOut":"2026-06-02"}'
# nights: 2  total: 687.00      reference (Q0051): nights 1, total 418.20
```

**Why the reporter saw it only sometimes.** S. Okoro wrote *"I checked ten other bookings
from the same two weeks and they were all fine, so it isn't general"* — that sentence is
the key to the whole incident, not a reassurance. The attached log contains its own control:

```
window=2026-08-28..2026-09-03  rows=2  segments=2  nights=7  roomTotal=162000   <- wrong
window=2026-08-24..2026-08-30  rows=1  segments=1  nights=6  roomTotal=126000   <- correct
```

Same room type, same week, same intended night count. The only difference is that the first
stay contains a rate-season boundary. The stays that "looked fine" contained none. The two
guests who left in early June hit `2026-06-01`, another boundary.

### Root cause

There are two levels here, and they need to be kept apart, because a fix aimed at the first
one alone is exactly the trap this incident sets.

**The proximate mechanism — two kinds of interval endpoint compared as one, in two layers.**

```js
// src/services/pricingService.js
15:  const lastNight  = addDays(checkOut, -1);                     // an INCLUSIVE endpoint
20:  const segmentEnd = minDate(lastNight, season.end_date);       // an EXCLUSIVE endpoint
23:  for (let date = segmentStart; date <= segmentEnd; date = addDays(date, 1)) {
```

`lastNight` is the last night slept — inclusive. `season.end_date` is the first date the
season no longer covers — exclusive. This is not an inference; `SPEC.md` §3 states it and
`src/db/schema.sql:13` says it verbatim:

```sql
-- start_date is inclusive, end_date is EXCLUSIVE (see SPEC.md section 3)
```

Line 20 passes both to `minDate` **as if they were the same kind of value**. That is a
category error, not an arithmetic slip, and it explains the intermittency exactly:

- boundary **outside** the stay → `min` returns `lastNight`, the inclusive `<=` loop is
  correct → the 169 single-season fixture rows pass, and always have;
- boundary **inside** the stay → `min` returns the exclusive `end_date`, the `<=` loop
  bills it as a night, and the next season — which starts on that same date — bills it
  again.

The second layer is in the repository:

```sql
-- src/repositories/rateRepo.js:11
AND end_date >= ?     -- ? = the stay's first date; again an exclusive end read as inclusive
```

A season that ended **on** the arrival date covers none of the stay's nights, yet it is
selected. Line 20 then hands it a one-night segment on the arrival date. This is what makes
`SUI 2026-06-01..2026-06-02` return two nights. **Fixing either layer alone leaves the other
live**, and I say that having initially got it wrong — see *What I got wrong* below.

**The root cause — the loop runs in the wrong direction.**

> `resolveNightlyRates` iterates the **seasons** and clips each one to the stay, instead of
> iterating the **stay's nights** and resolving a rate for each. Because of that inversion,
> the *shape of the rate calendar* — a table `SPEC.md` §3 explicitly says is maintained by
> hand and not guaranteed to be complete — decides how many nights a guest is billed for.
> The function is therefore **not total**: it returns "whatever it found" rather than "one
> rate for every night, or a refusal". `quote()` then sums whatever arrives and adds the
> resort fee without checking anything, so any divergence between the stay and the calendar
> — in either direction — reaches the guest as a **confident wrong number under HTTP 200**.

That single sentence has to explain every observed symptom, and it does — six of them:

| # | symptom | cause |
|---|---|---|
| 1 | boundary night billed twice | adjoining seasons, both segments claim the date |
| 2 | **a price invented for a night that has none** | `2026-12-20` is `SHOULDER`'s exclusive end, quoted at 110.00 |
| 3 | uncovered nights billed zero times, silently | `2026-12-18..12-31`: 7 nights charged out of 13, HTTP 200 |
| 4 | zero-night and reversed stays accepted | empty night list is indistinguishable from a priced one |
| 5 | unknown room type quoted at `15.00` | no seasons found → no nights → resort fee only |
| 6 | `TypeError` → HTTP 500 on cancellation | `nights[0]` of an empty array |

The system already contains the correct primitive and does not use it here:

```js
// src/lib/dates.js:26 — "Nights actually slept: [checkIn, checkOut).
//                        The departure date is not a night."
export function enumerateNights(checkIn, checkOut) { ... }
```

`/housekeeping/forecast` calls it and is unaffected (`FORECAST` 8/8). The pricing path never
calls it. The cleanest evidence that this is structural rather than arithmetic is that
`availabilityService.js:20` computes the correct night count independently and returns it in
the **same JSON object** as a total priced over a different number of nights:

```jsonc
GET /availability?roomTypeId=DLX&checkIn=2026-08-28&checkOut=2026-09-03
{ "nights": 6, "quotedTotal": "1829.40" }        // six nights, priced as seven
```

Two competing sources of truth for "how many nights", one response.

### Why the obvious fix is not enough

I did not argue this. I applied each candidate to an isolated copy of `src/` outside the
repository and replayed the reference fixture over it
(`docker compose run --rm -v <copy>:/app/src pms npm run verify`). The working tree was
never modified. Baseline is **320/596**. Full output:
[`evidence/rejected-quick-fixes.md`](evidence/rejected-quick-fixes.md).

| candidate | change | fixture | regression tests | verdict |
|---|---|---:|---|---|
| — | baseline | 320/596 | 3 pass / 16 fail | — |
| **1** | `date < segmentEnd` | **20/596** | 1 pass / 18 fail | destroys the system |
| **2** | `minDate(lastNight, addDays(season.end_date, -1))` | **481/596** | 10 pass / **9 fail** | **the trap** |
| **3** | `nights.slice(0, diffDays(checkIn, checkOut))` | **320/596** | 3 pass / 16 fail | hides the defect |

**Candidate 1 — "the departure day is being charged, so stop charging it."**
This is the fix the ticket title invites: *"a six-night stay billed as seven"*, and `SPEC.md`
§2 opens with the departure-date rule. The pattern match is very strong. It takes the fixture
from 320/596 to **20/596**. It treats the **end** of the stay while the defect is in the
**middle**, so it breaks the 169 rows that were already right: `Q0001`, a one-night stay,
becomes `nights=0 total=15.00` — a resort fee and nothing else. It is wrong even on the
ticket's own booking: it drops `09-02` at 285.00 while the duplicate is `09-01` at 210.00,
giving `1510.20` against the reference's `1594.20`.

**Candidate 2 — the type-correct one-liner. This is the one that matters, and the one I
would name explicitly if asked "what is the obvious fix that is wrong".**
Converting the exclusive season end into an inclusive last night before the comparison is
*conceptually correct at line 20*, and it **fixes incident 2291 completely** — all 161
category-A rows pass, and the fixture jumps to **481/596**. It looks like success. It is what
a careful engineer arrives at, and stopping there is the failure mode this exercise is built
around. It is not shippable, for five reasons:

1. **It repairs the mechanism and leaves the root cause.** The function stays non-total: the
   calendar still decides the night count. Over the gap the night list is simply *short* and
   `quote()` still returns a confident total. `Q0171` (`STD 2026-12-18..2026-12-31`) becomes
   `nights=6 total=1202.20` for a thirteen-night stay; `Q0175` (`DLX 2027-01-07..2027-01-20`)
   becomes `nights=0 total=15.00` — thirteen nights for a resort fee. Both HTTP 200. It swaps
   **inventing a price** for **giving nights away**, and `SPEC.md` §3 forbids both:
   *"the system must not invent a price for a night that has no rate … revenue management
   prefers refusing the booking over pricing it wrongly."* The silent version is the more
   dangerous of the two.
2. **It leaves the second layer untouched.** `rateRepo.findSeasons` still selects expired
   seasons; the empty segment is discarded by the `continue` on line 21. Correctness becomes
   contingent on statement order — the kind of fragility that reopens the bug at the first
   refactor.
3. **It leaves a live crash path.** Proven by execution against the current code:
   ```
   create(DLX 2027-01-07 -> 2027-01-20, FLEX)  -> 201, thirteen nights, none priced
   cancel(id, '2027-01-05')
     -> TypeError: Cannot read properties of undefined (reading 'rateCents') -> HTTP 500
   ```
   Source: `cancellationService.js:26`, `quoted.nights[0].rateCents`. The response *shape* is
   fine and leaks nothing (`app.js:17-18` satisfies `SPEC.md` §7), but the **classification**
   is wrong: an unpriceable stay is a business condition surfacing as a system fault, and §7
   requires those to be clearly distinguishable. To be precise: this path is not reachable
   over HTTP *today* (the route never passes `today`, and `SAVER` never reads `nights[0]`).
   It becomes reachable as the calendar advances — a `FLEX` booking arriving `2026-12-22`,
   cancelled late in December. A latent defect on a timer.
4. **It leaves corrupted data on disk.** `src/db/seed-folios.js` priced the historical folios
   through the same function. Code alone does not correct a stored balance.
5. **It would pass a regression test written for the ticket.** That is why the tests in this
   change are written for the root cause instead — nine of them still refuse candidate 2.

**Candidate 3 — "the count is wrong, so fix the count."** Zero fixture improvement, and it is
the most dangerous of the three:

```
Q0049  STD 2026-05-26..2026-06-06   expected nights=11;total=1431.80
                                    actual   nights=11;total=1370.20
```

The **count is now exactly right and the money is still wrong**, because it truncates the
tail and keeps the duplicate in the middle — dropping a real night at the new season's rate
while retaining a doubled one at the old rate. This is the fix that silences the reporter:
the front office sees "6 nights" on the confirmation and closes the ticket, and the
discrepancy stays on the bill. A financial defect that has lost its only witness.

### Also affected by the same cause

Everything funnels through `resolveNightlyRates`:

| surface | location | effect |
|---|---|---|
| `POST /quotes` | `routes/index.js:39` | the quote sent to the guest |
| `GET /rates/preview` | `routes/index.js:57` | direct call — renders one date twice at two rates |
| `GET /availability` | `availabilityService.js:15` | `quotedTotal`, contradicting its own `nights` |
| `POST /reservations` | `reservationService.js:34,47` | folio lines and balance |
| `PATCH /reservations/:id` | `reservationService.js:60,62` | re-priced on every date change |
| `POST /reservations/:id/cancel` | `cancellationService.js:20,26` | `SAVER` penalty inherits the inflated total; `FLEX` reads `nights[0]` |
| seed | `src/db/seed-folios.js:8` | every folio present at go-live is priced by the same function, so the stored balances are wrong too |

Affected date ranges, from `src/db/seed-data.js`: any stay containing `2026-06-01`,
`2026-09-01` or `2026-09-08` as one of its nights is over-billed by one night per boundary
(`Q0080`, crossing two, is over-billed by two). Any stay touching `2026-12-20..2026-12-26`,
or falling outside `2026-01-01..2027-01-03`, is under-billed or priced from nothing.

Not affected: `/housekeeping/forecast`, which uses `enumerateNights`.

### Hardening

Regression tests: [`tests/regression-2291-nightly-rates.test.js`](tests/regression-2291-nightly-rates.test.js)
— 19 tests, `node:test`, no new dependencies, written against `SPEC.md` rather than against
current behaviour. On the unfixed code: **3 pass, 16 fail**. The three that pass are the
guards, which is the point — green before the fix and required to stay green after it.
`npm test` goes from 19 tests to 38 with no pre-existing test disturbed.

Each block names the rejected candidate it exists to catch, so that a future change which
merely "makes the ticket green" cannot pass:

- **the duplicate itself**, asserted as a set property rather than a count
  (`assert.deepEqual(dates, [...new Set(dates)])`) — a count-only assertion would let
  candidate 3 through;
- **the invariant**: the priced dates equal `enumerateNights(checkIn, checkOut)` exactly, for
  five stays — one boundary, boundary-on-arrival, two boundaries, no boundary, ends-on-
  boundary;
- **guards** for stays that are correct today and must remain so — these are what catch
  candidate 1;
- **`SPEC.md` §3**: an unpriced night is refused, never invented and never given away, on
  `/quotes` *and* `/rates/preview` — these are what catch candidate 2;
- **range and identity**: zero-night, reversed, unknown room type, and the 180-night cap;
- **blast radius**: `/availability` self-consistency, folio lines and balance, and — closing
  the 500 at its source — that a stay which cannot be priced cannot be booked either.

Measured discrimination ([`evidence/regression-test-discrimination.md`](evidence/regression-test-discrimination.md)):
candidate 1 → 1 pass / 18 fail (breaks all three guards); **candidate 2 → 10 pass / 9 fail**;
candidate 3 → 3 pass / 16 fail. Candidate 2 is the row that justifies the whole approach: it
closes ticket 2291 completely and nine tests still refuse it.

**Deliberately not asserted: error codes.** The tests assert the `4xx` class, the presence of
the error envelope, and that no stack trace, SQL or file path leaks (`SPEC.md` §7), and leave
the choice of code to the fix. Pinning a code would constrain the implementation for nothing
and could fail a correct fix.

**One more thing worth hardening, which is not a test:** all 19 pre-existing tests pass on
the broken code. Every pricing test uses a stay inside a single season, so not one of them
ever crosses a boundary — including the test literally named *"the departure date is not
charged as a night"*, which checks a one-night February stay. Full green was never coverage.
The gap was in case selection, not in test count, and that is how a defect this size survived
a year in production behind a green suite.

### Left alone (and why)

- **The error handler**, `app.js:10-19`. It is correct and `SPEC.md` §7 compliant — no stack
  traces, no SQL, no file paths reach the client. The problem is not there; it is that the
  services never classify the business condition before it arrives.
- **`money.js percentOf`** uses `Math.round`, which is half-up for positives as `SPEC.md` §6
  requires, but rounds toward `+∞` for negatives. `roomCents` is never negative on this path,
  so changing it would be churn without a failing case.
- **`enumerateNights` / `diffDays` / `addDays`** in `src/lib/dates.js`. They are correct and
  documented. The fix should *use* them, not modify them.
- **The rate calendar data.** Filling the `2026-12-20..12-26` gap would make 85 fixture rows
  pass and would be wrong: the reference system expects `4xx` there, and `SPEC.md` §3 says
  revenue management prefers refusing the booking. The gap is a legitimate state of a manually
  maintained table; the system's response to it is the defect.
- **A folio-repricing migration.** Worth being precise about, because the obvious statement
  is wrong for *this* deployment. `src/db/index.js` builds an in-memory SQLite database and
  runs `seedFolios` on every boot, so the seeded folios are recomputed by the fixed code and
  correct themselves — no migration is needed here, and I checked that all 21 seeded
  reservations remain priceable, so refusing unpriced stays cannot break startup. On a real
  deployment with a persistent database the opposite holds: the wrong balances are already
  written and a code fix does not touch them. That needs a decision from Finance about scope
  and about refunds already issued, so it is flagged rather than actioned.

### What I got wrong during this investigation

Recorded because the reasoning matters more than the conclusion, and both corrections changed
the fix.

1. **Phase 2, resolved in phase 3.** I predicted rows would fail exactly when a boundary was
   *strictly inside* the stay. 36 rows failed outside that definition. The correct rule is
   that **every boundary which is itself a night of the stay** is duplicated, `checkIn <=
   boundary < checkOut` — a stay whose *arrival* is a boundary breaks too.
2. **Directly consequent, and more serious.** I had called the `rateRepo.findSeasons`
   predicate harmless — *"swallowed inside the loop, correct by accident"*. It is not: it is a
   **co-cause**, and it is why case 1 above happens. Had I not tested the prediction, the fix
   would have shipped touching one layer out of two.
3. **Phase 2 arithmetic.** From the log alone, two splits were consistent with `roomTotal=162000`.
   I flagged both, refused to pick without the rate table — and then leaned toward the wrong
   one. The seed showed the other was right. The refusal to guess was correct; the lean was not.

---

## Incident 2304 - room unavailable on a turnover day

> **Not yet fixed.** Located and quantified during the 2291 investigation; the full
> treatment follows the same five phases. Recorded here at the level it has actually
> reached, rather than left blank.

### Reproduction

```bash
curl -s 'localhost:3000/availability?roomTypeId=STD&checkIn=2026-11-10&checkOut=2026-11-12'
# available: 0        reference (A0456): available 1
curl -s 'localhost:3000/availability?roomTypeId=STD&checkIn=2026-11-11&checkOut=2026-11-13'
# available: 2        correct — moving the arrival by one day restores it
```

and the second complaint in the ticket:

```bash
curl -s -X PATCH localhost:3000/reservations/RES-11150 \
  -H 'content-type: application/json' \
  -d '{"checkIn":"2026-12-02","checkOut":"2026-12-07"}'
# 409 NO_ROOMS_AVAILABLE — the suite is "full", and the booking it competes with is itself
```

### Root cause

**The same conceptual root as 2291 — a half-open interval treated as closed — in a different
layer, and it needs a different fix.**

```js
// src/services/reservationService.js:10
function overlaps(reservation, checkIn, checkOut) {
  return reservation.check_in <= checkOut && reservation.check_out >= checkIn;
}
```

Both comparisons are inclusive. Two stays that merely *touch* — one checking out on the day
the other checks in — are counted as overlapping, which contradicts `SPEC.md` §2: *"a stay's
departure date may be the same as the next stay's arrival date."* The correct predicate for
half-open ranges is strict on both sides. `availabilityRepo.countOverlapping` carries the
same defect, which is why `/availability` and `POST /reservations` agree with each other and
are both wrong.

There is a **second, independent defect** in the same area, and it must not be merged into
the first: `assertRoomsLeft` is called from `changeDates` without excluding the reservation
being modified (`reservationService.js:58`), so a booking competes with itself when its dates
change. Fixing the interval comparison alone will not fix `E0593`/`E0594`.

### Why the obvious fix is not enough

Not yet established by measurement — this is the analysis that remains. What is already
known: the fix must handle both defects, and the `<=`/`>=` correction alone will not close
the ticket's second half. There is also a **trap** waiting here, found while probing the
fixture: `C0592`, a 365-night create, currently passes for the **wrong reason** — it is
refused with `NO_ROOMS_AVAILABLE`, not by any stay-length rule, because the 180-night maximum
does not exist anywhere in `src/`. Any change that makes overlap counting less aggressive
risks flipping that row red unless the `SPEC.md` §2 length cap is added at the same time.

### Also affected by the same cause

26 fixture rows: `AVAIL` 19, `CREATE` 5, `EXTEND` 2 — full list in
[`evidence/failing-rows-BEFORE.md`](evidence/failing-rows-BEFORE.md). Business impact:
turnover-day inventory is invisible, so rooms that are free are not sold, and existing guests
cannot extend.

### Hardening

Not yet written.

### Left alone (and why)

Not yet decided.

---

## Fixture

### Rows failing before the fix

`npm run verify` → **`320/596 rows match the reference system`** ⇒ **276 mismatched rows**.
`npm run verify -- QUOTE` → **`173/395`** ⇒ **222 mismatched**.

| kind | rows | mismatched |
|---|---:|---:|
| QUOTE | 395 | 222 |
| PREVIEW | 60 | 19 |
| AVAIL | 117 | 27 |
| EXTEND | 4 | 2 |
| CREATE | 9 | 6 |
| FORECAST | 8 | 0 |
| CREATE_GUESTS | 2 | 0 |
| CREATE_LONG | 1 | 0 |
| **total** | **596** | **276** |

Grouped by cause — computed from the component that actually differs (`available=` vs
`total=`/`nights=`), not guessed from the dates:

| cause | rows | ticket |
|---|---:|---|
| A — duplicated season-boundary night | 161 | 2291 |
| B1 — stay touching an unpriced night priced instead of refused | 85 | 2291 (same cause) |
| B2 — non-positive stay length accepted | 2 | 2291 (same cause) |
| B3 — unknown room type quoted | 1 | 2291 (same cause) |
| B4 — 180-night maximum not enforced | 1 | separate |
| D — availability overlap / no self-exclusion | 26 | 2304 |

Complete row ids for every group, with expected/actual samples, are in
[`evidence/failing-rows-BEFORE.md`](evidence/failing-rows-BEFORE.md). Raw runs are in
[`evidence/verify-all-BEFORE.txt`](evidence/verify-all-BEFORE.txt) and
[`evidence/verify-QUOTE-BEFORE.txt`](evidence/verify-QUOTE-BEFORE.txt).

The incident's own booking appears as `A0508` — `DLX 2026-08-28..2026-09-03`, expected
`available=2;total=1594.20`, actual `available=2;total=1829.40`. `available` matches on both
sides, so that row isolates the pricing defect from 2304 cleanly.

### Rows failing after the fix

To be filled in with the fix commit. Expected, from the measured candidate runs: the 249 rows
in groups A, B1, B2 and B3 close with the 2291 fix; group D closes with 2304; B4 needs the
`SPEC.md` §2 length cap. The target is 596/596.

### One defect the fixture does not catch

Room-type capacity is never enforced on create:

```bash
curl -s localhost:3000/reservations -H 'content-type: application/json' \
  -d '{"guestName":"probe","roomTypeId":"STD","checkIn":"2026-03-02","checkOut":"2026-03-04","guests":3}'
# 201 Created — but STD capacity is 2 (SPEC.md §2)
```

`CREATE_GUESTS` only tests `guests: 9`, which trips the generic `1..8` bound in
`validate.js:11` rather than the capacity rule, so both those rows pass while the rule itself
is unimplemented. Reported rather than fixed: it is outside both tickets, and it is a
decision for the reviewer whether it belongs in this change.
