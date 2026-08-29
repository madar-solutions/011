# Fenwick & Co. — storefront backend

[بالعربية](README.md)

`frontend/` is a finished shop with no backend. This repo adds one: session, catalogue, cart, coupons, card charges through [`payments-mock/`](payments-mock/README.en.md), and order history. The browser contract is [`API_NOTES.en.md`](API_NOTES.en.md). The full AI transcript is [`AI-CONVERSATION.md`](AI-CONVERSATION.md).

---

## How to run it

You need **Docker**. Not Node, Postgres, or Redis on the host.

### 1. From scratch — how a reviewer should start

```bash
cd software-engineering-assessment/task-2-build/track-a-build-the-api
docker compose down -v
docker compose up --build
```

`down -v` drops the Postgres and Redis volumes. That recreates `api-migrate`, which wipes the database and loads [`seed.json`](seed.json). Wait until `storefront` and `api` are healthy, then open:

**http://localhost:8080**

That port is the only entrance on the host. The API is not published on `:3000`; the browser calls `/api/...` and nginx proxies it.

### 2. Why the migrator wipes the database on purpose

`api-migrate` runs **`prisma migrate reset --force`**, not `migrate deploy`. That is intentional for this assessment, not a production shortcut and not an accident.

A previous trial leaves paid orders, decremented stock, and carts that are not in `seed.json`. `WELCOME` may be redeemed **once globally**; a leftover paid row spends it, and the reviewer is no longer looking at the shop the seed file describes. Reset-then-seed puts users, catalogue, and coupons back to the documented state.

`migrate reset` runs when the migrator container is **created** (clean clone, or after `down -v`). A later `docker compose up` without removing volumes keeps the data — useful mid-trial. To replay the first look: `down -v` then `up --build`.

A real production deploy would use `migrate deploy` and never drop data on boot. Here the opposite is deliberate so every review session matches the first.

### 3. Trial accounts and cards

| user | password |
|---|---|
| `salma` | `correct-horse-9` |
| `karim` | `hunter2-please` |

| PAN | behaviour |
|---|---|
| `4242 4242 4242 4242` | approved |
| `4000 0000 0000 0002` | declined |
| `4000 0000 0000 0069` | approved after ~9s (the shop aborts at 8s and retries with the same `X-Request-Id`) |
| `4000 0000 0000 0119` | gateway 500 |

### 4. Later start, keep data

```bash
docker compose up
```

### 5. Tests through the storefront origin

They hit `/api` via nginx, not the unpublished port:

```bash
docker compose --profile test run --rm --build api-e2e
```

### 6. Stop

```bash
docker compose down       # stop containers, keep volumes
docker compose down -v    # stop and wipe Postgres and Redis
```

No `.env` file is required. Every variable has a development default in `docker-compose.yml`. To override: `cp .env.example .env`. Those values are not production secrets; `JWT_SECRET` would come from the platform store outside this exercise.

---

## What changed in the `/api` reverse proxy

The provided `frontend/nginx.conf` only served the SPA. `frontend/Dockerfile` and `docker-entrypoint.sh` are untouched. nginx is now the **only way into the API**.

The browser would otherwise have called `http://localhost:3000` (`API_BASE_URL` as a host URL), which needs CORS between `:8080` and `:3000`. We reversed that:

- **`API_BASE_URL=/api`** — a **same-origin path**, not a host URL. `docker-entrypoint.sh` still writes it into `config.js`. The browser never makes a cross-origin request, so **there is no CORS policy**; it was not set to `"*"`, because an unused CORS policy is a permission granted for no reason.
- **`location /api/`** proxies to `api:3000`. **`rewrite ^/api/(.*)$ /$1 break`** strips the prefix so application routes stay exactly as `API_NOTES.md` documents them (`/auth/login`, `/products`, `/cart`) with no Nest global prefix. The proxy owns the mount point; the app does not know it is mounted.
- **The API is not published on the host.** Nothing can bypass nginx, including the developer's machine. Debug with `docker compose exec api ...`.
- **`resolver 127.0.0.11` and the upstream in a variable.** A literal `proxy_pass http://api:3000` resolves once at startup: nginx refuses to boot while `api` is down, then pins the first address it saw after the container is recreated. Per-request resolution keeps the storefront up while the API restarts; `/api` may 502 until the service is ready.
- **`proxy_ignore_client_abort on` and a 30s read timeout.** The shop aborts at 8s; test card `…0069` takes ~9s. Without this, nginx tears down the upstream request mid-charge. Double-charge safety is **idempotency** on `X-Request-Id`, not cancelling in-flight work. The API's gateway timeout is 15s — longer than the browser abort on purpose, so a charge already started is allowed to finish.

---

## Engineering decisions

**Stack.** NestJS + Prisma + PostgreSQL + Redis. Money is `DECIMAL` in the database and integer cents in process (`toCents` / `formatMoney`) so `89.50 * 0.1` never becomes a float. Passwords are bcrypt. Prices and stock on `POST /cart/items` and the checkout `summary` are **not trusted**; the catalogue is.

**Migrator as its own service.** `api-migrate` completes and exits. The API waits on `service_completed_successfully` so it never boots against a half-applied schema. The runtime image does not ship the Prisma CLI.

**Redis for the session and the charge key, not a disposable cache.** If `idempotency:{userId}:{requestId}` vanishes after a restart, a retried checkout can charge the card twice. Hence AOF and a persistent volume. The payments gateway is in-memory; it has no `restart: unless-stopped`, so an unattended restart cannot silently wipe the charge ledger we reconcile against.

**Checkout is a state machine, not SET NX alone.** `claimed` → lock the cart, decrement stock, insert `pending` → `reserved` → `/charge` → `charged` then `paid`. Two request ids at once: the first owns the cart (`FOR UPDATE`); the second does not get through. After the browser timeout we ask `GET /charges` by `reference` before releasing stock: an `approved` row finishes the order and does not restore. Restore is one transaction: `SELECT … FOR UPDATE` on the order row, and stock moves only while status is `pending`. `commitPaid` locks the same row so the two paths cannot both increment inventory.

**Coupons fail at apply time, not only at pay.** `WELCOME` counts `pending` and `paid` so it cannot be reserved twice. At commit the coupon row is locked and the count is taken again.

**Card at the door.** 16 digits, `MM/YY` not expired, CVC 3–4, before any gateway call.

**Service names `db` and `cache`.** They name the role, not the product; `DATABASE_URL` and `REDIS_URL` survive a later engine change.

**Healthchecks use `127.0.0.1`, not `localhost`.** Inside Alpine `localhost` resolves to `::1` first and nginx/the API listen on IPv4 only, so a healthy process is reported unhealthy.

---

## With another week

### Architecture

We would have drawn the boundaries that still live in one service: catalogue, cart, and checkout as the same state machine but with an outbox or gateway webhook instead of `GET /charges` on the request path, plus a periodic job for expired `pending` reservations. Two migrate paths: `migrate reset` for trials, `migrate deploy` behind `NODE_ENV=production` so a production container cannot drop customer data. Real secrets from the platform store, `requestId` carried from the browser through to the gateway log, and counters for `402` / `503` and stock races. OpenAPI matching `API_NOTES.md`.

### Quality and security

The current e2e proves the contract through nginx; a week would have treated tests as policy, not a happy-path list. Targeted security cases: missing bearer, expired token, oversized login body, injection in `q` beyond the one case we have, a card that must never reach the gateway, a coupon spent between apply and pay. The nginx comments that never became config: body cap, rate limits on `/auth/login` and `/orders`, hide `X-Powered-By`, `nosniff` / `frame-deny`. Dependency review and a runtime image with no build toolchain.

### Load

e2e covers two races (two request ids on one cart, `WELCOME` across users). Under load we would have proved: one unit of stock and many buyers, the same `X-Request-Id` after an 8s abort at hundreds of parallel clients, and card `…0069` with no double charge. A load tool (k6 or equivalent) against the storefront origin `/api`, not the unpublished API port, with a hard fail threshold rather than “felt fast”.

### Storefront, nginx, and search

The given shop is minified `dist/`; we already stopped a catalog redraw from wiping the search box. A week would have finished that surface, not left it at the one fix: debounce `q` so the catalog is not hit on every keystroke, a search header that does not empty on 401/network, and a clearer empty result. On nginx: compress static assets, `Cache-Control` for the SPA versus `no-store` on `config.js`, and cautious `gzip_types` for small JSON on `/api`. Search in the API stays parameterized, never concatenated SQL; `pg_trgm` or an index if the catalogue grew past the twenty rows in `seed.json`.

None of that blocks `docker compose up` from bringing up a working shop at http://localhost:8080.
