import { ACCEPTED_PROOF_MIME_TYPES, ERROR_CODES, LIMITS } from '@fundxtra/shared';
import { bucket } from '../lib/firebase';
import { AppError } from '../lib/errors';
import { hashedId } from '../lib/ids';
import { logger } from '../lib/logger';

/**
 * Proof-of-completion uploads.
 *
 * Screenshots go through the API to Cloud Storage rather than being uploaded
 * from the browser. That costs a little bandwidth and buys three things worth
 * more: the file type is checked against its actual magic bytes rather than a
 * client-supplied Content-Type, the storage bucket needs no public write rule
 * at all, and the stored path is derived server-side so a user cannot choose
 * where their file lands or overwrite someone else's proof.
 */

const PROOF_PREFIX = 'task-proofs';

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
  path: string;
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

  const extension = actualType === 'image/png' ? 'png' : actualType === 'image/webp' ? 'webp' : 'jpg';
  // Path is derived from the user, the task and the clock, never from client input.
  const path = `${PROOF_PREFIX}/${input.userId}/${hashedId(input.taskId, String(Date.now()))}.${extension}`;

  try {
    await bucket()
      .file(path)
      .save(input.buffer, {
        contentType: actualType,
        resumable: false,
        metadata: {
          cacheControl: 'private, max-age=0, no-transform',
          metadata: { userId: input.userId, taskId: input.taskId },
        },
      });
  } catch (error) {
    /*
      A bucket that does not exist is a setup step, not a bug — Cloud Storage
      has to be switched on in the Firebase console before any screenshot can
      be stored. Left as a generic 500 it reads to the user as "the app is
      broken" and tells the operator nothing, so it is named here the same way
      a missing database index is.
    */
    const message = error instanceof Error ? error.message : String(error);
    if (/bucket does not exist|not found|notfound|404/i.test(message)) {
      logger.error(
        { err: error, bucket: bucket().name },
        'Screenshot upload failed: the storage bucket does not exist. Enable Cloud Storage in the Firebase console.',
      );
      throw new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, {
        message: 'Screenshot uploads are not switched on yet. Please tell Fundxtra Support.',
        detail: 'Cloud Storage is not enabled for this project, or the bucket name is wrong.',
      });
    }
    logger.error({ err: error, path }, 'Screenshot upload failed');
    throw new AppError(ERROR_CODES.VERIFICATION_UNAVAILABLE, {
      message: 'We could not save your screenshot just now. Please try again.',
      detail: message,
    });
  }

  logger.info({ path, bytes: input.buffer.length, userId: input.userId }, 'Proof stored');
  return { path, contentType: actualType, bytes: input.buffer.length };
}

/**
 * A short-lived signed URL so an admin can view a proof.
 *
 * The bucket itself stays private; nothing is ever made publicly readable, and
 * the link expires so it cannot be forwarded indefinitely.
 */
export async function signedProofUrl(path: string, minutes = 15): Promise<string | null> {
  if (!path.startsWith(`${PROOF_PREFIX}/`)) {
    // Refuse to sign anything outside the proofs prefix, so a crafted path
    // cannot be turned into a read of arbitrary bucket contents.
    logger.warn({ path }, 'Refused to sign a URL outside the proofs prefix');
    return null;
  }
  try {
    const [url] = await bucket()
      .file(path)
      .getSignedUrl({ action: 'read', expires: Date.now() + minutes * 60_000, version: 'v4' });
    return url;
  } catch (error) {
    logger.error({ err: error, path }, 'Could not sign a proof URL');
    return null;
  }
}

export async function deleteProof(path: string): Promise<void> {
  if (!path.startsWith(`${PROOF_PREFIX}/`)) return;
  await bucket()
    .file(path)
    .delete({ ignoreNotFound: true })
    .catch((error: unknown) => logger.warn({ err: error, path }, 'Could not delete a proof'));
}
