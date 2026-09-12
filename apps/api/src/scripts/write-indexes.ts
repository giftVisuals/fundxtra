import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REQUIRED_INDEXES } from '../config/indexes';

/**
 * Regenerates firebase/firestore.indexes.json from REQUIRED_INDEXES.
 *
 * The TypeScript list is the source of truth because the server reads it to
 * create the indexes itself. This keeps the Firebase CLI's file in step, so
 * `firebase deploy --only firestore:indexes` stays a valid alternative path.
 */
const target = resolve(__dirname, '../../../../firebase/firestore.indexes.json');

const document = {
  indexes: REQUIRED_INDEXES.map((index) => ({
    collectionGroup: index.collectionGroup,
    queryScope: index.queryScope,
    fields: index.fields.map((field) => ({
      fieldPath: field.fieldPath,
      ...(field.order ? { order: field.order } : {}),
      ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}),
    })),
  })),
  fieldOverrides: [],
};

writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`Wrote ${String(REQUIRED_INDEXES.length)} indexes to ${target}\n`);
