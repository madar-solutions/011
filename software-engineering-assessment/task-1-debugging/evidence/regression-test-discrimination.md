# Regression tests — discrimination matrix

`tests/regression-2291-nightly-rates.test.js`, 19 tests, run against the current code
and against each of the three quick fixes rejected in phase 4.

| code under test | reference fixture | regression tests | verdict |
|---|---:|---|---|
| current (unfixed) | 320/596 | **3 pass / 16 fail** | baseline |
| candidate 1 `date < segmentEnd` | 20/596 | **1 pass / 18 fail** — breaks all 3 guards | rejected |
| **candidate 2 `addDays(end_date,-1)`** | **481/596** | **10 pass / 9 fail** | **rejected** |
| candidate 3 `slice(0, diffDays)` | 320/596 | **3 pass / 16 fail** | rejected |

Candidate 2 is the important row. It closes ticket 2291 completely — the whole
boundary-duplication block goes green, correctly — and nine tests still refuse it,
because it leaves the system giving nights away for free and accepting bookings it
cannot price. That is the difference between a regression test for the TICKET and a
regression test for the ROOT CAUSE.

## Current code — per-test status
```
FAIL  1 - 2291: RES-10842 — DLX 2026-08-28..2026-09-03 is six nights, not seven
FAIL  2 - 2291: no date is priced twice — the boundary night belongs to exactly one season
FAIL  3 - 2291: the priced nights are exactly the nights slept, in order
FAIL  4 - 2291: a stay whose ARRIVAL falls on a season boundary is one night
FAIL  5 - 2291: crossing two boundaries adds two duplicates, so it must be caught too
PASS  6 - 2291 guard: a single-season stay is unchanged
PASS  7 - 2291 guard: a one-night stay still costs one night
PASS  8 - 2291 guard: a stay ending exactly on a boundary is unchanged
FAIL  9 - 2291/B1: a night with no tariff is never invented
FAIL  10 - 2291/B1: a stay straddling a gap is refused, not silently short-billed
FAIL  11 - 2291/B1: a stay beyond the end of the rate calendar is refused
FAIL  12 - 2291/B1: the rate preview refuses an unpriced range as well
FAIL  13 - 2291/B2: a zero-night stay is refused, not billed a resort fee
FAIL  14 - 2291/B2: a reversed date range is refused
FAIL  15 - 2291/B3: an unknown room type is refused, not quoted at 15.00
FAIL  16 - 2291/B4: a stay longer than 180 nights is refused (SPEC.md 2)
FAIL  17 - 2291: /availability stops contradicting itself
FAIL  18 - 2291: the folio carries one room line per night slept and the right balance
FAIL  19 - 2291: a stay that cannot be priced cannot be booked either
```

The clearest failure message prints the mechanism itself:

```
a date was priced more than once:
  2026-08-28 2026-08-29 2026-08-30 2026-08-31 2026-09-01 2026-09-01 2026-09-02
```

## Note on the pre-existing suite

All 19 pre-existing tests pass on the broken code. Every pricing test uses a stay
inside a single season, so none of them ever crosses a season boundary — including
the one literally named "the departure date is not charged as a night", which
checks a one-night February stay. Full green was never coverage; the gap was in case
selection, not in test count. `npm test` now reports 38 tests, 22 pass, 16 fail —
every failure from the new file, no pre-existing test disturbed.
