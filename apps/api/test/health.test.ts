import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Probe behaviour on an *unconfigured* deployment.
 *
 * This is the first-deploy case: the image is built and the process is up, but
 * no secrets have been set in the platform dashboard yet. `/health` must still
 * answer 200, because Railway fails a deployment whose healthcheck is not 2xx —
 * which previously meant a brand-new service could never go live, and the
 * operator could never reach the response listing what to set. Readiness is
 * reported in the body and enforced strictly by `/ready`.
 *
 * Each Vitest file gets its own module registry, so the env parsed here is
 * genuinely missing the secrets that `api.test.ts` sets.
 */

process.env.NODE_ENV = 'production';
delete process.env.SESSION_SECRET;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

vi.mock('../src/lib/firebase', () => ({
  db: () => {
    throw new Error('Firestore is not configured');
  },
  firestoreAvailable: false,
  bucket: () => ({}),
}));

const { createApp } = await import('../src/app');
const app = createApp();

describe('probes on an unconfigured deployment', () => {
  it('keeps /health at 200 so the platform healthcheck passes', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.ready).toBe(false);
  });

  it('names every missing secret in the /health body', async () => {
    const response = await request(app).get('/health');

    expect(response.body.missingConfiguration).toContain('SESSION_SECRET');
    expect(response.body.missingConfiguration).toContain('TELEGRAM_BOT_TOKEN');
    expect(response.body.missingConfiguration).toContain('FIREBASE_SERVICE_ACCOUNT');
  });

  it('fails /ready until the configuration is complete', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
  });
});

describe('probes on a misconfigured deployment', () => {
  it('reports why a pasted service account is unusable, not just that it is missing', async () => {
    // A truncated paste is the realistic failure: the variable is set, so
    // "missing" would be actively misleading.
    process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"fundxtra","client_em';
    vi.resetModules();
    const freshApp = (await import('../src/app')).createApp();
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    const response = await request(freshApp).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.ready).toBe(false);
    expect(
      response.body.missingConfiguration.some((entry: string) =>
        entry.includes('not valid JSON'),
      ),
    ).toBe(true);
  });
});
