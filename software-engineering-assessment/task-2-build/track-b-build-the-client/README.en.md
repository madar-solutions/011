# Track B - build a client for the Helm Desk API

[بالعربية](README.en.md)

`api/` is a working support-desk backend. It has no interface. Your job is to build one:
a web app or a mobile app, your choice of stack.

What agents need to do with it:

- sign in;
- work an inbox of tickets - filter by status, filter to their own queue, search, page through it;
- open a ticket, read the thread, and reply;
- claim a ticket, and change its status or priority;
- attach a file to a reply;
- see the board change as other agents work, without reloading.

Endpoints and worked examples are in [`API_DOCS.en.md`](API_DOCS.en.md).

- `docker compose up` starts the API on http://localhost:4000.
- Sign in as `dana` / `ticket-desk-1`. Other accounts are listed in `API_DOCS.en.md`.
- Treat it as something you would put in front of real agents all day.
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

