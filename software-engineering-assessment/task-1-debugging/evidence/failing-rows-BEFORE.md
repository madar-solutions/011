# Reference-fixture baseline — BEFORE any fix

Command (node/npm are not installed locally; this is the reference image from `README.md`):

```
docker compose run --rm pms npm run verify
docker compose run --rm pms npm run verify -- QUOTE
```

| run | result |
|---|---|
| `npm run verify` | **`320/596 rows match the reference system`** ⇒ **276 mismatched** |
| `npm run verify -- QUOTE` | **`173/395 rows match`** ⇒ **222 mismatched** |

| kind | rows | mismatched | passing |
|---|---:|---:|---:|
| QUOTE | 395 | **222** | 173 |
| PREVIEW | 60 | **19** | 41 |
| AVAIL | 117 | **27** | 90 |
| FORECAST | 8 | **0** | 8 |
| EXTEND | 4 | **2** | 2 |
| CREATE | 9 | **6** | 3 |
| CREATE_GUESTS | 2 | **0** | 2 |
| CREATE_LONG | 1 | **0** | 1 |
| **total** | **596** | **276** | **320** |

## Grouped by cause

Grouping is computed from the **component that actually differs** (`available=` vs `total=`/`nights=`), not guessed from the dates.

| cause | rows |
|---|---:|
| **A — duplicated season-boundary night** | 161 |
| **B1 — stay touching an unpriced night is priced instead of refused** | 85 |
| **B2 — non-positive stay length accepted (`checkOut <= checkIn`)** | 2 |
| **B3 — unknown room type quoted** (returns a 15.00 resort fee for a room that does not exist) | 1 |
| **B4 — 180-night maximum not enforced** | 1 |
| **D — availability treats a half-open range as closed / no self-exclusion** | 26 |
| **total** | **276** |


### **A — duplicated season-boundary night** · ticket 2291 · `pricingService.js:20` — 161 rows

- **QUOTE** (144): `Q0049 Q0050 Q0051 Q0079 Q0080 Q0084 Q0128 Q0130 Q0131 Q0147 Q0148 Q0150 Q0181 Q0182 Q0183 Q0184 Q0185 Q0186 Q0187 Q0188 Q0189 Q0190 Q0191 Q0192 Q0193 Q0194 Q0195 Q0196 Q0197 Q0198 Q0199 Q0200 Q0201 Q0202 Q0203 Q0204 Q0205 Q0206 Q0207 Q0208 Q0209 Q0210 Q0211 Q0212 Q0213 Q0214 Q0215 Q0216 Q0217 Q0218 Q0219 Q0220 Q0221 Q0222 Q0223 Q0224 Q0225 Q0226 Q0227 Q0228 Q0229 Q0230 Q0231 Q0232 Q0233 Q0234 Q0235 Q0236 Q0237 Q0238 Q0239 Q0240 Q0241 Q0242 Q0243 Q0244 Q0245 Q0246 Q0247 Q0248 Q0249 Q0250 Q0251 Q0252 Q0253 Q0254 Q0255 Q0256 Q0257 Q0258 Q0259 Q0260 Q0261 Q0262 Q0263 Q0264 Q0265 Q0266 Q0267 Q0268 Q0269 Q0270 Q0271 Q0272 Q0273 Q0274 Q0275 Q0276 Q0277 Q0278 Q0279 Q0280 Q0281 Q0282 Q0283 Q0284 Q0285 Q0286 Q0287 Q0288 Q0361 Q0362 Q0363 Q0364 Q0365 Q0366 Q0367 Q0368 Q0369 Q0370 Q0371 Q0372 Q0373 Q0374 Q0375 Q0379 Q0380 Q0381 Q0382 Q0383 Q0384 Q0385 Q0386 Q0387`
- **PREVIEW** (11): `P0542 P0543 P0558 P0559 P0560 P0561 P0562 P0563 P0564 P0565 P0566`
- **AVAIL** (6): `A0435 A0436 A0437 A0507 A0508 A0509`

| id | case | expected | actual |
|---|---|---|---|
| `Q0049` | QUOTE STD 2026-05-26..2026-06-06 | `nights=11;total=1431.80` | `nights=12;total=1532.60` |
| `Q0050` | QUOTE DLX 2026-05-29..2026-06-12 | `nights=14;total=3072.60` | `nights=15;total=3229.40` |
| `Q0051` | QUOTE SUI 2026-06-01..2026-06-02 | `nights=1;total=418.20` | `nights=2;total=687.00` |

### **B1 — stay touching an unpriced night is priced instead of refused** · `SPEC §3` · same root cause — 85 rows

- **QUOTE** (74): `Q0168 Q0170 Q0171 Q0172 Q0174 Q0175 Q0176 Q0177 Q0178 Q0179 Q0180 Q0289 Q0290 Q0291 Q0292 Q0293 Q0294 Q0295 Q0296 Q0297 Q0298 Q0299 Q0300 Q0301 Q0302 Q0303 Q0304 Q0305 Q0306 Q0307 Q0308 Q0309 Q0310 Q0311 Q0312 Q0313 Q0314 Q0315 Q0316 Q0317 Q0318 Q0319 Q0320 Q0321 Q0322 Q0323 Q0324 Q0334 Q0335 Q0336 Q0337 Q0338 Q0339 Q0340 Q0341 Q0342 Q0343 Q0344 Q0345 Q0346 Q0347 Q0348 Q0349 Q0350 Q0351 Q0352 Q0353 Q0354 Q0355 Q0356 Q0357 Q0358 Q0359 Q0360`
- **PREVIEW** (8): `P0555 P0556 P0567 P0568 P0569 P0570 P0571 P0572`
- **AVAIL** (2): `A0454 A0455`
- **CREATE** (1): `C0588`

| id | case | expected | actual |
|---|---|---|---|
| `Q0168` | QUOTE STD 2026-12-03..2026-12-24 | `status=4xx` | `nights=18;total=2232.60` |
| `Q0170` | QUOTE SUI 2026-12-13..2026-12-21 | `status=4xx` | `nights=8;total=2523.80` |
| `Q0171` | QUOTE STD 2026-12-18..2026-12-31 | `status=4xx` | `nights=7;total=1325.40` |

### **B2 — non-positive stay length accepted (`checkOut <= checkIn`)** · `SPEC §2` · same root cause — 2 rows

- **QUOTE** (2): `Q0388 Q0389`

| id | case | expected | actual |
|---|---|---|---|
| `Q0388` | QUOTE DLX 2026-09-03..2026-08-28 | `status=4xx` | `nights=0;total=15.00` |
| `Q0389` | QUOTE DLX 2026-08-28..2026-08-28 | `status=4xx` | `nights=0;total=15.00` |

### **B3 — unknown room type quoted** (returns a 15.00 resort fee for a room that does not exist) · same root cause — 1 rows

- **QUOTE** (1): `Q0394`

| id | case | expected | actual |
|---|---|---|---|
| `Q0394` | QUOTE XXX 2026-08-28..2026-09-03 | `status=4xx` | `nights=0;total=15.00` |

### **B4 — 180-night maximum not enforced** · `SPEC §2` — 1 rows

- **QUOTE** (1): `Q0393`

| id | case | expected | actual |
|---|---|---|---|
| `Q0393` | QUOTE DLX 2026-01-01..2027-12-31 | `status=4xx` | `nights=365;total=70272.60` |

### **D — availability treats a half-open range as closed / no self-exclusion** · ticket 2304 · `reservationService.js:11`, `availabilityRepo` — 26 rows

- **AVAIL** (19): `A0405 A0456 A0459 A0462 A0465 A0468 A0471 A0474 A0479 A0482 A0485 A0487 A0490 A0494 A0497 A0500 A0501 A0505 A0511`
- **EXTEND** (2): `E0593 E0594`
- **CREATE** (5): `C0581 C0582 C0583 C0584 C0585`

| id | case | expected | actual |
|---|---|---|---|
| `A0405` | AVAIL STD 2026-02-27..2026-03-02 | `available=6;total=317.40` | `available=5;total=317.40` |
| `A0456` | AVAIL STD 2026-11-10..2026-11-12 | `available=1;total=261.40` | `available=0;total=261.40` |
| `A0459` | AVAIL STD 2026-11-10..2026-11-11 | `available=2;total=138.20` | `available=0;total=138.20` |

---

### Note on ticket 2291's own booking

The fixture replays RES-10842 (`DLX 2026-08-28..2026-09-03`) through the availability
surface, `A0508`:

| id | case | expected | actual |
|---|---|---|---|
| `A0508` | AVAIL DLX 2026-08-28..2026-09-03 | `available=2;total=1594.20` | `available=2;total=1829.40` |

`1829.40 - 1594.20 = 235.20` — exactly the overcharge derived by hand in phase 2, and
exactly the amount the front office has been refunding manually. Note `available=2`
matches on both sides, so this row isolates the pricing defect from ticket 2304.
