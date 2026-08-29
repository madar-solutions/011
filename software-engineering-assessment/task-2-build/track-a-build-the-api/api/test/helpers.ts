import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const base = (process.env.BASE_URL ?? 'http://127.0.0.1:8080/api').replace(
  /\/$/,
  '',
);

export type SeedUser = {
  id: string;
  username: string;
  password: string;
  displayName: string;
};

export function seedUsers(): SeedUser[] {
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
  if (!seed.users.length) throw new Error('seed.json has no users');
  return seed.users;
}

export function seedUser(): SeedUser {
  const user = seedUsers()[0];
  if (!user) throw new Error('seed.json has no users');
  return user;
}

export async function request(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

export function jsonPost(
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

export function jsonGet(
  path: string,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return request(path, { headers });
}

export function jsonPatch(
  path: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return request(path, { method: 'PATCH', headers, body: JSON.stringify(body) });
}

export function jsonDelete(
  path: string,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return request(path, { method: 'DELETE', headers });
}

export function envelope(json: unknown): { code: string; message: string } {
  assert.equal(typeof json, 'object');
  assert.ok(json && typeof json === 'object' && 'error' in json);
  const error = (json as { error: { code: string; message: string } }).error;
  assert.equal(typeof error.code, 'string');
  assert.equal(typeof error.message, 'string');
  assert.ok(error.message.length > 0);
  return error;
}

export async function loginAs(user: SeedUser = seedUser()): Promise<string> {
  const login = await jsonPost('/auth/login', {
    username: user.username,
    password: user.password,
  });
  assert.equal(login.status, 200);
  const token = (login.json as { token: string }).token;
  assert.equal(typeof token, 'string');
  return token;
}

export async function loginAsSeedUser(): Promise<string> {
  return loginAs(seedUser());
}
