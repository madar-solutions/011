# Helm Desk API

[English](API_DOCS.en.md)

العنوان الأساسي `http://localhost:4000`. المدخلات والمخرجات بصيغة JSON.
كل شيء عدا `/auth/login` و`/auth/refresh` يتطلّب `Authorization: Bearer <accessToken>`.

شكل الأخطاء:

```json
{ "error": { "code": "SOMETHING", "message": "نصّ مفهوم للقارئ" } }
```

## الحسابات

| اسم المستخدم | كلمة المرور | |
|---|---|---|
| `dana` | `ticket-desk-1` | قائمة مزدحمة |
| `omar` | `ticket-desk-2` | موظف جديد |
| `rana` | `ticket-desk-3` | |
| `faris` | `ticket-desk-4` | |
| `nour` | `ticket-desk-5` | |

## المصادقة

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

رمز الوصول لا يدوم إلى الأبد. الاستجابة `401 TOKEN_EXPIRED` تعني أن مدّته انتهت،
و`401 UNAUTHENTICATED` تعني أن الرمز ليس مما أصدرناه.

## البلاغات

```
GET /tickets?status=open&assignee=me&q=استرداد&cursor=t_04981&limit=25

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

يقبل `assignee` معرّف موظف أو القيمة `me`. والحد الأقصى لـ `limit` هو 100.
وتكون قيمة `nextCursor` هي `null` في الصفحة الأخيرة. الترتيب من الأحدث إلى الأقدم.

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

يقبل الحقول `status` (`open`, `pending`, `solved`) و`priority` (`low`, `normal`, `high`, `urgent`)
و`subject` و`assigneeId`. وبدون `If-Match` يُرفض الطلب بالرمز `428`.
وإذا لم تطابق قيمة `If-Match` الإصدار الحالي للبلاغ تكون الاستجابة:

```
409
{ "error": { "code": "VERSION_CONFLICT", "message": "تغيّر هذا البلاغ أثناء تعديلك له." },
  "ticket": { ... البلاغ بحالته الحالية ... } }
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

## الموظفون

```
GET /agents/ag_rana        200 { "id": "ag_rana", "name": "رنا تكريتي", "email": "rana@helm.example" }
GET /agents                200 { "items": [ ... ] }
GET /agents?ids=ag_rana,ag_dana
```

## المرفقات

```
POST /attachments
{ "filename": "screenshot.png", "contentType": "image/png", "data": "<base64>" }

201 { "id": "at_1b2c3d4e", "filename": "screenshot.png", "contentType": "image/png", "size": 81234 }
415 نوع غير مدعوم — نقبل image/png و image/jpeg و application/pdf و text/plain
413 حجم كبير جدًا — الحدّ خمسة ميغابايت
```

## التحديثات الحيّة

```
GET /events
```

بثّ من نوع `text/event-stream`. الأحداث هي `ticket.updated` (البيانات: البلاغ)
و`ticket.reply` (البيانات: `{ ticketId, reply }`)، ولكل حدث معرّف `id`.

```
id: 187
event: ticket.updated
data: {"id":"t_00042","status":"pending","version":7,...}
```

يقبل البثّ ترويسة الطلب `Last-Event-ID`.
في هذه النقطة وحدها، يمكن تمرير رمز الوصول أيضًا عبر `?access_token=`.

## حدّ المعدّل

الاندفاعات المتواصلة تُرفض بالرمز `429` مع ترويسة `Retry-After` بالثواني.
