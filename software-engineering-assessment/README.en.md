# Software engineering assessment

[بالعربية](README.md)

Welcome. This repository is the assessment itself, and everything you need is in it.

It comes in two independent parts:

| | What | Time |
|---|---|---|
| **Part one** | fix a fault in a service that is already running | one hour |
| **Part two** | build an application — you pick one of two tracks | six hours, at home |

---

## Before you start

You need **Docker**, and nothing else. If you would rather run part one outside a container,
you also need **Node 22.5 or newer**.

There is no database to install, no external service to sign up for, and no internet needed
after the first build. Each service loads its data into memory at start-up, so every restart
gives you a clean system identical to the one before it.

---

## Part one — debugging · one hour

```bash
cd task-1-debugging
```

You get a service that runs the bookings for a small hotel, two open tickets raised against it
by hotel staff, log excerpts, and a fixture of 596 rows taken from the system that ran before it.

Read [`task-1-debugging/README.en.md`](task-1-debugging/README.en.md) — it has everything: how
to run the service, where the tickets are, and what to hand back.

---

## Part two — build · six hours at home

```bash
cd task-2-build
```

Pick **one track** only. Any language, framework and database you like.

### Track A — build the backend

We give you a finished storefront running in Docker with no backend behind it. You build it:
sign-in, catalogue, basket, coupons, checkout through a card processor we supply, and order
history.

**Details:** [`task-2-build/track-a-build-the-api/README.en.md`](task-2-build/track-a-build-the-api/README.en.md)

### Track B — build the client

We give you a working API for a support desk with thousands of tickets and a live event stream,
and no interface at all. You build one — a web app or a mobile app, your choice.

**Details:** [`task-2-build/track-b-build-the-client/README.en.md`](task-2-build/track-b-build-the-client/README.en.md)

---

## The AI transcript — required for both parts

Using AI tools is **entirely allowed** and costs you nothing.

If you used one for any part of the work, include an **`AI-CONVERSATION.md`** with each task,
holding the **complete transcript exactly as it happened**: every prompt you wrote and every
reply you got, in order, nothing deleted, summarised or tidied. If you used more than one tool
or more than one session, include them all under clear headings.

If you did not use AI at all, say so in one line in the same file.

We read it to understand how you think — when you take a suggestion and when you push back, and
why — not to penalise you for using the tool. Concealing that you used one, or handing in an
edited transcript, ends the assessment.

---

## What you hand back

| | |
|---|---|
| Part one | `FINDINGS.md` + your change + tests + `AI-CONVERSATION.md` |
| Part two | the code + a short `README.md` + `AI-CONVERSATION.md` |

Each task's README spells out its own deliverables. Commit as you go rather than handing
everything over in one lump.

For part two, `docker compose up` from a clean clone must bring up a working system. Treat that
as part of the task, not a detail on the side.

---

## Practical notes

**Ports.** Part one and Track A's backend both use port `3000`. Run them one at a time, or
change the port mapping in `docker-compose.yml` if you need both.

**Language.** Every document is Arabic, with an English version alongside under `.en.md` if that
is easier for you. Write your submission in Arabic or English, whichever is clearer for you.

**Time.** The stated durations are estimates, not stopwatches. If you run out, write down what
you would have done next; we prefer an honest unfinished submission to a rushed one.

**If something is unclear** in a brief or in how the system behaves, ask. And if you decide to
carry on under an assumption, write the assumption into your submission — that is perfectly
acceptable.

Good luck.
