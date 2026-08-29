import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { agents, buildTickets } from './seed.js';

const PORT = Number(process.env.PORT || 4000);
const ACCESS_TTL_MS = 90_000;

const tickets = buildTickets();
const byId = new Map(tickets.map((t) => [t.id, t]));
const accessTokens = new Map();   // token -> { agentId, expiresAt }
const refreshTokens = new Map();  // token -> agentId
const attachments = new Map();
const rateWindows = new Map();
const listeners = new Set();
let eventSeq = 0;
const eventLog = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ helpers */

const send = (res, status, payload, headers = {}) => {
  const body = payload === null ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'ETag,Retry-After',
    ...headers
  });
  res.end(body);
};

const fail = (res, status, code, message, headers) =>
  send(res, status, { error: { code, message } }, headers);

const readBody = (req, limit = 6 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) reject(Object.assign(new Error('too large'), { tooLarge: true }));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('bad json')); }
    });
  });

const publish = (type, data) => {
  const event = { id: String(++eventSeq), type, data };
  eventLog.push(event);
  if (eventLog.length > 500) eventLog.shift();
  for (const write of listeners) write(event);
};

const publicTicket = (t) => ({
  id: t.id, subject: t.subject, customer: t.customer, status: t.status,
  priority: t.priority, assigneeId: t.assigneeId, version: t.version,
  createdAt: t.createdAt, updatedAt: t.updatedAt
});

const publicAgent = (a) => ({ id: a.id, name: a.name, email: a.email });

/* ------------------------------------------------------------------- server */

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, null);

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/health') return send(res, 200, { status: 'ok', tickets: tickets.length });

  /* ---- authentication ---- */

  if (req.method === 'POST' && path === '/auth/login') {
    let body;
    try { body = await readBody(req); } catch { return fail(res, 400, 'BAD_REQUEST', 'Body must be JSON.'); }
    await sleep(250);
    const agent = agents.find((a) => a.username === body.username && a.password === body.password);
    if (!agent) return fail(res, 401, 'BAD_CREDENTIALS', 'Those details did not match an account.');
    const access = randomUUID();
    const refresh = randomUUID();
    accessTokens.set(access, { agentId: agent.id, expiresAt: Date.now() + ACCESS_TTL_MS });
    refreshTokens.set(refresh, agent.id);
    return send(res, 200, { accessToken: access, refreshToken: refresh, agent: publicAgent(agent) });
  }

  if (req.method === 'POST' && path === '/auth/refresh') {
    let body;
    try { body = await readBody(req); } catch { return fail(res, 400, 'BAD_REQUEST', 'Body must be JSON.'); }
    await sleep(400);
    const agentId = refreshTokens.get(body.refreshToken);
    if (!agentId) return fail(res, 401, 'BAD_REFRESH_TOKEN', 'That refresh token is not valid.');
    const access = randomUUID();
    accessTokens.set(access, { agentId, expiresAt: Date.now() + ACCESS_TTL_MS });
    return send(res, 200, { accessToken: access });
  }

  /* ---- everything below needs a live access token ---- */

  // EventSource cannot set headers, so the stream also accepts the token as a query parameter.
  const bearer =
    (req.headers.authorization || '').replace(/^Bearer /, '') ||
    (path === '/events' ? url.searchParams.get('access_token') || '' : '');
  const session = accessTokens.get(bearer);
  if (!session) return fail(res, 401, 'UNAUTHENTICATED', 'No valid access token.');
  if (session.expiresAt < Date.now()) {
    accessTokens.delete(bearer);
    return fail(res, 401, 'TOKEN_EXPIRED', 'The access token has expired.');
  }
  const me = agents.find((a) => a.id === session.agentId);

  /* ---- rate limit ---- */

  const now = Date.now();
  const window = rateWindows.get(bearer) || [];
  const recent = window.filter((t) => now - t < 10_000);
  recent.push(now);
  rateWindows.set(bearer, recent);
  if (recent.length > 30 && path !== '/events') {
    return fail(res, 429, 'RATE_LIMITED', 'Too many requests.', { 'Retry-After': '5' });
  }

  if (req.method === 'GET' && path === '/me') return send(res, 200, { agent: publicAgent(me) });

  if (req.method === 'GET' && path === '/agents') {
    const ids = url.searchParams.get('ids');
    const list = ids ? agents.filter((a) => ids.split(',').includes(a.id)) : agents;
    await sleep(120);
    return send(res, 200, { items: list.map(publicAgent) });
  }
  if (req.method === 'GET' && path.startsWith('/agents/')) {
    const agent = agents.find((a) => a.id === path.split('/')[2]);
    await sleep(300);
    return agent ? send(res, 200, publicAgent(agent)) : fail(res, 404, 'NOT_FOUND', 'No such agent.');
  }

  /* ---- ticket list ---- */

  if (req.method === 'GET' && path === '/tickets') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const status = url.searchParams.get('status');
    const assignee = url.searchParams.get('assignee');
    const cursor = url.searchParams.get('cursor');
    const limit = Math.min(Number(url.searchParams.get('limit') || 25), 100);

    await sleep(q ? 200 + Math.floor(Math.random() * 2300) : 150 + Math.floor(Math.random() * 250));

    let list = tickets;
    if (status) list = list.filter((t) => t.status === status);
    if (assignee) list = list.filter((t) => t.assigneeId === (assignee === 'me' ? me.id : assignee));
    if (q) list = list.filter((t) => (t.subject + ' ' + t.customer).toLowerCase().includes(q));

    list = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? 1 : -1));

    const start = cursor ? list.findIndex((t) => t.id === cursor) + 1 : 0;
    const page = list.slice(start, start + limit);
    const nextCursor = start + limit < list.length ? page[page.length - 1].id : null;

    return send(res, 200, { items: page.map(publicTicket), nextCursor, total: list.length });
  }

  /* ---- one ticket ---- */

  const ticketMatch = path.match(/^\/tickets\/([^/]+)(\/(replies|claim))?$/);
  if (ticketMatch) {
    const ticket = byId.get(ticketMatch[1]);
    if (!ticket) return fail(res, 404, 'NOT_FOUND', 'No such ticket.');
    const action = ticketMatch[3];

    if (req.method === 'GET' && !action) {
      await sleep(200);
      return send(res, 200, { ...publicTicket(ticket), replies: ticket.replies }, { ETag: `"${ticket.version}"` });
    }

    if (req.method === 'PATCH' && !action) {
      let body;
      try { body = await readBody(req); } catch { return fail(res, 400, 'BAD_REQUEST', 'Body must be JSON.'); }
      const ifMatch = (req.headers['if-match'] || '').replace(/"/g, '');
      if (!ifMatch) return fail(res, 428, 'IF_MATCH_REQUIRED', 'This request must carry an If-Match header.');
      if (Number(ifMatch) !== ticket.version) {
        return send(res, 409, { error: { code: 'VERSION_CONFLICT', message: 'This ticket changed while you were editing it.' }, ticket: publicTicket(ticket) });
      }
      await sleep(500);
      for (const field of ['status', 'priority', 'subject', 'assigneeId']) {
        if (field in body) ticket[field] = body[field];
      }
      ticket.version += 1;
      ticket.updatedAt = new Date().toISOString();
      publish('ticket.updated', publicTicket(ticket));
      return send(res, 200, publicTicket(ticket), { ETag: `"${ticket.version}"` });
    }

    if (req.method === 'POST' && action === 'claim') {
      await sleep(400);
      if (ticket.assigneeId && ticket.assigneeId !== me.id) {
        const holder = agents.find((a) => a.id === ticket.assigneeId);
        return send(res, 409, { error: { code: 'ALREADY_CLAIMED', message: `${holder ? holder.name : 'Another agent'} is already on this ticket.` }, ticket: publicTicket(ticket) });
      }
      ticket.assigneeId = me.id;
      ticket.version += 1;
      ticket.updatedAt = new Date().toISOString();
      publish('ticket.updated', publicTicket(ticket));
      return send(res, 200, publicTicket(ticket));
    }

    if (req.method === 'POST' && action === 'replies') {
      let body;
      try { body = await readBody(req); } catch { return fail(res, 400, 'BAD_REQUEST', 'Body must be JSON.'); }
      if (!body.body || String(body.body).trim() === '') {
        return fail(res, 422, 'EMPTY_REPLY', 'A reply needs some text.');
      }
      await sleep(1600 + Math.floor(Math.random() * 900));
      if (Math.random() < 0.1) return fail(res, 500, 'INTERNAL', 'Something went wrong on our side.');

      const reply = { id: 'r_' + randomUUID().slice(0, 8), authorId: me.id, authorName: me.name, body: String(body.body), createdAt: new Date().toISOString() };
      ticket.replies.push(reply);
      ticket.version += 1;
      ticket.updatedAt = reply.createdAt;
      publish('ticket.reply', { ticketId: ticket.id, reply });
      return send(res, 201, reply);
    }
  }

  /* ---- attachments ---- */

  if (req.method === 'POST' && path === '/attachments') {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return error.tooLarge
        ? fail(res, 413, 'TOO_LARGE', 'Attachments are limited to 5MB.')
        : fail(res, 400, 'BAD_REQUEST', 'Body must be JSON.');
    }
    const allowed = ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'];
    if (!allowed.includes(body.contentType)) {
      return fail(res, 415, 'UNSUPPORTED_TYPE', `We accept ${allowed.join(', ')}.`);
    }
    const size = String(body.data || '').length;
    if (size > 5 * 1024 * 1024) return fail(res, 413, 'TOO_LARGE', 'Attachments are limited to 5MB.');
    await sleep(900 + Math.floor(size / 4000));
    const id = 'at_' + randomUUID().slice(0, 8);
    attachments.set(id, { id, filename: body.filename, contentType: body.contentType, size });
    return send(res, 201, attachments.get(id));
  }

  /* ---- event stream ---- */

  if (req.method === 'GET' && path === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const lastId = Number(req.headers['last-event-id'] || url.searchParams.get('lastEventId') || 0);
    for (const event of eventLog.filter((e) => Number(e.id) > lastId)) {
      res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }

    const write = (event) => res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    listeners.add(write);

    const drop = setTimeout(() => { listeners.delete(write); res.end(); }, 55_000 + Math.floor(Math.random() * 10_000));
    req.on('close', () => { clearTimeout(drop); listeners.delete(write); });
    return;
  }

  fail(res, 404, 'NOT_FOUND', 'No such endpoint.');
}).listen(PORT, () => console.log(`helm-desk api on :${PORT} (${tickets.length} tickets)`));

/* Other agents keep working while you do. */
setInterval(() => {
  const ticket = tickets[Math.floor(Math.random() * 400)];
  const other = agents[1 + Math.floor(Math.random() * (agents.length - 1))];
  ticket.status = ticket.status === 'open' ? 'pending' : 'open';
  ticket.assigneeId = Math.random() < 0.35 ? other.id : ticket.assigneeId;
  ticket.version += 1;
  ticket.updatedAt = new Date().toISOString();
  publish('ticket.updated', publicTicket(ticket));
}, 12_000);
