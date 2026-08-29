import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 9090);
const charges = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const last4 = (card) => String(card || '').replace(/\D/g, '').slice(-4);

const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
  });

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok' });

  if (req.method === 'GET' && req.url === '/charges') {
    return send(res, 200, { charges });
  }

  if (req.method === 'POST' && req.url === '/charge') {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return send(res, 400, { error: 'invalid_request', message: 'Body must be JSON' });
    }

    const { amount, card, reference } = body;
    if (amount === undefined || card === undefined) {
      return send(res, 400, { error: 'invalid_request', message: 'amount and card are required' });
    }

    await sleep(180 + Math.floor(Math.random() * 420));
    const suffix = last4(card && card.number ? card.number : card);

    if (suffix === '0119') {
      return send(res, 500, { error: 'gateway_error', message: 'The processor is unavailable. Try again.' });
    }
    if (suffix === '0069') {
      await sleep(9000);
    }
    if (suffix === '0002') {
      const record = { id: 'ch_' + randomUUID(), amount, reference: reference ?? null, status: 'declined', at: new Date().toISOString() };
      charges.push(record);
      return send(res, 402, { status: 'declined', reason: 'card_declined', chargeId: record.id, reference: record.reference });
    }

    const record = { id: 'ch_' + randomUUID(), amount, reference: reference ?? null, status: 'approved', at: new Date().toISOString() };
    charges.push(record);
    return send(res, 200, { status: 'approved', chargeId: record.id, amount, reference: record.reference });
  }

  send(res, 404, { error: 'not_found' });
}).listen(PORT, () => console.log(`payments-mock listening on :${PORT}`));
