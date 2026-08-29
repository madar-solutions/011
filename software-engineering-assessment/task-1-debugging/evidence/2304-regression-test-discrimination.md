# Ticket 2304 — regression test discrimination matrix

`tests/regression-2304-occupancy.test.js`, 11 tests, run against the current code and
against each of the three quick fixes rejected in phase 4.

| code under test | fixture | regression tests | still failing |
|---|---:|---|---|
| current | 570/596 | **3 pass / 8 fail** | – |
| D1 `availabilityRepo` only | 590/596 | **6 pass / 5 fail** | cancelled ×2, **surfaces disagree**, extend ×2 |
| D2 both predicates | 592/596 | **7 pass / 4 fail** | cancelled ×2, extend ×2 |
| **D3 predicates + status** | **594/596** | **9 pass / 2 fail** | **extend ×2** |

The three guard tests pass on every variant including the unfixed code, which is what
guards are for.

## The assertion that catches D1

D1 scores 590/596 and the ticket's headline symptom disappears. One test message states
the whole remaining defect:

```
not ok 8 - 2304: what availability offers, the booking endpoint sells
    availability offered 1 room(s) and the booking was refused with 409
```

Before D1 the screen hid a sellable room; after D1 it offers a room the system then
refuses to sell. The contradiction was reversed, not removed, and this assertion is the
only thing in the suite that looks at both surfaces in one test.

## The two tests that catch D3

D3 scores 594/596 with every AVAIL and CREATE row green. What it leaves is the ticket's
second paragraph — the guest who cannot extend their own booking — and only these two
tests refuse it:

```
not ok  9 - 2304: a guest can extend their own booking
not ok 10 - 2304: a guest can shorten their own booking
```

## Suite totals

`npm test` goes from 38 tests to **49**: 41 pass, 8 fail, every failure from the new file.
Neither the 19 pre-existing tests nor the 19 tests from the 2291 fix are disturbed.
