import { FieldValue, Timestamp } from 'firebase-admin/firestore';

/**
 * An in-memory Firestore double with the transaction semantics that Fundxtra's
 * financial guarantees actually depend on:
 *
 *  - `create()` fails if the document already exists. This is the mechanism
 *    behind idempotency keys and task-completion uniqueness, so a double that
 *    let `create` overwrite would make the tests meaningless.
 *  - Transactions buffer their writes and commit atomically. A failure part-way
 *    through leaves nothing behind.
 *  - Reads are version-tracked. If a document a transaction read is modified
 *    before it commits, the commit is rejected and the transaction body re-runs
 *    — the same optimistic concurrency Firestore uses. This is what lets a test
 *    simulate two concurrent requests racing for one reward.
 *  - `FieldValue.increment` / `arrayUnion` / `arrayRemove` / `delete` sentinels
 *    and dotted field paths are applied the way the real backend applies them.
 *
 * It is not a complete Firestore. It implements exactly the surface this
 * codebase uses, and throws loudly on anything else rather than quietly
 * returning wrong results.
 */

type Doc = Record<string, unknown>;

interface Stored {
  data: Doc;
  version: number;
}

class FakeDocumentSnapshot {
  constructor(
    readonly id: string,
    readonly ref: FakeDocumentReference,
    private readonly stored: Stored | undefined,
  ) {}

  get exists(): boolean {
    return this.stored !== undefined;
  }

  data(): Doc | undefined {
    return this.stored ? structuredClone(this.stored.data) : undefined;
  }

  get(path: string): unknown {
    if (!this.stored) return undefined;
    return path.split('.').reduce<unknown>((value, key) => {
      if (value && typeof value === 'object') return (value as Doc)[key];
      return undefined;
    }, this.stored.data);
  }
}

class FakeDocumentReference {
  constructor(
    readonly store: FakeFirestore,
    readonly collectionPath: string,
    readonly id: string,
  ) {}

  get path(): string {
    return `${this.collectionPath}/${this.id}`;
  }

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this.store, `${this.path}/${name}`);
  }

  async get(): Promise<FakeDocumentSnapshot> {
    return new FakeDocumentSnapshot(this.id, this, this.store.read(this.path));
  }

  async set(data: Doc, options?: { merge?: boolean }): Promise<void> {
    this.store.commit([{ kind: options?.merge ? 'merge' : 'set', path: this.path, data }]);
  }

  async create(data: Doc): Promise<void> {
    this.store.commit([{ kind: 'create', path: this.path, data }]);
  }

  async update(data: Doc): Promise<void> {
    this.store.commit([{ kind: 'update', path: this.path, data }]);
  }

  async delete(): Promise<void> {
    this.store.commit([{ kind: 'delete', path: this.path, data: {} }]);
  }
}

type Filter = [field: string, op: string, value: unknown];

class FakeQuery {
  constructor(
    readonly store: FakeFirestore,
    readonly collectionPath: string,
    readonly filters: Filter[] = [],
    readonly orderField: string | null = null,
    readonly orderDirection: 'asc' | 'desc' = 'asc',
    readonly limitCount: number | null = null,
    readonly startAfterValue: unknown = undefined,
  ) {}

  private derive(patch: Partial<FakeQuery>): FakeQuery {
    return new FakeQuery(
      this.store,
      this.collectionPath,
      patch.filters ?? this.filters,
      patch.orderField ?? this.orderField,
      patch.orderDirection ?? this.orderDirection,
      patch.limitCount ?? this.limitCount,
      'startAfterValue' in patch ? patch.startAfterValue : this.startAfterValue,
    );
  }

  where(field: string, op: string, value: unknown): FakeQuery {
    return this.derive({ filters: [...this.filters, [field, op, value]] });
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): FakeQuery {
    return this.derive({ orderField: field, orderDirection: direction });
  }

  limit(count: number): FakeQuery {
    return this.derive({ limitCount: count });
  }

  startAfter(value: unknown): FakeQuery {
    return this.derive({ startAfterValue: value });
  }

  async get(): Promise<{ docs: FakeDocumentSnapshot[]; empty: boolean; size: number }> {
    const docs = this.store.query(this);
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  /**
   * Mirrors the real SDK shape: `count()` returns an AggregateQuery that must
   * be `.get()`-ed, and the snapshot exposes `.data().count`.
   */
  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return {
      get: async () => {
        const docs = this.store.query(this);
        return { data: () => ({ count: docs.length }) };
      },
    };
  }
}

class FakeCollectionReference extends FakeQuery {
  doc(id?: string): FakeDocumentReference {
    return new FakeDocumentReference(
      this.store,
      this.collectionPath,
      id ?? `auto_${Math.random().toString(36).slice(2, 12)}`,
    );
  }
}

interface Write {
  kind: 'set' | 'merge' | 'create' | 'update' | 'delete';
  path: string;
  data: Doc;
}

/** Raised when a transaction's read set changed before it committed. */
export class ContentionError extends Error {
  constructor() {
    super('Transaction contention: a document read by this transaction changed');
    this.name = 'ContentionError';
  }
}

class FakeTransaction {
  private readonly writes: Write[] = [];
  private readonly readVersions = new Map<string, number>();

  constructor(private readonly store: FakeFirestore) {}

  async get(target: FakeDocumentReference | FakeQuery): Promise<never | FakeDocumentSnapshot | { docs: FakeDocumentSnapshot[]; empty: boolean; size: number }> {
    if (target instanceof FakeDocumentReference) {
      const stored = this.store.read(target.path);
      this.readVersions.set(target.path, stored?.version ?? 0);
      return new FakeDocumentSnapshot(target.id, target, stored);
    }
    const docs = this.store.query(target);
    for (const doc of docs) {
      this.readVersions.set(doc.ref.path, this.store.read(doc.ref.path)?.version ?? 0);
    }
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  set(ref: FakeDocumentReference, data: Doc, options?: { merge?: boolean }): this {
    this.writes.push({ kind: options?.merge ? 'merge' : 'set', path: ref.path, data });
    return this;
  }

  create(ref: FakeDocumentReference, data: Doc): this {
    this.writes.push({ kind: 'create', path: ref.path, data });
    return this;
  }

  update(ref: FakeDocumentReference, data: Doc): this {
    this.writes.push({ kind: 'update', path: ref.path, data });
    return this;
  }

  delete(ref: FakeDocumentReference): this {
    this.writes.push({ kind: 'delete', path: ref.path, data: {} });
    return this;
  }

  /** Validate the read set is unchanged, then apply every buffered write. */
  commitOrThrow(): void {
    for (const [path, version] of this.readVersions) {
      if ((this.store.read(path)?.version ?? 0) !== version) throw new ContentionError();
    }
    this.store.commit(this.writes);
  }
}

class FakeWriteBatch {
  private readonly writes: Write[] = [];

  constructor(private readonly store: FakeFirestore) {}

  set(ref: FakeDocumentReference, data: Doc, options?: { merge?: boolean }): this {
    this.writes.push({ kind: options?.merge ? 'merge' : 'set', path: ref.path, data });
    return this;
  }

  create(ref: FakeDocumentReference, data: Doc): this {
    this.writes.push({ kind: 'create', path: ref.path, data });
    return this;
  }

  update(ref: FakeDocumentReference, data: Doc): this {
    this.writes.push({ kind: 'update', path: ref.path, data });
    return this;
  }

  delete(ref: FakeDocumentReference): this {
    this.writes.push({ kind: 'delete', path: ref.path, data: {} });
    return this;
  }

  async commit(): Promise<void> {
    this.store.commit(this.writes);
  }
}

export class FakeFirestore {
  private readonly documents = new Map<string, Stored>();
  /** Hook fired just before a transaction commits. Used to inject a race. */
  onBeforeCommit: (() => void) | null = null;
  transactionAttempts = 0;

  settings(): void {
    /* no-op; the real SDK takes ignoreUndefinedProperties here */
  }

  collection(path: string): FakeCollectionReference {
    return new FakeCollectionReference(this, path);
  }

  doc(path: string): FakeDocumentReference {
    const index = path.lastIndexOf('/');
    return new FakeDocumentReference(this, path.slice(0, index), path.slice(index + 1));
  }

  read(path: string): Stored | undefined {
    return this.documents.get(path);
  }

  /** Seed data without going through a transaction. */
  seed(collectionPath: string, id: string, data: Doc): void {
    this.documents.set(`${collectionPath}/${id}`, { data: structuredClone(data), version: 1 });
  }

  snapshot(): Record<string, Doc> {
    const output: Record<string, Doc> = {};
    for (const [path, stored] of this.documents) output[path] = structuredClone(stored.data);
    return output;
  }

  countIn(collectionPath: string): number {
    let count = 0;
    for (const path of this.documents.keys()) {
      if (path.startsWith(`${collectionPath}/`) && !path.slice(collectionPath.length + 1).includes('/')) {
        count += 1;
      }
    }
    return count;
  }

  async runTransaction<T>(
    body: (tx: FakeTransaction) => Promise<T>,
    options: { maxAttempts?: number } = {},
  ): Promise<T> {
    const maxAttempts = options.maxAttempts ?? 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      this.transactionAttempts += 1;
      const tx = new FakeTransaction(this);
      try {
        const result = await body(tx);
        this.onBeforeCommit?.();
        tx.commitOrThrow();
        return result;
      } catch (error) {
        lastError = error;
        // Contention is retryable, exactly as the real SDK retries it.
        if (error instanceof ContentionError) continue;
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * A write batch. Like the real SDK, writes are buffered and applied together
   * on `commit()`, so a batch that fails validation applies nothing.
   */
  batch(): FakeWriteBatch {
    return new FakeWriteBatch(this);
  }

  /** Run a query against the store. */
  query(spec: FakeQuery): FakeDocumentSnapshot[] {
    return evaluateQuery(this, this.documents, spec);
  }

  /** Apply writes atomically: validate every one, then mutate. */
  commit(writes: Write[]): void {
    for (const write of writes) {
      const existing = this.documents.get(write.path);
      if (write.kind === 'create' && existing) {
        const error = new Error(
          `ALREADY_EXISTS: Document already exists: ${write.path}`,
        ) as Error & { code: number };
        error.code = 6;
        throw error;
      }
      if (write.kind === 'update' && !existing) {
        const error = new Error(
          `NOT_FOUND: No document to update: ${write.path}`,
        ) as Error & { code: number };
        error.code = 5;
        throw error;
      }
    }

    for (const write of writes) {
      const existing = this.documents.get(write.path);
      if (write.kind === 'delete') {
        this.documents.delete(write.path);
        continue;
      }
      const base =
        write.kind === 'set' ? {} : structuredClone(existing?.data ?? {});
      const next = applyWrite(base, write.data);
      this.documents.set(write.path, {
        data: next,
        version: (existing?.version ?? 0) + 1,
      });
    }
  }
}

/** Apply a write payload, honouring dotted paths and FieldValue sentinels. */
function applyWrite(base: Doc, patch: Doc): Doc {
  const output = base;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue; // mirrors ignoreUndefinedProperties
    setPath(output, key.split('.'), value);
  }
  return output;
}

function setPath(target: Doc, path: string[], value: unknown): void {
  const [head, ...rest] = path;
  if (!head) return;

  if (rest.length > 0) {
    const child = target[head];
    const container: Doc =
      child && typeof child === 'object' && !Array.isArray(child) ? (child as Doc) : {};
    target[head] = container;
    setPath(container, rest, value);
    return;
  }

  if (value instanceof FieldValue) {
    const name = value.constructor.name;
    if (name === 'NumericIncrementTransform') {
      const operand = (value as unknown as { operand: number }).operand;
      target[head] = (typeof target[head] === 'number' ? (target[head] as number) : 0) + operand;
      return;
    }
    if (name === 'DeleteTransform') {
      delete target[head];
      return;
    }
    if (name === 'ArrayUnionTransform' || name === 'ArrayRemoveTransform') {
      const elements = (value as unknown as { elements: unknown[] }).elements ?? [];
      const current = Array.isArray(target[head]) ? [...(target[head] as unknown[])] : [];
      if (name === 'ArrayUnionTransform') {
        for (const element of elements) {
          if (!current.some((item) => deepEqual(item, element))) current.push(element);
        }
        target[head] = current;
      } else {
        target[head] = current.filter(
          (item) => !elements.some((element) => deepEqual(item, element)),
        );
      }
      return;
    }
    if (name === 'ServerTimestampTransform') {
      target[head] = Timestamp.now();
      return;
    }
    throw new Error(`FakeFirestore does not implement the ${name} sentinel`);
  }

  target[head] = value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/** Comparable primitive for filtering and ordering. */
function comparable(value: unknown): number | string {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return String(value ?? '');
}

/**
 * Query evaluation. A free function rather than a class method so the filter and
 * ordering logic stays readable and independently testable.
 */
function evaluateQuery(
  store: FakeFirestore,
  documents: Map<string, Stored>,
  spec: FakeQuery,
): FakeDocumentSnapshot[] {
  const prefix = `${spec.collectionPath}/`;
  let docs: FakeDocumentSnapshot[] = [];

  for (const [path, stored] of documents) {
    if (!path.startsWith(prefix)) continue;
    const id = path.slice(prefix.length);
    if (id.includes('/')) continue; // a subcollection document, not a direct child

    if (!spec.filters.every((filter) => matchesFilter(stored.data, filter))) continue;

    docs.push(
      new FakeDocumentSnapshot(
        id,
        new FakeDocumentReference(store, spec.collectionPath, id),
        stored,
      ),
    );
  }

  if (spec.orderField) {
    const field = spec.orderField;
    const direction = spec.orderDirection === 'desc' ? -1 : 1;

    // Firestore implicitly appends `__name__` (the document id) as the final
    // sort key, in the same direction as the last explicit orderBy. Mirroring
    // that here is what makes snapshot cursors unambiguous for documents that
    // share a timestamp.
    const rank = (doc: FakeDocumentSnapshot): [number | string, string] => [
      comparable(doc.get(field)),
      doc.id,
    ];
    docs.sort((a, b) => {
      const [leftValue, leftId] = rank(a);
      const [rightValue, rightId] = rank(b);
      if (leftValue !== rightValue) return leftValue < rightValue ? -direction : direction;
      if (leftId !== rightId) return leftId < rightId ? -direction : direction;
      return 0;
    });

    if (spec.startAfterValue !== undefined) {
      const cursor = spec.startAfterValue;
      const boundary: [number | string, string] =
        cursor instanceof FakeDocumentSnapshot
          ? [comparable(cursor.get(field)), cursor.id]
          : [comparable(cursor), ''];

      docs = docs.filter((doc) => {
        const [value, id] = rank(doc);
        if (value !== boundary[0]) {
          return direction === 1 ? value > boundary[0] : value < boundary[0];
        }
        // Same order value: fall through to the id tiebreak.
        return direction === 1 ? id > boundary[1] : id < boundary[1];
      });
    }
  }

  return spec.limitCount === null ? docs : docs.slice(0, spec.limitCount);
}

function matchesFilter(data: Doc, [field, op, expected]: Filter): boolean {
  const actual = field
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as Doc)[key] : undefined),
      data,
    );

  switch (op) {
    case '==':
      return deepEqual(actual, expected);
    case '!=':
      return !deepEqual(actual, expected);
    case '>':
      return comparable(actual) > comparable(expected);
    case '>=':
      return comparable(actual) >= comparable(expected);
    case '<':
      return comparable(actual) < comparable(expected);
    case '<=':
      return comparable(actual) <= comparable(expected);
    case 'in':
      return Array.isArray(expected) && expected.some((item) => deepEqual(actual, item));
    case 'not-in':
      return Array.isArray(expected) && !expected.some((item) => deepEqual(actual, item));
    case 'array-contains':
      return Array.isArray(actual) && actual.some((item) => deepEqual(item, expected));
    case 'array-contains-any':
      return (
        Array.isArray(actual) &&
        Array.isArray(expected) &&
        expected.some((item) => (actual as unknown[]).some((entry) => deepEqual(entry, item)))
      );
    default:
      throw new Error(`FakeFirestore does not implement the "${op}" operator`);
  }
}

export { FakeDocumentReference, FakeCollectionReference, FakeQuery, FakeDocumentSnapshot, FakeWriteBatch };
