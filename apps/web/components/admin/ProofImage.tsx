'use client';

import { useEffect, useState } from 'react';
import { tokens } from '@fundxtra/shared';
import { config } from '@/lib/config';
import { getSessionToken } from '@/lib/api';

/**
 * A submission's screenshot, fetched through the API.
 *
 * A plain `<img src={publicUrl}>` failed silently whenever the reviewer's
 * browser could not reach the image host — a restricted network, an in-app
 * browser, a phone on mobile data that blocks it. All the reviewer saw was a
 * broken image, which says nothing about whether the upload failed, the link
 * is wrong, or their own connection is the problem. They cannot review what
 * they cannot see, and they cannot report a fault they cannot describe.
 *
 * So the bytes come from the API, which is the one connection the admin
 * console is already known to have. That needs a fetch rather than an `<img>`
 * tag, because the endpoint is authenticated and an image tag cannot carry a
 * bearer token — hence the blob URL.
 *
 * When it does fail, it says so in words, with a retry.
 */
export function ProofImage({ submissionId, alt }: { submissionId: string; alt: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let abandoned = false;
    let created: string | null = null;

    const token = getSessionToken();
    fetch(`${config.apiUrl}/admin/submissions/${submissionId}/proof`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? 'The screenshot could not be found on the image host.'
              : `The server returned ${String(response.status)}.`,
          );
        }
        const blob = await response.blob();
        if (abandoned) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
        setFailed(null);
      })
      .catch((error: unknown) => {
        if (abandoned) return;
        setFailed(error instanceof Error ? error.message : 'Could not load the screenshot.');
      });

    return () => {
      abandoned = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [submissionId, attempt]);

  if (failed) {
    return (
      <div style={failureStyle} role="status">
        <p style={{ fontWeight: tokens.typography.weight.semibold }}>
          The screenshot did not load
        </p>
        <p style={{ marginTop: 4, color: tokens.semantic.inkMuted }}>{failed}</p>
        <p style={{ marginTop: 8, color: tokens.semantic.inkMuted }}>
          Do not approve a screenshot you have not seen. Try again, and if it keeps failing,
          reject with a reason asking the user to resend it.
        </p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} style={retryStyle}>
          Try again
        </button>
      </div>
    );
  }

  if (!objectUrl) {
    return <div style={{ ...failureStyle, color: tokens.semantic.inkMuted }}>Loading screenshot…</div>;
  }

  return (
    <a href={objectUrl} target="_blank" rel="noopener noreferrer" title="Open the full-size screenshot" style={{ display: 'block' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={objectUrl}
        alt={alt}
        style={{
          width: '100%',
          maxHeight: 420,
          objectFit: 'contain',
          background: tokens.colors.sand[100],
          border: `1px solid ${tokens.semantic.border}`,
          borderRadius: tokens.radii.xs,
        }}
      />
    </a>
  );
}

const failureStyle: React.CSSProperties = {
  padding: 14,
  fontSize: tokens.typography.size.xs,
  lineHeight: tokens.typography.leading.relaxed,
  background: tokens.semantic.bgSubtle,
  border: `1px dashed ${tokens.semantic.borderStrong}`,
  borderRadius: tokens.radii.xs,
};

const retryStyle: React.CSSProperties = {
  marginTop: 10,
  padding: '6px 12px',
  fontSize: tokens.typography.size.xs,
  fontWeight: tokens.typography.weight.semibold,
  color: tokens.semantic.brandInk,
  background: '#fff',
  border: `1px solid ${tokens.semantic.border}`,
  borderRadius: tokens.radii.pill,
};
