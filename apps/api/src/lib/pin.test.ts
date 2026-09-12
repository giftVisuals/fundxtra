import { describe, expect, it } from 'vitest';
import { hashPin, needsRehash, verifyPin } from './pin';

describe('PIN hashing', () => {
  it('verifies the correct PIN and rejects every other one', async () => {
    const hash = await hashPin('8351');
    await expect(verifyPin('8351', hash)).resolves.toBe(true);
    await expect(verifyPin('8352', hash)).resolves.toBe(false);
    await expect(verifyPin('1835', hash)).resolves.toBe(false);
    await expect(verifyPin('', hash)).resolves.toBe(false);
  });

  it('never stores the PIN in the hash', async () => {
    const hash = await hashPin('4729');
    expect(hash).not.toContain('4729');
  });

  it('salts per user, so identical PINs produce different hashes', async () => {
    const [a, b] = await Promise.all([hashPin('4729'), hashPin('4729')]);
    expect(a).not.toBe(b);
    // Both still verify: the salt is embedded, not global.
    await expect(verifyPin('4729', a)).resolves.toBe(true);
    await expect(verifyPin('4729', b)).resolves.toBe(true);
  });

  it('records the cost parameters so they can be raised later', async () => {
    const hash = await hashPin('1357');
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(needsRehash(hash)).toBe(false);
    expect(needsRehash('scrypt$1024$8$1$c2FsdA==$aGFzaA==')).toBe(true);
  });

  it('fails closed on a malformed or tampered hash instead of throwing', async () => {
    await expect(verifyPin('1234', '')).resolves.toBe(false);
    await expect(verifyPin('1234', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPin('1234', 'bcrypt$10$abc$def$ghi$jkl')).resolves.toBe(false);
    // An attacker lowering the cost to make brute force cheap is rejected outright.
    await expect(verifyPin('1234', 'scrypt$99999999$8$1$c2FsdA==$aGFzaA==')).resolves.toBe(false);
  });
});
