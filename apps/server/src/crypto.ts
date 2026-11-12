import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const PREFIX = 'v1:';

let cachedKey: Buffer | null = null;

function parseKey(value: string): Buffer {
  const trimmed = value.trim();
  const buffer = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (buffer.length !== KEY_BYTES) {
    throw new Error(
      'CREDENTIALS_KEY inválida: debe contener 32 bytes en hexadecimal (64 caracteres) o base64.',
    );
  }

  return buffer;
}

/**
 * Carga la clave de cifrado desde CREDENTIALS_KEY o desde el archivo
 * CREDENTIALS_KEY_FILE. Si no existe, genera una clave local persistente.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = process.env.CREDENTIALS_KEY;
  if (fromEnv) {
    cachedKey = parseKey(fromEnv);
    return cachedKey;
  }

  const keyPath =
    process.env.CREDENTIALS_KEY_FILE ?? path.resolve(process.cwd(), '.credentials-key');

  if (fs.existsSync(keyPath)) {
    cachedKey = parseKey(fs.readFileSync(keyPath, 'utf8'));
    return cachedKey;
  }

  const generated = crypto.randomBytes(KEY_BYTES);
  fs.writeFileSync(keyPath, generated.toString('base64'), { mode: 0o600 });
  cachedKey = generated;
  return cachedKey;
}

/**
 * Cifra un secreto con AES-256-GCM. El resultado incluye IV y etiqueta
 * de autenticación, codificados en base64: "v1:<base64>".
 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

/**
 * Descifra un secreto creado con encryptSecret. Devuelve '' si el valor
 * está vacío o no se puede descifrar (por ejemplo, si cambió la clave).
 */
export function decryptSecret(payload: string): string {
  if (!payload) return '';
  if (!payload.startsWith(PREFIX)) return '';

  try {
    const raw = Buffer.from(payload.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + 16);
    const encrypted = raw.subarray(IV_BYTES + 16);
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
