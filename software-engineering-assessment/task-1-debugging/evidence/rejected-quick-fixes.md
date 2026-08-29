# Measured outcome of each rejected quick-fix

Each candidate was applied to an ISOLATED COPY of src/ outside the repository and
mounted over the reference image; the working tree was never modified:

```
docker compose run --rm -v <copy>:/app/src pms npm run verify
```

| candidate | change | fixture | verdict |
|---|---|---:|---|
| baseline | - | 320/596 | - |
| 1 | loop end exclusive (`date < segmentEnd`) | **20/596** | destroys the system |
| 2 | `minDate(lastNight, addDays(season.end_date, -1))` | **481/596** | closes the ticket, keeps leaking money |
| 3 | `nights.slice(0, diffDays(checkIn, checkOut))` | **320/596** | right count, wrong money |

## Candidate 1 — raw output (first 25 lines)
```

> riverside-pms@2.4.1 verify
> node --no-warnings=ExperimentalWarning scripts/verify.js


  20/596 rows match the reference system

  QUOTE: 391 mismatched
    Q0001  STD 2026-01-02..2026-01-03
        expected nights=1;total=115.80
        actual   nights=0;total=15.00
    Q0002  DLX 2026-01-05..2026-01-07
        expected nights=2;total=328.60
        actual   nights=1;total=171.80
    Q0003  SUI 2026-01-08..2026-01-11
        expected nights=3;total=821.40
        actual   nights=2;total=552.60
    Q0004  STD 2026-01-11..2026-01-15
        expected nights=4;total=418.20
        actual   nights=3;total=317.40
    Q0005  DLX 2026-01-14..2026-01-19
        expected nights=5;total=799.00
        actual   nights=4;total=642.20
```

## Candidate 2 — raw output (first 25 lines)
```

> riverside-pms@2.4.1 verify
> node --no-warnings=ExperimentalWarning scripts/verify.js


  481/596 rows match the reference system

  QUOTE: 78 mismatched
    Q0168  STD 2026-12-03..2026-12-24
        expected status=4xx
        actual   nights=17;total=2109.40
    Q0170  SUI 2026-12-13..2026-12-21
        expected status=4xx
        actual   nights=7;total=2210.20
    Q0171  STD 2026-12-18..2026-12-31
        expected status=4xx
        actual   nights=6;total=1202.20
    Q0172  DLX 2026-12-23..2027-01-13
        expected status=4xx
        actual   nights=7;total=2445.40
    Q0174  STD 2027-01-02..2027-01-10
        expected status=4xx
        actual   nights=1;total=250.20
```

## Candidate 3 — raw output (first 25 lines)
```

> riverside-pms@2.4.1 verify
> node --no-warnings=ExperimentalWarning scripts/verify.js


  320/596 rows match the reference system

  QUOTE: 222 mismatched
    Q0049  STD 2026-05-26..2026-06-06
        expected nights=11;total=1431.80
        actual   nights=11;total=1370.20
    Q0050  DLX 2026-05-29..2026-06-12
        expected nights=14;total=3072.60
        actual   nights=14;total=2994.20
    Q0051  SUI 2026-06-01..2026-06-02
        expected nights=1;total=418.20
        actual   nights=1;total=283.80
    Q0079  STD 2026-08-24..2026-09-04
        expected nights=11;total=1952.60
        actual   nights=11;total=1902.20
    Q0080  DLX 2026-08-27..2026-09-10
        expected nights=14;total=3795.00
        actual   nights=14;total=3979.80
```

