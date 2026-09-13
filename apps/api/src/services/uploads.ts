import { ACCEPTED_PROOF_MIME_TYPES, ERROR_CODES, LIMITS } from '@fundxtra/shared';
import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { hashedId } from '../lib/ids';
import { logger } from '../lib/logger';

/**
 * Proof-of-completion uploads.
 *
 * Screenshots go to imgbb rather than Cloud Storage. Cloud Storage has to be
 * switched on in the Firebase console before it will accept a single byte, and
 * until it is, every screenshot task fails — a setup step standing between the
 * platform and its most common kind of campaign. imgbb needs one API key.
 *
 * The cost of that is real and is not hidden: **an imgbb link is public.**
 * Anyone who has the URL can open the image without signing in. The links are
 * long random strings and are never shown to anyone but the admin reviewing
 * the submission, but they are not access-controlled, and a screenshot can
 * carry more of someone's screen than they meant to share. Two things follow
 * from that, both enforced below: uploads expire, so proofs do not sit on a
 * third-party host indefinitely; and the API key stays on the server, so the
 * upload path cannot be driven by anything but a signed-in user completing a
 * task they were offered.
 *
 * Everything else about the flow is unchanged, and deliberately so:
 *
 *  - The file goes through the API, never from the browser to imgbb. That
 *    keeps the key out of the client entirely, and means the bytes are checked
 *    before they leave us.
 *  - The type is checked against the file's actual magic bytes, not against a
 *    Content-Type header the client chose.
 *  - The stored value is whatever the host gave back, so a user cannot
 *    influence where their file lands or overwrite someone else's proof.
 */

const PROOF_PREFIX = 'task-proofs';
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';
const UPLOAD_TIMEOUT_MS = 25_000;

/** Only the parts of imgbb's reply this code depends on. */
interface ImgbbResponse {
  success?: boolean;
  data?: {
    url?: string;
    display_url?: string;
    delete_url?: string;
  };
  error?: { message?: string };
}

/**
 * Validate a file by inspecting its leading bytes.
 *
 * A declared MIME type is just a string the client sent, so it is not trusted.
 * Only PNG, JPEG and WebP signatures are accepted.
 */
export function detectImageType(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

export interface StoredProof {
  /** The image URL, stored against the submission. */
  path: string;
  /**
   * imgbb's own delete page for this upload. Kept for the record: it is a web
   * page rather than an API call, so nothing here can use it automatically —
   * expiry is what actually removes the file.
   */
  deleteUrl: string | null;
  contentType: string;
  bytes: number;
}

export async function storeProof(input: {
  userId: string;
  taskId: string;
  buffer: Buffer;
  declaredMimeType?: string | undefined;
}): Promise<StoredProof> {
  if (input.buffer.length === 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: { proof: 'The file is empty' },
    });
  }
  if (input.buffer.length > LIMITS.MAX_PROOF_BYTES) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: {
        proof: `The screenshot must be smaller than ${Math.floor(LIMITS.MAX_PROOF_BYTES / 1024 / 1024)}MB`,
      },
    });
  }

  const actualType = detectImageType(input.buffer);
  if (!actualType || !ACCEPTED_PROOF_MIME_TYPES.includes(actualType)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      fields: { proof: 'Please upload a PNG, JPEG or WebP screenshot' },
      detail: `declared "${input.declaredMimeType ?? 'none'}", detected "${actualType ?? 'unknown'}"`,
    });
  }

  if (!env.IMGBB_API_KEY) {
    /*
      Named rather than left to fail as a 500. Without the key there is nowhere
      to put a screenshot, and that is a missing setting, not a bug — the user
      is told it is not switched on and the log says exactly which one.
    */
    logger.error('Screenshot upload attempted with no IMGBB_API_KEY set');
    throw new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, {
      message: 'Screenshot uploads are not switched on yet. Please tell Fundxtra Support.',
      detail: 'IMGBB_API_KEY is not configured.',
    });
  }

  const extension = actualType === 'image/png' ? 'png' : actualType === 'image/webp' ? 'webp' : 'jpg';
  // Named from the user and the task so a proof can be traced back from the
  // host's own dashboard. Never from anything the client sent.
  const name = `${PROOF_PREFIX}-${input.userId}-${hashedId(input.taskId, String(Date.now()))}`;

  const uploaded = await uploadToImgbb({
    buffer: input.buffer,
    filename: `${name}.${extension}`,
    contentType: actualType,
  });

  logger.info(
    { userId: input.userId, taskId: input.taskId, bytes: input.buffer.length },
    'Proof stored',
  );

  return {
    path: uploaded.url,
    deleteUrl: uploaded.deleteUrl,
    contentType: actualType,
    bytes: input.buffer.length,
  };
}

/**
 * POST the image to imgbb.
 *
 * Sent as multipart with the raw bytes rather than base64: base64 inflates the
 * body by a third for no benefit, and imgbb accepts a binary file directly.
 * The key travels in the form body rather than the query string so it cannot
 * end up in a proxy's access log.
 *
 * Timed out, because a third-party host that hangs must not hold a request
 * open — the user is standing there with their thumb on a button.
 */
async function uploadToImgbb(input: {
  buffer: Buffer;
  filename: string;
  contentType: string;
}): Promise<{ url: string; deleteUrl: string | null }> {
  const form = new FormData();
  form.append('key', env.IMGBB_API_KEY ?? '');
  form.append('image', new Blob([new Uint8Array(input.buffer)], { type: input.contentType }), input.filename);
  form.append('name', input.filename);
  form.append('expiration', String(env.IMGBB_EXPIRATION_SECONDS));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let payload: ImgbbResponse;
  try {
    const response = await fetch(IMGBB_UPLOAD_URL, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    payload = (await response.json()) as ImgbbResponse;

    if (!response.ok || payload.success !== true) {
      // imgbb's own wording is for us, not for the user: it names our key.
      logger.error(
        { status: response.status, imgbb: payload.error?.message ?? null },
        'imgbb refused the upload',
      );
      throw new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, {
        message: 'We could not save your screenshot just now. Please try again.',
        detail: payload.error?.message ?? `imgbb returned ${String(response.status)}`,
      });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, {
        message: 'That upload took too long. Please try again.',
        detail: 'imgbb timed out',
      });
    }
    logger.error({ err: error }, 'Could not reach imgbb');
    throw new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, {
      message: 'We could not save your screenshot just now. Please try again.',
      detail: error instanceof Error ? error.message : 'network failure',
    });
  } finally {
    clearTimeout(timeout);
  }

  /*
    `display_url` is the image itself; `url` is the same file under a different
    host name. Either works for showing a proof, so the first that is present
    is taken rather than depending on one field being there.
  */
  const url = payload.data?.display_url ?? payload.data?.url;
  if (!url) {
    logger.error({ imgbb: payload }, 'imgbb accepted the upload but returned no URL');
    throw new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, {
      message: 'We could not save your screenshot just now. Please try again.',
      detail: 'imgbb returned no image URL',
    });
  }

  return { url, deleteUrl: payload.data?.delete_url ?? null };
}

/**
 * The URL an admin opens to look at a proof.
 *
 * With imgbb the stored value is already the image, so there is nothing to
 * sign — the name is kept because the callers are about "give me a viewable
 * link for this proof", which is still exactly what this does.
 *
 * Only https URLs on imgbb's own hosts are handed back. The stored value comes
 * from our own upload code and never from a client, but this is the function
 * that turns a stored string into something an admin's browser will open, so
 * it refuses anything that is not what it expects rather than trusting that
 * the value upstream is still what it was.
 */
const IMGBB_HOSTS = new Set(['i.ibb.co', 'ibb.co', 'image.ibb.co']);

export function proofUrl(path: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(path);
  } catch {
    logger.warn({ path }, 'Stored proof is not a URL');
    return null;
  }

  if (parsed.protocol !== 'https:' || !IMGBB_HOSTS.has(parsed.hostname)) {
    logger.warn({ host: parsed.hostname }, 'Refused to hand back a proof URL from an unexpected host');
    return null;
  }
  return parsed.toString();
}

/**
 * Fetch a stored proof, so the API can serve it rather than the browser
 * fetching it from imgbb directly.
 *
 * Two reasons, and the second is why this exists at all.
 *
 * The public one: a reviewer's browser had to reach i.ibb.co, and when it
 * could not — a network that blocks image hosts, an in-app browser, a phone on
 * a restricted connection — the admin saw a broken image and nothing else. A
 * broken image tells a reviewer nothing about whether the upload failed, the
 * link is wrong, or their own connection is at fault. Serving it from the API
 * removes the question: if the server can reach imgbb, the reviewer sees it.
 *
 * The quieter one: the imgbb URL is public to anyone holding it. Proxying
 * means it stops being handed to the browser at all, so it cannot be copied
 * out of a page, shared, or left in someone's history.
 */
export async function fetchProof(
  path: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const url = proofUrl(path);
  if (!url) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Could not fetch a stored proof');
      return null;
    }

    const contentType = response.headers.get('content-type') ?? 'image/png';
    // Only ever hand back an image, whatever the host claims to have sent.
    if (!contentType.startsWith('image/')) {
      logger.warn({ contentType }, 'Stored proof was not an image');
      return null;
    }

    return { bytes: Buffer.from(await response.arrayBuffer()), contentType };
  } catch (error) {
    logger.warn({ err: error }, 'Could not reach the image host for a proof');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Kept as the shape the admin routes already await.
 *
 * Nothing is signed any more, but the callers are async and turning them
 * synchronous buys nothing.
 */
export async function signedProofUrl(path: string): Promise<string | null> {
  return Promise.resolve(proofUrl(path));
}

/**
 * Removing a proof is not something this code can do.
 *
 * imgbb's delete link is a web page a person visits, not an endpoint, so the
 * only thing that actually removes an upload is the expiry set when it was
 * made. Left as a no-op that says so, rather than deleted outright: the
 * callers describe an intention that is still correct, and a function that
 * quietly does nothing is worse than one that explains why.
 */
export async function deleteProof(path: string): Promise<void> {
  logger.info(
    { path },
    'Proof deletion is handled by the upload expiry; imgbb has no delete API',
  );
  return Promise.resolve();
}
