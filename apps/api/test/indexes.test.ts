import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_INDEXES } from '../src/config/indexes';

/**
 * The index list and the Firebase CLI's file must not drift.
 *
 * Two consumers read the same definitions: the server, which creates the
 * indexes through the Firestore Admin API, and `firebase deploy --only
 * firestore:indexes`, which reads the JSON. If they disagree, one path
 * provisions something the other does not, and the missing index shows up as a
 * dead screen rather than as a configuration error.
 */

const jsonPath = resolve(__dirname, '../../../firebase/firestore.indexes.json');

interface FileIndex {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
}

const file = JSON.parse(readFileSync(jsonPath, 'utf8')) as { indexes: FileIndex[] };

const signature = (index: {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order?: string | undefined; arrayConfig?: string | undefined }>;
}) =>
  [
    index.collectionGroup,
    index.queryScope,
    ...index.fields.map((f) => `${f.fieldPath}:${f.order ?? f.arrayConfig ?? ''}`),
  ].join('|');

describe('firestore.indexes.json', () => {
  it('matches REQUIRED_INDEXES exactly', () => {
    // Regenerate with: npm run indexes:write --workspace @fundxtra/api
    expect(file.indexes.map(signature).sort()).toEqual(REQUIRED_INDEXES.map(signature).sort());
  });

  it('carries no index the server would not create', () => {
    expect(file.indexes).toHaveLength(REQUIRED_INDEXES.length);
  });
});

describe('the index list', () => {
  it('covers the queries that took screens down when unindexed', () => {
    const signatures = REQUIRED_INDEXES.map(signature);

    // The wallet history: userId equality, newest first.
    expect(signatures).toContain('transactions|COLLECTION|userId:ASCENDING|createdAt:DESCENDING');
    // Today's credits, which failed inside the dashboard.
    expect(signatures).toContain(
      'transactions|COLLECTION|userId:ASCENDING|direction:ASCENDING|createdAt:ASCENDING',
    );
    // The referrals list.
    expect(
      signatures.some((s) => s.startsWith('referrals|COLLECTION|referrerId:ASCENDING')),
    ).toBe(true);
  });

  it('declares a direction or an array config for every field', () => {
    for (const index of REQUIRED_INDEXES) {
      expect(index.fields.length).toBeGreaterThan(1);
      for (const field of index.fields) {
        expect(Boolean(field.order) || Boolean(field.arrayConfig)).toBe(true);
      }
    }
  });
});
