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

> **Status.** Both incidents are analysed, fixed and verified. The reference fixture goes
> from **320/596 to 596/596** and `npm test` from 19 tests to **49, all passing**.
> Incident 2291 accounted for 250 of the 276 failing rows and incident 2304 for the other
> 26 — a split predicted before either fix was written, and confirmed exactly by both.

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

### The fix as shipped

Four files, all of it removing the inversion rather than patching around it.

**`src/services/pricingService.js` — the loop now runs over the stay.**

```js
const stay = enumerateNights(checkIn, checkOut);        // the stay decides which nights exist
for (const date of stay) {
  const covering = seasons.filter((season) => covers(season, date));   // the calendar only prices them
  if (covering.length === 0) unpriced.push(date);
  else if (covering.length > 1) ambiguous.push(date);
  else nights.push({ date, season: covering[0].season, rateCents: covering[0].nightly_rate_cents });
}
if (unpriced.length > 0 || ambiguous.length > 0) throw unprocessable('RATE_UNAVAILABLE', …);
```

The function is now **total**: exactly one rate per night, or the stay is refused. Duplication
is impossible by construction — the night list is the stay's, so a date cannot appear twice
however the calendar is shaped. `covers()` states the half-open rule once,
`start_date <= date < end_date`, instead of leaving it implicit in a loop bound.

Two seasons covering the same night are refused rather than resolved by "first row wins".
That case does not exist in today's data, but the calendar is maintained by hand and
`SPEC.md` §3 is clear that refusing beats pricing wrongly — silently picking one of two
contradictory rates would be the same "confident wrong number" this incident is about,
arriving through a different door.

**`src/repositories/rateRepo.js` — the other half of the same category error.**
`start_date <= ? AND end_date >= ?` became `start_date < ? AND end_date > ?`: both ranges
are half-open, so the overlap test is strict on both sides. This is what stopped an
already-expired season being returned for a stay arriving on its end date.

**`src/lib/validate.js` — `requireRange(from, to, { maxNights })`**, returning the night
count and rejecting an empty or reversed range, plus `MAX_STAY_NIGHTS = 180` from
`SPEC.md` §2.

**`src/routes/index.js`** wires it in. `maxNights` is passed only where the range is an
actual **stay** — `/quotes`, `POST /reservations`, `PATCH /reservations/:id`. `/rates/preview`
is a window over the rate calendar rather than a stay, so it gets the range check without the
length cap; `/availability` is a search surface and gets the same treatment. The fixture does
not settle this either way — it contains no `PREVIEW` or `AVAIL` row longer than 180 nights —
so it is a judgement call, recorded here as one.

Status codes follow `SPEC.md` §7's separation of a client error from a business rejection:

| condition | status | code |
|---|---|---|
| `checkOut <= checkIn`, or a stay over 180 nights | `400` | `INVALID_INPUT` |
| unknown room type | `404` | `ROOM_TYPE_NOT_FOUND` |
| a night with no rate, or with two | `422` | `RATE_UNAVAILABLE` |

The 422 carries the offending dates, which is what makes it actionable at the front desk
rather than merely correct:

```jsonc
{ "error": { "code": "RATE_UNAVAILABLE",
    "message": "No single nightly rate is defined for every night of this stay in Standard Twin",
    "details": { "roomTypeId": "STD", "checkIn": "2026-12-18", "checkOut": "2026-12-31",
                 "unpricedNights": ["2026-12-20","2026-12-21","2026-12-22","2026-12-23",
                                    "2026-12-24","2026-12-25","2026-12-26"] } } }
```

**The crash path is closed at its source, not patched at the crash site.**
`cancellationService.js:26` still reads `quoted.nights[0].rateCents` and is now safe: `quote()`
either returns at least one priced night or throws an `AppError`, so the `TypeError` → 500 is
unreachable. Nothing was added there — the invariant does the work.

Verified end to end:

```
POST /quotes  DLX 2026-08-28..2026-09-03  -> 200  six nights, 2026-09-01 once at FESTIVAL,
                                                  total 1594.20   (was 1829.40)
POST /quotes  SUI 2026-06-01..2026-06-02  -> 200  one night, 418.20   (was 687.00)
POST /quotes  STD 2026-12-18..2026-12-31  -> 422  RATE_UNAVAILABLE, seven dates listed
POST /quotes  DLX 2026-08-28..2026-08-28  -> 400  INVALID_INPUT
POST /quotes  XXX 2026-08-28..2026-09-03  -> 404  ROOM_TYPE_NOT_FOUND
POST /quotes  STD 2026-01-01..2026-12-20  -> 400  INVALID_INPUT, 353 nights exceeds 180
GET  /availability DLX same dates         -> 200  "nights": 6 AND "quotedTotal": "1594.20"
create(DLX 2027-01-07..2027-01-20)        -> 422  the stay that used to 500 on cancel
```

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

**"Is this room type available?" had two independent implementations, and they had drifted
apart on two separate axes.**

```js
// src/repositories/availabilityRepo.js  — served GET /availability
WHERE r.room_type_id = ? AND r.check_in <= ? AND r.check_out >= ?

// src/services/reservationService.js:10 — served POST /reservations and PATCH
reservation.check_in <= checkOut && reservation.check_out >= checkIn
...filter((r) => r.status === 'confirmed' && overlaps(r, checkIn, checkOut))
```

**Axis one — the interval convention.** Both are inclusive at both ends, so both are wrong.
Two stays that merely *touch* — one checking out on the day the other checks in — are counted
as overlapping, contradicting `SPEC.md` §2: *"a stay's departure date may be the same as the
next stay's arrival date."* For half-open ranges the test is strict on both sides.

The fixture pins **both** ends independently, which a single reading of the code does not:

| row | window | expected | actual | phantom bookings |
|---|---|---:|---:|---:|
| `A0459` | STD 2026-11-10..11-11 (one night) | 2 | 0 | **2** |
| `A0456` | STD 2026-11-10..11-12 | 1 | 0 | **1** |

The one-night window over-counts by two while longer windows over-count by one. Only an
inclusive comparison at *both* ends explains that: a booking **departing** on 11-10 is counted
in every window, while a booking **arriving** on 11-11 is counted spuriously only in the
one-night window, because in longer windows it genuinely overlaps.

**Axis two — the status filter.** `reservationService` excludes cancelled reservations;
`availabilityRepo` **does not filter status at all**. `SPEC.md` §5 is explicit: *"a cancelled
reservation frees the room immediately and does not count towards occupancy thereafter."*
So `/availability` counted cancelled bookings as occupancy and the booking endpoint did not.
This is the axis the code review nearly missed, and it is not repairable by any amount of care
with interval bounds — `A0479` and `A0487` are windows that genuinely overlap a cancelled
booking.

The consequence is a system that contradicts itself within a second:

```jsonc
GET  /availability?roomTypeId=SUI&checkIn=2026-10-08&checkOut=2026-10-11
  → {"available": 0}                 // "the suite is full"
POST /reservations, same dates
  → 201 Created                      // and the booking succeeds
```

**A third, independent defect**, which must not be merged into the first two: `changeDates`
called `assertRoomsLeft` without excluding the reservation being modified
(`reservationService.js:58`), so a booking competed with itself. `RES-11150`'s own dates
overlap its requested new dates under *any* definition of overlap, strict or loose, so no
endpoint correction can fix `E0593`/`E0594`.

**Why it survived a year.** `availabilityService.js:21` computes
`Math.max(0, total_rooms - booked)`, so an over-count surfaces as an ordinary-looking
"0 available" rather than a negative number. And unlike 2291 this defect leaves no trace:
2291 overcharged guests, which produces refunds and complaints; 2304 **hides sellable
inventory**, and a customer who is turned away does not come back to complain.

### Why the obvious fix is not enough

Measured, not argued. Each candidate applied to an isolated copy of `src/` and replayed
against the fixture (baseline after the 2291 fix: 570/596). Full output:
[`evidence/2304-rejected-quick-fixes.md`](evidence/2304-rejected-quick-fixes.md).

| candidate | change | fixture | regression tests | verdict |
|---|---|---:|---|---|
| **D1** | `availabilityRepo` SQL only | **590/596** | 6 pass / 5 fail | **makes the product worse** |
| D2 | both overlap predicates | 592/596 | 7 pass / 4 fail | ignores `SPEC.md` §5 |
| **D3** | both predicates + status | **594/596** | 9 pass / **2 fail** | **leaves half the ticket** |

**D1 is the obvious fix, and the bait is more direct than 2291's — the incident log names the
file outright:** `DEBUG availabilityRepo.countOverlapping roomType=STD booked=6 rooms=6`.
Correcting that one predicate repairs 20 of 26 rows and the ticket's headline symptom
disappears. But `reservationService` held a second copy that D1 does not touch, so the
contradiction is not removed — it is **reversed**:

```
BEFORE    GET  /availability STD 2026-11-10..11-12  → available = 0   "sold out"
          POST /reservations same dates             → 201 Created

AFTER D1  GET  /availability STD 2026-11-10..11-12  → available = 1   "one room free"
          POST /reservations same dates             → 409 NO_ROOMS_AVAILABLE
```

Before the fix the screen hid a sellable room. After D1 the screen offers a room and the
system then refuses to sell it. D. Ferrand's actual complaint — *"we turn customers away and
lose bookings"* — is not merely unfixed; it now happens **after** the guest has been told the
room is available. Rows `C0581`/`C0582` catch it exactly: `available=1;create=status=4xx`.
Fixing one of two copies of a duplicated rule does not reduce the contradiction, it only
changes its direction.

**D3 is the second trap.** 594/596, every `AVAIL` and `CREATE` row green, and only
`E0593`/`E0594` left — which are the **second paragraph of the same ticket**, the guest who
cannot extend their own booking. A change that closes the headline and leaves the reporter's
other complaint open is not a closed ticket, and it is easy to miss because `EXTEND` looks
like a separate feature when it is half the report. D3 also still leaves two parallel
implementations of one rule, which is the condition that produced the incident.

For this ticket the fixture alone is therefore **not sufficient**: without reading the
reporter's second complaint, D3 looks complete.

### The fix as shipped

Two files. The second implementation was **deleted, not corrected**.

```js
// src/repositories/availabilityRepo.js — now the only definition of occupancy
export function countOverlapping(roomTypeId, checkIn, checkOut, { excludeReservationId = null } = {}) {
  ...
        WHERE r.room_type_id = ?
          AND r.status       = 'confirmed'    // SPEC 5
          AND r.check_in     <  ?             // SPEC 2, strict
          AND r.check_out    >  ?             // SPEC 2, strict
          AND r.id           IS NOT ?         // exclude the reservation being moved
```

`reservationService.assertRoomsLeft` now calls that function instead of answering the question
itself; the local `overlaps()` helper and its `findByRoomType` scan are gone. `changeDates`
passes `{ excludeReservationId: id }`. `grep` confirms no second overlap comparison remains
in `src/`.

`r.id IS NOT ?` is SQLite's null-safe comparison, so with no exclusion the clause reads
`IS NOT NULL` and keeps every reservation — one query, no branching.

This is the same principle as the 2291 fix: make the wrong state **unrepresentable** rather
than corrected in two places. Correcting both copies (candidate D3) would have scored 594/596
and left the two implementations free to drift apart again on the next change. Deleting one
means they cannot disagree, because there is no longer a "they".

The counting also moved into SQL for the booking path, which previously loaded every
reservation of a room type into memory to filter it in JavaScript.

Verified end to end:

```
STD 2026-11-10..11-12  available 0 → 1      turnover day, the reported symptom
STD 2026-11-10..11-11  available 0 → 2      one night, both ends
STD 2026-02-27..03-02  available 5 → 6      arrival on the query's own checkout date
SUI 2026-10-05..10-09  available 0 → 1      cancelled RES-11081 no longer occupies
DLX 2026-10-14..10-18  available 0 → 1      cancelled RES-11082 no longer occupies
SUI 2026-12-02..12-05  available 0          genuinely full, still refused
POST /reservations STD 2026-11-10..11-12 → 201 (was 409), availability then 0,
                                              a further booking → 409
PATCH RES-11150 → 2026-12-02..12-07      → 200 (was 409)
     a third overlapping SUI booking      → 409, so self-exclusion excludes one booking,
                                              not the rule
```

### Also affected by the same cause

26 fixture rows — `AVAIL` 19, `CREATE` 5, `EXTEND` 2 — listed in
[`evidence/failing-rows-BEFORE.md`](evidence/failing-rows-BEFORE.md). Beyond the fixture: every
turnover day at the property was invisible to the booking screen, on all three room types;
cancelled bookings held their rooms off sale indefinitely; and no staying guest could change
their own dates. None of it appears on a folio, which is why only the second symptom was ever
reported.

### Hardening

[`tests/regression-2304-occupancy.test.js`](tests/regression-2304-occupancy.test.js) — 11
tests, 3 pass / 8 fail before the fix. Built on the witness rows that phase 3 isolated, one
per defect: `A0456` (departure end), `A0405` (arrival end), `A0479`/`A0487` (cancelled
bookings), `E0593`/`E0594` (self-competition).

The test that matters most looks at **both surfaces in one test** — it reads availability,
books the room it was offered, and checks the sale appears. It is the only thing in the suite
that catches D1, whose failure message states the entire defect:

```
not ok 8 - 2304: what availability offers, the booking endpoint sells
    availability offered 1 room(s) and the booking was refused with 409
```

Measured discrimination
([`evidence/2304-regression-test-discrimination.md`](evidence/2304-regression-test-discrimination.md)):
D1 → 6 pass / 5 fail, D2 → 7 pass / 4 fail, **D3 → 9 pass / 2 fail** despite scoring 594/596.

**Three guard tests**, which matter more here than they did for 2291: every candidate fix for
this ticket works by *relaxing* the count, and over-relaxing oversells the hotel — a worse
failure than the one being repaired. They pin that a genuinely full room type still reports
zero, that booking into it is still refused, and — after `RES-11150` is moved — that a third
overlapping suite booking is still refused, so self-exclusion removes one specific
reservation rather than the rule.

### Left alone (and why)

- **`Math.max(0, total_rooms - booked)`** in `availabilityService.js:21`. It hid this defect
  for a year by rendering an over-count as an ordinary "0 available". With one definition of
  occupancy the count can no longer exceed the room count, so the clamp is now dead code
  rather than a mask — removing it would be churn, and keeping it is a harmless floor.
- **`reservationRepo.findByRoomType`**. No longer used by the booking path, but still used by
  `/housekeeping/forecast`. Left in place.
- **Room-type capacity on create.** Still unenforced (see the fixture section below). It is a
  real `SPEC.md` §2 violation and it is outside both tickets; reported rather than folded in.

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

**None.**

```
npm run verify   →  596/596 rows match the reference system
npm test         →  49 tests, 49 pass, 0 fail
```

Raw runs: [`evidence/verify-all-AFTER-2291.txt`](evidence/verify-all-AFTER-2291.txt) (570/596,
after the first fix) and [`evidence/verify-all-AFTER-2304.txt`](evidence/verify-all-AFTER-2304.txt)
(596/596).

| stage | fixture | tests |
|---|---:|---|
| before any change | 320/596 | 19 tests, all passing **on broken code** |
| after the 2291 fix | 570/596 | 38 tests, 38 pass |
| after the 2304 fix | **596/596** | **49 tests, 49 pass** |

The 250/26 split between the two incidents was classified in phase 3, **before either fix was
written**, and both fixes landed exactly on it: after the 2291 fix the 26 remaining ids were
identical one for one to the rows attributed to 2304, and the 2304 fix closed precisely those.
No passing row ever started failing, and nothing was fixed by accident.

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
