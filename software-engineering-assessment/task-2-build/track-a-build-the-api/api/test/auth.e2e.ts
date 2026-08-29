import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const base = (process.env.BASE_URL ?? 'http://127.0.0.1:8080/api').replace(
  /\/$/,
  '',
);

type SeedUser = {
  id: string;
  username: string;
  password: string;
  displayName: string;
};

function seedUser(): SeedUser {
  const candidates = [
    process.env.SEED_PATH,
    resolve(process.cwd(), 'seed.json'),
    resolve(process.cwd(), '../seed.json'),
  ].filter((p): p is string => Boolean(p));
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    throw new Error(`seed.json not found. Looked in: ${candidates.join(', ')}`);
  }
  const seed = JSON.parse(readFileSync(path, 'utf8')) as { users: SeedUser[] };
  const user = seed.users[0];
  if (!user) throw new Error('seed.json has no users');
  return user;
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

function jsonPost(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return request(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

function envelope(json: unknown): { code: string; message: string } {
  assert.equal(typeof json, 'object');
  assert.ok(json && typeof json === 'object' && 'error' in json);
  const error = (json as { error: { code: string; message: string } }).error;
  assert.equal(typeof error.code, 'string');
  assert.equal(typeof error.message, 'string');
  assert.ok(error.message.length > 0);
  return error;
}

describe('auth login (through nginx /api)', () => {
  const user = seedUser();

  it('rejects a wrong password with the storefront error envelope', async () => {
    const { status, json } = await jsonPost('/auth/login', {
      username: user.username,
      password: 'not-the-password',
    });
    assert.equal(status, 401);
    const error = envelope(json);
    assert.equal(error.code, 'INVALID_CREDENTIALS');
  });

  it('rejects an unknown user with the same envelope (no account leak)', async () => {
    const { status, json } = await jsonPost('/auth/login', {
      username: 'no-such-user',
      password: user.password,
    });
    assert.equal(status, 401);
    const error = envelope(json);
    assert.equal(error.code, 'INVALID_CREDENTIALS');
  });

  it('rejects an empty body as validation, not as bad credentials', async () => {
    const { status, json } = await jsonPost('/auth/login', {});
    assert.equal(status, 400);
    const error = envelope(json);
    assert.equal(error.code, 'VALIDATION');
  });

  it('rejects session without a bearer token', async () => {
    const { status, json } = await request('/auth/session');
    assert.equal(status, 401);
    assert.equal(envelope(json).code, 'UNAUTHORIZED');
  });

  it('logs in, reads the session, then logout kills the token', async () => {
    const login = await jsonPost('/auth/login', {
      username: user.username,
      password: user.password,
    });
    assert.equal(login.status, 200);
    assert.ok(login.json && typeof login.json === 'object');
    const body = login.json as {
      token: string;
      user: { id: string; username: string; displayName: string };
    };
    assert.equal(typeof body.token, 'string');
    assert.ok(body.token.split('.').length === 3);
    assert.deepEqual(body.user, {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    });
    assert.ok(!('password' in body.user));
    assert.ok(!('passwordHash' in body.user));

    const session = await request('/auth/session', {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    assert.equal(session.status, 200);
    assert.deepEqual(session.json, { user: body.user });

    const logout = await jsonPost('/auth/logout', {}, body.token);
    assert.equal(logout.status, 200);
    assert.deepEqual(logout.json, {});

    const after = await request('/auth/session', {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    assert.equal(after.status, 401);
    assert.equal(envelope(after.json).code, 'UNAUTHORIZED');
  });
});
