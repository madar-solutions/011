# Track A - build the storefront's backend

[بالعربية](README.en.md)

`frontend/` is a finished storefront. It has no backend. Your job is to build one.

- It must serve the calls in [`API_NOTES.en.md`](API_NOTES.en.md).
- Load [`seed.json`](seed.json) - those are the customers, the catalogue and the coupons.
- Take card payments through the processor in [`payments-mock/`](payments-mock/README.en.md).
- Any language, framework and database you like.
- Add your services to `docker-compose.yml`. `docker compose up` from a clean clone must bring
  up a working shop at http://localhost:8080.
- Treat it as code you would put into production and hand to a team.
- Include a short README: how to run it, what you decided, and what you would do with more time.

Budget **six hours**, worked at home. Commit as you go.

## If you used AI

Using AI tools is **entirely allowed** and costs you nothing.

If you used one for any part of this, include **`AI-CONVERSATION.md`** holding the
**complete transcript exactly as it happened**: every prompt you wrote and every reply you
got, in order, nothing deleted, summarised or tidied. If you used more than one tool or more
than one session, include them all under clear headings.

If you did not use AI at all, say so in one line in the same file.

We read it to understand how you think — when you take a suggestion and when you push back,
and why — not to penalise you for using the tool. Concealing that you used one, or handing in
an edited transcript, ends the assessment.


## Running the parts we gave you

```bash
docker compose up
```

The storefront is at http://localhost:8080 and talks to whatever `API_BASE_URL` points at
(`http://localhost:3000` by default). The payment processor is at http://localhost:9090.
