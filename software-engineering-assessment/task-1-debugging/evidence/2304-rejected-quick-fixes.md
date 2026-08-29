# Ticket 2304 — measured outcome of each rejected quick fix

Each candidate applied to an isolated copy of `src/` outside the repository and mounted
over the reference image; the working tree was never modified. Baseline after the 2291
fix: **570/596**.

| candidate | change | fixture | rows left | verdict |
|---|---|---:|---|---|
| baseline | – | 570/596 | 26 | – |
| **D1** | `availabilityRepo` SQL only — the file the incident log names | **590/596** | A0479 A0487 E0593 E0594 **C0581 C0582** | **inverts the contradiction** |
| D2 | both overlap predicates | 592/596 | A0479 A0487 E0593 E0594 | ignores SPEC 5 |
| **D3** | both predicates + status filter | **594/596** | E0593 E0594 | **looks finished** |

## D1 is the trap, and it makes the product worse

D1 corrects the SQL that `logs/incident-2304.log` points straight at:

```
2026-08-19T08:12:03Z DEBUG availabilityRepo.countOverlapping roomType=STD booked=6 rooms=6
```

It repairs 20 of the 26 rows and the ticket's literal complaint disappears. But
`reservationService` holds a second, parallel copy of the same predicate, which D1 does
not touch. So the split brain is not removed — it is **reversed**:

```
BEFORE   GET  /availability STD 2026-11-10..11-12  -> available = 0   "sold out"
         POST /reservations same dates             -> 201 Created

AFTER D1 GET  /availability STD 2026-11-10..11-12  -> available = 1   "one room free"
         POST /reservations same dates             -> 409 NO_ROOMS_AVAILABLE
```

Before the fix the screen hid a sellable room. After D1 the screen offers a room and the
system then refuses to sell it. D. Ferrand'\''s report — "we turn customers away and lose
bookings" — is not only unfixed, it now happens **after** the guest has been told the room
is available. Fixture rows C0581 and C0582 catch it exactly: `available=1;create=status=4xx`.

## D3 is the second trap

594/596, every AVAIL and CREATE row green. It leaves only E0593/E0594 — which are the
**second paragraph of the same ticket**: the guest who cannot extend their own booking.
A fix that closes the headline and leaves the reporter'\''s second complaint open is not a
closed ticket. D3 also leaves two parallel implementations of one rule, which is the
condition that produced this incident in the first place.

## Candidate D1 — raw output
```

> riverside-pms@2.4.1 verify
> node --no-warnings=ExperimentalWarning scripts/verify.js


  590/596 rows match the reference system

  AVAIL: 2 mismatched
    A0479  SUI 2026-10-05..2026-10-09
        expected available=1;total=1269.40
        actual   available=0;total=1269.40
    A0487  DLX 2026-10-14..2026-10-18
        expected available=1;total=754.20
        actual   available=0;total=754.20

  EXTEND: 2 mismatched
    E0593  RES-11150 2026-12-02..2026-12-07
        expected status=2xx
```

## Candidate D2 — raw output
```

> riverside-pms@2.4.1 verify
> node --no-warnings=ExperimentalWarning scripts/verify.js


  592/596 rows match the reference system

  AVAIL: 2 mismatched
    A0479  SUI 2026-10-05..2026-10-09
        expected available=1;total=1269.40
        actual   available=0;total=1269.40
    A0487  DLX 2026-10-14..2026-10-18
        expected available=1;total=754.20
        actual   available=0;total=754.20

  EXTEND: 2 mismatched
    E0593  RES-11150 2026-12-02..2026-12-07
        expected status=2xx
```

## Candidate D3 — raw output
```

> riverside-pms@2.4.1 verify
> node --no-warnings=ExperimentalWarning scripts/verify.js


  594/596 rows match the reference system

  EXTEND: 2 mismatched
    E0593  RES-11150 2026-12-02..2026-12-07
        expected status=2xx
        actual   status=4xx
    E0594  RES-11150 2026-12-02..2026-12-04
        expected status=2xx
        actual   status=4xx


```

