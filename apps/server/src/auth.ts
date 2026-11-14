import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';

const TOKEN_VERSION = 'v1';
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

let cachedSecret: Buffer | null = null;
let cachedPin: string | null = null;

const attempts = new Map<string, { count: number; resetAt: number }>();

function secretFilePath() {
  return process.env.AUTH_SECRET_FILE ?? path.resolve(process.cwd(), '.auth-secret');
}

function pinFilePath() {
  return process.env.DASHBOARD_PIN_FILE ?? path.resolve(process.cwd(), '.dashboard-pin');
}

/** Permite desactivar el PIN por completo (útil para pruebas automáticas). */
export function isAuthDisabled() {
  return process.env.AUTH_DISABLED === '1';
}

function getSecret(): Buffer {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 32) {
    cachedSecret = Buffer.from(fromEnv, 'utf8');
    return cachedSecret;
  }

  const file = secretFilePath();
  if (fs.existsSync(file)) {
    const stored = fs.readFileSync(file, 'utf8').trim();
    const buffer = /^[0-9a-f]{64,}$/i.test(stored)
      ? Buffer.from(stored, 'hex')
      : Buffer.from(stored, 'base64');
    if (buffer.length >= 32) {
      cachedSecret = buffer;
      return cachedSecret;
    }
  }

  const generated = crypto.randomBytes(48);
  fs.writeFileSync(file, generated.toString('hex'), { mode: 0o600 });
  cachedSecret = generated;
  return cachedSecret;
}

/**
 * PIN de acceso al dashboard. Se toma de DASHBOARD_PIN, del archivo
 * .dashboard-pin o se genera uno de 6 dígitos la primera vez.
 */
export function getDashboardPin(): string {
  if (cachedPin) return cachedPin;

  const fromEnv = process.env.DASHBOARD_PIN?.trim();
  if (fromEnv) {
    cachedPin = fromEnv;
    return cachedPin;
  }

  const file = pinFilePath();
  if (fs.existsSync(file)) {
    const stored = fs.readFileSync(file, 'utf8').trim();
    if (stored) {
      cachedPin = stored;
      return cachedPin;
    }
  }

  const generated = String(crypto.randomInt(100_000, 1_000_000));
  fs.writeFileSync(file, generated, { mode: 0o600 });
  cachedPin = generated;
  return cachedPin;
}

/** Compara en tiempo constante para no filtrar el PIN por temporización. */
export function verifyPin(candidate: string): boolean {
  const expected = getDashboardPin();
  const a = crypto.createHash('sha256').update(candidate, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload, 'utf8').digest('base64url');
}

export function issueToken(): { token: string; expiresAt: string } {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${TOKEN_VERSION}.${expiresAt}`;
  return {
    token: `${payload}.${sign(payload)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function verifyToken(token: string | undefined | null): boolean {
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false;

  const [, expiresAtRaw, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const expected = sign(`${TOKEN_VERSION}.${expiresAtRaw}`);
  const given = Buffer.from(signature, 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}

/**
 * Acepta el token en la cabecera Authorization, en X-CCTV-Token o en
 * ?token= (necesario para HLS, donde el reproductor nativo no envía cabeceras).
 */
export function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }

  const custom = req.headers['x-cctv-token'];
  if (typeof custom === 'string' && custom.trim()) return custom.trim();

  const query = req.query as Record<string, unknown> | undefined;
  const fromQuery = query?.token;
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();

  return null;
}

export function checkLoginAllowed(ip: string): { allowed: boolean; retryAfterMs: number } {
  const entry = attempts.get(ip);
  if (!entry) return { allowed: true, retryAfterMs: 0 };

  if (Date.now() >= entry.resetAt) {
    attempts.delete(ip);
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: entry.resetAt - Date.now() };
  }

  return { allowed: true, retryAfterMs: 0 };
}

export function recordFailedLogin(ip: string) {
  const entry = attempts.get(ip);
  if (!entry || Date.now() >= entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearLoginAttempts(ip: string) {
  attempts.delete(ip);
}
