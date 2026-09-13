import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Screenshot uploads.
 *
 * The file leaves our server for a third party, which makes three things worth
 * pinning down: the API key must never travel anywhere it could be logged, a
 * file that is not an image must never reach the host at all, and imgbb's own
 * wording — which names our key in some errors — must not be handed to a user.
 */

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-32';
process.env.TELEGRAM_BOT_TOKEN = '7000000000:AAExampleTokenForTestsOnly_not_real_abcd';
process.env.FIREBASE_CLIENT_EMAIL = 'test@fundxtra.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
process.env.IMGBB_API_KEY = 'imgbb-test-key-abcdef';

const { storeProof, proofUrl, fetchProof, detectImageType } = await import('../src/services/uploads');

/** A real PNG header, which is what the signature check reads. */
function png(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(128, 3),
  ]);
}

interface Capture {
  url: string;
  form: FormData;
}

let captured: Capture | null = null;

function mockImgbb(response: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: FormData }) => {
      captured = { url: String(url), form: init.body };
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => response,
      };
    }),
  );
}

beforeEach(() => {
  captured = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sending a screenshot to imgbb', () => {
  it('stores the URL it gets back', async () => {
    mockImgbb({
      success: true,
      data: {
        url: 'https://i.ibb.co/abc/task-proofs-1-xyz.png',
        display_url: 'https://i.ibb.co/abc/display.png',
        delete_url: 'https://ibb.co/abc/deletetoken',
      },
    });

    const stored = await storeProof({ userId: '1', taskId: 't1', buffer: png() });

    expect(stored.path).toBe('https://i.ibb.co/abc/display.png');
    expect(stored.deleteUrl).toBe('https://ibb.co/abc/deletetoken');
    expect(stored.contentType).toBe('image/png');
    expect(stored.bytes).toBe(136);
  });

  it('keeps the API key out of the URL', async () => {
    mockImgbb({ success: true, data: { url: 'https://i.ibb.co/abc/a.png' } });

    await storeProof({ userId: '1', taskId: 't1', buffer: png() });

    // In the body, never the query string: a URL ends up in proxy and access
    // logs, and this one would carry the key with it.
    expect(captured?.url).toBe('https://api.imgbb.com/1/upload');
    expect(captured?.url).not.toContain('imgbb-test-key');
    expect(captured?.form.get('key')).toBe('imgbb-test-key-abcdef');
  });

  it('sets an expiry so proofs do not live on a third-party host forever', async () => {
    mockImgbb({ success: true, data: { url: 'https://i.ibb.co/abc/a.png' } });

    await storeProof({ userId: '1', taskId: 't1', buffer: png() });

    const expiration = Number(captured?.form.get('expiration'));
    expect(expiration).toBeGreaterThanOrEqual(60);
    expect(expiration).toBeLessThanOrEqual(15_552_000);
  });

  it('names the file from the user and task, never from the client', async () => {
    mockImgbb({ success: true, data: { url: 'https://i.ibb.co/abc/a.png' } });

    await storeProof({ userId: '77', taskId: 'crediplex', buffer: png() });

    const name = String(captured?.form.get('name'));
    expect(name).toContain('task-proofs-77-');
    expect(name.endsWith('.png')).toBe(true);
  });

  it('falls back to url when display_url is absent', async () => {
    mockImgbb({ success: true, data: { url: 'https://i.ibb.co/abc/only-url.png' } });

    const stored = await storeProof({ userId: '1', taskId: 't1', buffer: png() });
    expect(stored.path).toBe('https://i.ibb.co/abc/only-url.png');
  });
});

describe('files that must never reach imgbb', () => {
  it('rejects something that is not an image, before any upload', async () => {
    mockImgbb({ success: true, data: { url: 'https://i.ibb.co/abc/a.png' } });

    await expect(
      storeProof({
        userId: '1',
        taskId: 't1',
        buffer: Buffer.from('<?php echo 1; ?>'),
        declaredMimeType: 'image/png',
      }),
    ).rejects.toThrow();

    // The point: the bytes never left the server.
    expect(captured).toBeNull();
  });

  it('rejects an empty file before any upload', async () => {
    mockImgbb({ success: true, data: { url: 'https://i.ibb.co/abc/a.png' } });

    await expect(
      storeProof({ userId: '1', taskId: 't1', buffer: Buffer.alloc(0) }),
    ).rejects.toThrow();
    expect(captured).toBeNull();
  });
});

describe('when imgbb refuses', () => {
  it('does not repeat its wording to the user', async () => {
    mockImgbb({ success: false, error: { message: 'Invalid API v1 key: imgbb-test-key-abcdef' } }, 400);

    await expect(
      storeProof({ userId: '1', taskId: 't1', buffer: png() }),
    ).rejects.toMatchObject({
      // Their message names our key. The user gets ours instead.
      message: 'We could not save your screenshot just now. Please try again.',
    });
  });

  it('treats a 200 with no URL as a failure rather than storing nothing', async () => {
    mockImgbb({ success: true, data: {} });

    await expect(storeProof({ userId: '1', taskId: 't1', buffer: png() })).rejects.toThrow();
  });
});

describe('handing a proof URL to an admin', () => {
  it('accepts an imgbb URL', () => {
    expect(proofUrl('https://i.ibb.co/abc/a.png')).toBe('https://i.ibb.co/abc/a.png');
  });

  it('refuses a URL on any other host', () => {
    // The stored value is written by our own upload code, but this is the
    // function that turns a stored string into a link a browser will open.
    expect(proofUrl('https://evil.example.com/a.png')).toBeNull();
    expect(proofUrl('http://i.ibb.co/abc/a.png')).toBeNull();
    expect(proofUrl('task-proofs/1/old-firebase-path.png')).toBeNull();
    expect(proofUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('the magic-byte check itself', () => {
  it('knows the three formats it accepts, and nothing else', () => {
    expect(detectImageType(png())).toBe('image/png');
    expect(detectImageType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]))).toBe('image/jpeg');
    expect(
      detectImageType(
        Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]),
      ),
    ).toBe('image/webp');
    expect(detectImageType(Buffer.from('GIF89a-and-more-bytes'))).toBeNull();
  });
});

/**
 * Serving a proof through the API.
 *
 * A reviewer's browser used to fetch the image from the host directly, and on
 * any network that could not reach it they saw a broken image and nothing
 * else — no way to tell a failed upload from a bad link from their own
 * connection. The server fetches it now, so the only connection that has to
 * work is the one the console is already using.
 */
describe('fetching a stored proof', () => {
  it('returns the bytes and the type', async () => {
    const image = png();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength),
      })),
    );

    const proof = await fetchProof('https://i.ibb.co/abc/a.png');
    expect(proof?.contentType).toBe('image/png');
    expect(proof?.bytes.byteLength).toBe(image.byteLength);
  });

  it('will not fetch a URL on another host', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);

    expect(await fetchProof('https://evil.example.com/a.png')).toBeNull();
    // The point: no request was made at all.
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses anything the host serves that is not an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );

    expect(await fetchProof('https://i.ibb.co/abc/a.png')).toBeNull();
  });

  it('reports a missing image rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) })),
    );

    expect(await fetchProof('https://i.ibb.co/abc/gone.png')).toBeNull();
  });

  it('survives the host being unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND'); }));

    expect(await fetchProof('https://i.ibb.co/abc/a.png')).toBeNull();
  });
});
