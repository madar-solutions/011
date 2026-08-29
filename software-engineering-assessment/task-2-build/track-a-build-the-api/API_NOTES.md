# ما يطلبه المتجر

[English](API_NOTES.en.md)

المتجر في مجلّد `frontend/` مبنيّ بالفعل. هذه هي الاستدعاءات التي يقوم بها، مكتوبة كأمثلة
مأخوذة من جلسة عمل حقيقية. وما لا يظهر هنا فهو لا يستخدمه.

كل طلب — عدا `POST /auth/login` — يحمل الترويسة `Authorization: Bearer <token>`.
الاستجابات بصيغة JSON.

## الأخطاء

أي استجابة ليست من الفئة 2xx يُتوقّع أن تكون بهذا الشكل. ويعرض المتجر قيمة `error.message`
للعميل كما هي.

```json
{ "error": { "code": "SOMETHING", "message": "عذرًا، انتهت صلاحية كود الخصم." } }
```

استجابة `401` من أي نقطة نهاية تُخرج العميل من الجلسة وتعيده إلى شاشة الدخول.

---

## تسجيل الدخول

```
POST /auth/login
{ "username": "salma", "password": "correct-horse-9" }

200
{ "token": "...", "user": { "id": "u_salma", "username": "salma", "displayName": "سلمى الحسيني" } }
```

```
GET /auth/session

200
{ "user": { "id": "u_salma", "username": "salma", "displayName": "سلمى الحسيني" } }
```

```
POST /auth/logout
{}

200
{}
```

يستدعي المتجر `GET /auth/session` عند التحميل، و`POST /auth/logout` من القائمة.

---

## المنتجات

```
GET /products
GET /products?q=إبريق

200
{
  "items": [
    { "id": "p_002", "sku": "KTL-COP-02", "name": "إبريق تقطير نحاسي", "category": "kitchen",
      "price": "89.50", "stock": 12, "imageUrl": "/img/kettle.jpg", "description": "فوهة رفيعة منحنية، سعة لتر واحد." }
  ]
}
```

```
GET /products/p_002

200
{ "id": "p_002", "sku": "KTL-COP-02", "name": "إبريق تقطير نحاسي", ... }
```

---

## السلة

```
GET /cart

200
{
  "items": [
    { "id": "ci_7", "productId": "p_002", "sku": "KTL-COP-02", "name": "إبريق تقطير نحاسي",
      "price": "89.50", "quantity": 2 }
  ],
  "coupon": "SAVE10",
  "discount": "17.90"
}
```

الحقل `items[].id` هو سطر السلة، لا المنتج. ويستخدمه المتجر مع `PATCH` و`DELETE`.
ويكون `coupon` بقيمة `null` و`discount` بقيمة `"0.00"` عند عدم وجود كود خصم.

عند إضافة منتج يرسل المتجر المنتج كما استلمه من `GET /products`، مع إضافة الكمية:

```
POST /cart/items
{ "id": "p_002", "sku": "KTL-COP-02", "name": "إبريق تقطير نحاسي", "category": "kitchen",
  "price": "89.50", "stock": 12, "imageUrl": "/img/kettle.jpg", "description": "فوهة رفيعة منحنية، سعة لتر واحد.",
  "quantity": 1 }

201
{ "id": "ci_7" }
```

```
PATCH /cart/items/ci_7
{ "quantity": 3 }

200
{ "id": "ci_7", "quantity": 3 }
```

```
DELETE /cart/items/ci_7

204
```

```
POST /cart/coupon
{ "code": "SAVE10" }

200
{ "coupon": "SAVE10", "discount": "17.90" }
```

---

## إتمام الشراء

```
POST /orders
X-Request-Id: 6d1f0e7c-1d2a-4a1e-9a1c-4b7f5a2e0c11

{
  "coupon": "SAVE10",
  "card": { "name": "سلمى الحسيني", "number": "4242424242424242", "expiry": "12/29", "cvc": "123" },
  "summary": { "subtotal": "179.00", "discount": "17.90", "total": "161.10" }
}

201
{ "id": "o_1042", "status": "paid", "total": "161.10", "createdAt": "2026-08-19T10:14:02Z" }
```

الحقل `summary` هو ما رآه العميل على شاشة الدفع. والترويسة `X-Request-Id` يولّدها المتجر
وترافق الطلب.

بعد نجاح الشراء ينتقل المتجر بالعميل إلى `#/orders/{id}`.

---

## الطلبات

```
GET /orders

200
{
  "items": [
    { "id": "o_1042", "status": "paid", "total": "161.10", "createdAt": "2026-08-19T10:14:02Z" }
  ]
}
```

```
GET /orders/o_1042

200
{
  "id": "o_1042",
  "status": "paid",
  "total": "161.10",
  "createdAt": "2026-08-19T10:14:02Z",
  "items": [
    { "productId": "p_002", "name": "إبريق تقطير نحاسي", "quantity": 2, "price": "89.50" }
  ]
}
```

صفحة الطلب عنوان عادي: `http://localhost:8080/#/orders/o_1042`.
