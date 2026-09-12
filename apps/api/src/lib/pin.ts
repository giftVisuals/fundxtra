import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * `promisify` resolves to node's 4-argument `scrypt` overload and loses the
 * options parameter, so the options-aware form is wrapped by hand. Without this
 * the cost parameters below would be silently ignored and every PIN would be
 * hashed with node's defaults.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * PIN hashing.
 *
 * A 4-digit PIN has only 10,000 possible values, so the hash must be slow
 * enough that an attacker who steals the database cannot simply enumerate them.
 * scrypt with N=2^15 costs ~50-80ms per guess on typical hardware, turning a
 * full sweep of the keyspace into hours per user rather than milliseconds — and
 * the per-user random salt means that work cannot be shared across users.
 *
 * Node's built-in scrypt is used deliberately: no native build step, so the
 * container image stays small and Railway deploys stay reliable.
 *
 * Plaintext PINs are never stored, never logged (see logger redaction) and
 * never returned by any API response.
 */

const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
/** scrypt needs roughly 128 * N * r bytes; give it headroom over the 32MB default. */
const MAX_MEMORY = 96 * 1024 * 1024;

/** Encoded as `scrypt$N$r$p$salt_b64$hash_b64` so parameters can be raised later. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(pin, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: MAX_MEMORY,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_r,
    SCRYPT_p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Verify a PIN against a stored hash.
 * Returns false for malformed hashes rather than throwing, so a corrupt record
 * fails closed (nobody gets in) instead of 500-ing the login endpoint.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number.parseInt(parts[1] ?? '', 10);
  const r = Number.parseInt(parts[2] ?? '', 10);
  const p = Number.parseInt(parts[3] ?? '', 10);
  const saltB64 = parts[4];
  const hashB64 = parts[5];
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !saltB64 || !hashB64) {
    return false;
  }
  // Refuse absurd parameters from a tampered record rather than exhausting memory.
  if (N > 1 << 20 || r > 32 || p > 16) return false;

  const expected = Buffer.from(hashB64, 'base64');
  let derived: Buffer;
  try {
    derived = await scrypt(pin, Buffer.from(saltB64, 'base64'), expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEMORY,
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** True when the stored hash uses weaker parameters than we now require. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number.parseInt(parts[1] ?? '0', 10) < SCRYPT_N;
}
