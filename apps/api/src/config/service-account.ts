/**
 * Firebase service-account credentials.
 *
 * Two accepted shapes, because the split form is painful to set by hand:
 *
 * 1. `FIREBASE_SERVICE_ACCOUNT` — the whole JSON file Firebase gives you, as
 *    one value. Raw JSON or base64-encoded JSON both work. This is the
 *    recommended form: it is one copy-paste, and a multi-line PEM key pasted
 *    into a dashboard field is the single most common way to break a deploy.
 * 2. `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` — the individual fields.
 *
 * Form 1 wins when both are present.
 *
 * Parsing is deliberately strict and reports *why* it failed. A service account
 * that is present but malformed is worse than one that is absent: without a
 * reason, the deploy looks configured and every authenticated request fails
 * with an opaque credential error. The failure reason is surfaced on `/health`.
 */

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export type ServiceAccountResult =
  | { ok: true; source: 'json' | 'split'; account: ServiceAccount }
  | { ok: false; source: 'json' | 'split' | 'none'; reason: string };

/**
 * A PEM key survives a dashboard in several shapes. Firebase's own JSON uses
 * `\n` escapes; a value pasted through a shell or a form may arrive with real
 * newlines, doubled escapes, or CRLFs. All of them must end up as real
 * newlines or `cert()` rejects the key.
 */
function normalisePrivateKey(value: string): string {
  return value
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

/** Strips wrapping quotes that a dashboard or shell may have kept. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function looksLikeJson(value: string): boolean {
  return value.startsWith('{');
}

/**
 * Base64 is accepted because it is immune to a dashboard reformatting the
 * embedded newlines, which is the usual reason a pasted JSON key stops working.
 */
function decodeBase64(value: string): string | null {
  // Reject anything that cannot be base64 before decoding: Buffer.from is
  // lenient and would happily return mojibake for arbitrary text.
  const compact = value.replace(/\s/g, '');
  if (compact.length === 0 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null;
  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf8');
    return looksLikeJson(decoded.trim()) ? decoded.trim() : null;
  } catch {
    return null;
  }
}

function fromJson(raw: string, fallbackProjectId: string): ServiceAccountResult {
  const unquoted = unquote(raw);
  const text = looksLikeJson(unquoted) ? unquoted : decodeBase64(unquoted);

  if (!text) {
    return {
      ok: false,
      source: 'json',
      reason:
        'FIREBASE_SERVICE_ACCOUNT is set but is neither JSON nor base64-encoded JSON. Paste the whole service-account file, starting with "{".',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      source: 'json',
      reason: `FIREBASE_SERVICE_ACCOUNT is not valid JSON (${
        error instanceof Error ? error.message : 'parse failed'
      }). Copy the file again without editing it.`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      source: 'json',
      reason: 'FIREBASE_SERVICE_ACCOUNT must be a JSON object.',
    };
  }

  const record = parsed as Record<string, unknown>;

  // Accept snake_case (what Firebase emits) and camelCase (what some tools
  // re-serialise it as).
  const clientEmail = record.client_email ?? record.clientEmail;
  const privateKey = record.private_key ?? record.privateKey;
  const projectId = record.project_id ?? record.projectId ?? fallbackProjectId;

  const missing: string[] = [];
  if (typeof clientEmail !== 'string' || clientEmail.length === 0) missing.push('client_email');
  if (typeof privateKey !== 'string' || privateKey.length === 0) missing.push('private_key');
  if (missing.length > 0) {
    return {
      ok: false,
      source: 'json',
      reason: `FIREBASE_SERVICE_ACCOUNT is missing ${missing.join(' and ')}. Use the JSON from Firebase console → Project settings → Service accounts → Generate new private key.`,
    };
  }

  const key = normalisePrivateKey(privateKey as string);
  if (!key.includes('BEGIN') || !key.includes('PRIVATE KEY')) {
    return {
      ok: false,
      source: 'json',
      reason:
        'FIREBASE_SERVICE_ACCOUNT contains a private_key that is not a PEM key. It should begin with "-----BEGIN PRIVATE KEY-----".',
    };
  }

  return {
    ok: true,
    source: 'json',
    account: {
      projectId: typeof projectId === 'string' && projectId.length > 0 ? projectId : fallbackProjectId,
      clientEmail: clientEmail as string,
      privateKey: key,
    },
  };
}

export interface ServiceAccountInput {
  serviceAccountJson?: string | undefined;
  clientEmail?: string | undefined;
  privateKey?: string | undefined;
  projectId: string;
}

export function resolveServiceAccount(input: ServiceAccountInput): ServiceAccountResult {
  const json = input.serviceAccountJson?.trim();
  if (json && json.length > 0) {
    return fromJson(json, input.projectId);
  }

  if (input.clientEmail && input.privateKey) {
    const key = normalisePrivateKey(unquote(input.privateKey));
    if (!key.includes('BEGIN') || !key.includes('PRIVATE KEY')) {
      return {
        ok: false,
        source: 'split',
        reason:
          'FIREBASE_PRIVATE_KEY is not a PEM key. It should begin with "-----BEGIN PRIVATE KEY-----". Consider setting FIREBASE_SERVICE_ACCOUNT to the whole JSON file instead.',
      };
    }
    return {
      ok: true,
      source: 'split',
      account: {
        projectId: input.projectId,
        clientEmail: unquote(input.clientEmail),
        privateKey: key,
      },
    };
  }

  return {
    ok: false,
    source: 'none',
    reason: 'FIREBASE_SERVICE_ACCOUNT',
  };
}
