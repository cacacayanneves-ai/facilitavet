import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/**
 * Sessao por cookie assinado (HMAC-SHA256).
 *
 * Escolha deliberada em vez de uma biblioteca de auth completa: o MVP tem um
 * unico metodo de login (e-mail + senha) e nenhum provedor OAuth. Um cookie
 * assinado, httpOnly, sameSite=lax e secure em producao cobre o caso com
 * superficie de ataque minima e zero dependencia extra.
 *
 * O payload guarda apenas identificadores — nada sensivel. A assinatura usa
 * comparacao em tempo constante para evitar timing attack.
 */
const COOKIE_NAME = 'fv_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dias

export interface SessionPayload {
  userId: string;
  organizationId: string;
  email: string;
  /** epoch em segundos */
  exp: number;
}

function sign(value: string): string {
  return crypto.createHmac('sha256', env().AUTH_SECRET).update(value).digest('base64url');
}

export function serializeSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function parseSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.userId || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(payload: Omit<SessionPayload, 'exp'>): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const store = await cookies();
  store.set(COOKIE_NAME, serializeSession({ ...payload, exp }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return parseSession(store.get(COOKIE_NAME)?.value);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
