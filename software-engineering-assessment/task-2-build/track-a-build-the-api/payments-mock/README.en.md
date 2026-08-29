# payments-mock

[بالعربية](README.en.md)

A stand-in for the card processor. It behaves like the sandbox of a real gateway:
deterministic test cards, real-ish latency, and a running list of everything it charged.

    POST /charge
    { "amount": "42.00", "card": { "number": "4242424242424242", "expiry": "12/29", "cvc": "123", "name": "A Nakamura" }, "reference": "your reference for reconciliation" }

    200 { "status": "approved", "chargeId": "ch_...", "amount": "42.00", "reference": "..." }
    402 { "status": "declined", "reason": "card_declined", "chargeId": "ch_..." }

`reference` is optional and is echoed back on the response and stored against the charge.
Use it to tie a charge to a record on your side when you reconcile.

    GET /charges    everything this instance has charged, newest last
    GET /health

## Test cards

| Number | Behaviour |
|---|---|
| `4242 4242 4242 4242` | approved |
| `4000 0000 0000 0002` | declined |
| `4000 0000 0000 0069` | approved, but the processor takes about nine seconds to answer |
| `4000 0000 0000 0119` | the processor returns a 500 |

Any other number is approved. Every call takes 200-600ms before any of the above applies.
State is in memory and is lost when the container restarts.
