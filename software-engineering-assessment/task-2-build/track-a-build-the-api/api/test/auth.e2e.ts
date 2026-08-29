import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  envelope,
  jsonGet,
  jsonPost,
  loginAsSeedUser,
  request,
  seedUser,
} from './helpers';

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

  it('rejects an oversized username as validation, not as bad credentials', async () => {
    const { status, json } = await jsonPost('/auth/login', {
      username: 'x'.repeat(65),
      password: user.password,
    });
    assert.equal(status, 400);
    assert.equal(envelope(json).code, 'VALIDATION');
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
