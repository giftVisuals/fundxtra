import { describe, expect, it } from 'vitest';
import { resolveServiceAccount } from '../src/config/service-account';

/**
 * Credential parsing, exercised in the shapes a value actually arrives in.
 *
 * Every case here is a real way a paste goes wrong when the only tool you have
 * is a phone: newlines rewritten, quotes kept, the JSON base64-encoded to
 * survive a form field, a file truncated mid-copy. A wrong answer here is a
 * deploy that looks configured and fails every request, so each shape gets a
 * test rather than a hope.
 */

const PEM = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQtestmaterial',
  'ZmFrZS1rZXktbWF0ZXJpYWwtZm9yLXRlc3RzLW9ubHktbm90LXJlYWw=',
  '-----END PRIVATE KEY-----',
  '',
].join('\n');

function accountJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'fundxtra',
    private_key_id: 'abc123',
    private_key: PEM,
    client_email: 'firebase-adminsdk@fundxtra.iam.gserviceaccount.com',
    client_id: '1234567890',
    ...overrides,
  });
}

describe('single-variable service account', () => {
  it('accepts the JSON file exactly as Firebase emits it', () => {
    const result = resolveServiceAccount({
      serviceAccountJson: accountJson(),
      projectId: 'fallback',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('json');
    expect(result.account.clientEmail).toBe(
      'firebase-adminsdk@fundxtra.iam.gserviceaccount.com',
    );
    expect(result.account.projectId).toBe('fundxtra');
    // Must be a usable PEM with real newlines, not escapes.
    expect(result.account.privateKey.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
    expect(result.account.privateKey).not.toContain('\\n');
  });

  it('accepts base64-encoded JSON', () => {
    const result = resolveServiceAccount({
      serviceAccountJson: Buffer.from(accountJson(), 'utf8').toString('base64'),
      projectId: 'fallback',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.privateKey).toContain('BEGIN PRIVATE KEY');
  });

  it('accepts base64 that a dashboard has wrapped across lines', () => {
    const base64 = Buffer.from(accountJson(), 'utf8').toString('base64');
    const wrapped = (base64.match(/.{1,64}/g) ?? []).join('\n');

    const result = resolveServiceAccount({
      serviceAccountJson: wrapped,
      projectId: 'fallback',
    });

    expect(result.ok).toBe(true);
  });

  it('repairs a private_key whose newlines arrived doubly escaped', () => {
    const mangled = accountJson({ private_key: PEM.replace(/\n/g, '\\\\n') });

    const result = resolveServiceAccount({ serviceAccountJson: mangled, projectId: 'fundxtra' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.privateKey).toContain('-----BEGIN PRIVATE KEY-----\n');
    expect(result.account.privateKey).not.toContain('\\n');
  });

  it('strips wrapping quotes kept by a dashboard', () => {
    const result = resolveServiceAccount({
      serviceAccountJson: `'${accountJson()}'`,
      projectId: 'fundxtra',
    });

    expect(result.ok).toBe(true);
  });

  it('falls back to FIREBASE_PROJECT_ID when the JSON omits project_id', () => {
    const json = JSON.stringify({
      private_key: PEM,
      client_email: 'a@b.iam.gserviceaccount.com',
    });

    const result = resolveServiceAccount({ serviceAccountJson: json, projectId: 'fundxtra' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.projectId).toBe('fundxtra');
  });

  it('wins over the split variables when both are set', () => {
    const result = resolveServiceAccount({
      serviceAccountJson: accountJson(),
      clientEmail: 'stale@old.iam.gserviceaccount.com',
      privateKey: PEM,
      projectId: 'fundxtra',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('json');
    expect(result.account.clientEmail).toContain('firebase-adminsdk@');
  });
});

describe('unusable service account', () => {
  it('explains a truncated paste instead of failing silently', () => {
    const result = resolveServiceAccount({
      serviceAccountJson: accountJson().slice(0, 80),
      projectId: 'fundxtra',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('not valid JSON');
  });

  it('names the field a partial file is missing', () => {
    const result = resolveServiceAccount({
      serviceAccountJson: JSON.stringify({ project_id: 'fundxtra', private_key: PEM }),
      projectId: 'fundxtra',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('client_email');
  });

  it('rejects a value that is neither JSON nor base64 JSON', () => {
    const result = resolveServiceAccount({
      serviceAccountJson: 'paste your key here',
      projectId: 'fundxtra',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('neither JSON nor base64');
  });

  it('rejects a private_key that is not a PEM key', () => {
    const result = resolveServiceAccount({
      serviceAccountJson: accountJson({ private_key: 'AIzaSyNotAPrivateKeyAtAll' }),
      projectId: 'fundxtra',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('PEM key');
  });

  it('reports the variable name when nothing is set at all', () => {
    const result = resolveServiceAccount({ projectId: 'fundxtra' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.source).toBe('none');
    expect(result.reason).toBe('FIREBASE_SERVICE_ACCOUNT');
  });
});

describe('split variables', () => {
  it('still work for an existing deployment', () => {
    const result = resolveServiceAccount({
      clientEmail: 'firebase-adminsdk@fundxtra.iam.gserviceaccount.com',
      privateKey: PEM.replace(/\n/g, '\\n'),
      projectId: 'fundxtra',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('split');
    expect(result.account.privateKey).toContain('-----BEGIN PRIVATE KEY-----\n');
  });

  it('point at the single variable when the PEM key is unusable', () => {
    const result = resolveServiceAccount({
      clientEmail: 'a@b.iam.gserviceaccount.com',
      privateKey: 'not-a-key',
      projectId: 'fundxtra',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('FIREBASE_SERVICE_ACCOUNT');
  });
});
