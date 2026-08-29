# Helm Desk API

[بالعربية](API_DOCS.en.md)

Base URL `http://localhost:4000`. JSON in, JSON out.
Everything except `/auth/login` and `/auth/refresh` takes `Authorization: Bearer <accessToken>`.

Errors look like this:

```json
{ "error": { "code": "SOMETHING", "message": "human readable" } }
```

## Accounts

| Username | Password | |
|---|---|---|
| `dana` | `ticket-desk-1` | busy queue |
| `omar` | `ticket-desk-2` | new starter |
| `rana` | `ticket-desk-3` | |
| `faris` | `ticket-desk-4` | |
| `nour` | `ticket-desk-5` | |

## Authentication

```
POST /auth/login
{ "username": "dana", "password": "ticket-desk-1" }

200
{ "accessToken": "...", "refreshToken": "...", "agent": { "id": "ag_dana", "name": "دانة العتيبي", "email": "dana@helm.example" } }
```

```
POST /auth/refresh
{ "refreshToken": "..." }

200
{ "accessToken": "..." }
```

```
GET /me
200 { "agent": { "id": "ag_dana", "name": "دانة العتيبي", "email": "dana@helm.example" } }
```

An access token does not last forever. `401 TOKEN_EXPIRED` says that it has run out;
`401 UNAUTHENTICATED` says the token is not one we issued.

## Tickets

```
GET /tickets?status=open&assignee=me&q=refund&cursor=t_04981&limit=25

200
{
  "items": [
    { "id": "t_05200", "subject": "المبلغ المُسترد لا يظهر في كشف الحساب", "customer": "آلتو للشحن",
      "status": "open", "priority": "urgent", "assigneeId": "ag_dana", "version": 4,
      "createdAt": "2026-08-16T03:17:04.457Z", "updatedAt": "2026-08-18T11:02:55.001Z" }
  ],
  "nextCursor": "t_04981",
  "total": 3187
}
```

`assignee` takes an agent id or `me`. `limit` is capped at 100. `nextCursor` is `null` on the
last page. Newest first.

```
GET /tickets/t_05200

200
ETag: "4"
{ "id": "t_05200", ..., "replies": [ { "id": "r_1", "authorId": null, "authorName": "آلتو للشحن",
  "body": "بدأت المشكلة يوم الثلاثاء...", "createdAt": "..." } ] }
```

```
PATCH /tickets/t_05200
If-Match: "4"
{ "status": "solved", "priority": "high" }

200
ETag: "5"
{ "id": "t_05200", "status": "solved", "version": 5, ... }
```

Accepts `status` (`open`, `pending`, `solved`), `priority` (`low`, `normal`, `high`, `urgent`),
`subject` and `assigneeId`. Without `If-Match` the request is refused with `428`.
If the `If-Match` value is not the ticket's current version the response is:

```
409
{ "error": { "code": "VERSION_CONFLICT", "message": "This ticket changed while you were editing it." },
  "ticket": { ... the ticket as it is now ... } }
```

```
POST /tickets/t_05200/claim

200  { "id": "t_05200", "assigneeId": "ag_dana", "version": 5, ... }
409  { "error": { "code": "ALREADY_CLAIMED", "message": "رنا تكريتي تعمل على هذا البلاغ بالفعل." },
       "ticket": { ... } }
```

```
POST /tickets/t_05200/replies
{ "body": "شكرًا لك — أعدتُ مبلغ ذلك البند وسيصلك خلال 3 إلى 5 أيام." }

201
{ "id": "r_9f2c1a04", "authorId": "ag_dana", "authorName": "دانة العتيبي", "body": "...", "createdAt": "..." }
```

## Agents

```
GET /agents/ag_rana        200 { "id": "ag_rana", "name": "رنا تكريتي", "email": "rana@helm.example" }
GET /agents               200 { "items": [ ... ] }
GET /agents?ids=ag_rana,ag_dana
```

## Attachments

```
POST /attachments
{ "filename": "screenshot.png", "contentType": "image/png", "data": "<base64>" }

201 { "id": "at_1b2c3d4e", "filename": "screenshot.png", "contentType": "image/png", "size": 81234 }
415 unsupported type - we accept image/png, image/jpeg, application/pdf, text/plain
413 too large - the limit is 5MB
```

## Live updates

```
GET /events
```

A `text/event-stream`. Events are `ticket.updated` (data: the ticket) and `ticket.reply`
(data: `{ ticketId, reply }`), each with an `id`.

```
id: 187
event: ticket.updated
data: {"id":"t_00042","status":"pending","version":7,...}
```

The stream accepts a `Last-Event-ID` request header.
On this endpoint only, the access token may also be passed as `?access_token=`.

## Rate limit

Sustained bursts are refused with `429` and a `Retry-After` header, in seconds.
