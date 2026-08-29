import {
  EMPTY_PROOF_FILTERS,
  PROOF_VISIBILITY,
  isProofCategory,
  isProofSourceType,
  normalizeTags,
  sortProofItems,
  validateProofImage,
  type ProofFilters,
  type ProofItem,
  type ProofItemInput,
} from "./proof";
import type { ProofSearchResult } from "./proof-api";

export const LOCAL_PROOF_OWNER_ID = "local-browser-owner";

const DATABASE_NAME = "muse-nexus-proof-gallery-local";
const DATABASE_VERSION = 1;
const ITEM_STORE = "proof_items";
const BACKUP_FORMAT = "muse-nexus-proof-gallery-backup";
const BACKUP_VERSION = 1;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_IMAGE_BYTES = 48 * 1024 * 1024;
const MAX_BACKUP_ITEMS = 10_000;
const MAX_EDITABLE_TIMESTAMP_MS = Date.parse("9999-12-31T23:59:59.999Z");
const CHANGE_CHANNEL_NAME = "muse-nexus-proof-gallery-local-changes-v1";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

type LocalProofRecord = {
  id: string;
  userId: typeof LOCAL_PROOF_OWNER_ID;
  title: string;
  evidenceText: string;
  occurredOn: string | null;
  category: ProofItem["category"];
  sourceType: ProofItem["sourceType"];
  source: string | null;
  tags: string[];
  person: string | null;
  project: string | null;
  provenance: Record<string, unknown>;
  visibility: typeof PROOF_VISIBILITY;
  createdAt: string;
  updatedAt: string;
  imageBlob: Blob | null;
  imageName: string | null;
  imageRevision: string | null;
  imageDigest: string | null;
};

type BackupImage = {
  name: string;
  type: string;
  size: number;
  integritySha256: string;
  base64: string;
};

type BackupIntegrityReceipt = {
  purpose: "corruption-detection";
  algorithm: "SHA-256";
  sha256: string;
};

type BackupItemBody = Omit<
  LocalProofRecord,
  "userId" | "imageBlob" | "imageName" | "imageRevision" | "imageDigest"
> & {
  image: BackupImage | null;
};

type BackupItem = BackupItemBody & {
  integrity: BackupIntegrityReceipt;
};

type BackupDocument = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  encryption: "none";
  exportedAt: string;
  items: BackupItem[];
};

export type LocalProofImportResult = {
  imported: number;
  importedCount: number;
  items: ProofItem[];
};

const objectUrlCache = new Map<
  string,
  { revision: string; url: string }
>();
let databasePromise: Promise<IDBDatabase> | null = null;
type LocalProofChangeKind = "change" | "clear";
const changeListeners = new Set<(kind: LocalProofChangeKind) => void>();
let incomingChangeChannel: BroadcastChannel | null = null;

function deliverLocalProofChange(kind: LocalProofChangeKind): void {
  if (kind === "clear") releaseLocalProofImageUrls();
  for (const listener of [...changeListeners]) {
    try {
      listener(kind);
    } catch {
      // A notification observer cannot roll back an already-committed write.
    }
  }
}

function createChangeChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANGE_CHANNEL_NAME);
  } catch {
    return null;
  }
}

function publishLocalProofChange(kind: LocalProofChangeKind): void {
  const channel = incomingChangeChannel ?? createChangeChannel();
  if (!channel) return;
  try {
    channel.postMessage(kind);
  } finally {
    if (channel !== incomingChangeChannel) channel.close();
  }
}

export function subscribeToLocalProofChanges(
  listener: (kind: LocalProofChangeKind) => void,
): () => void {
  if (typeof listener !== "function") {
    throw new Error("Local Proof change listener must be a function");
  }
  changeListeners.add(listener);
  if (!incomingChangeChannel) {
    incomingChangeChannel = createChangeChannel();
    if (incomingChangeChannel) {
      incomingChangeChannel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === "change" || event.data === "clear") {
          deliverLocalProofChange(event.data);
        }
      };
    }
  }

  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    changeListeners.delete(listener);
    if (changeListeners.size === 0 && incomingChangeChannel) {
      incomingChangeChannel.close();
      incomingChangeChannel = null;
    }
  };
}

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === "undefined") {
    throw new Error("Local Proof storage is not available in this browser");
  }
  return indexedDB;
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = requireIndexedDb().open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ITEM_STORE)) {
        database.createObjectStore(ITEM_STORE, { keyPath: "id" });
      }
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Local Proof storage could not open"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(
        new Error(
          "Local Proof storage is open in another tab with an older version",
        ),
      );
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
        releaseLocalProofImageUrls();
      };
      resolve(database);
    };
  });

  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Local Proof storage request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Local Proof storage transaction failed"),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Local Proof storage transaction aborted"),
      );
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} has an unsupported schema`);
  }
}

function requiredString(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  if (!value || value !== value.trim()) {
    throw new Error(`${label} must not be empty or padded`);
  }
  if (value.length > maximum) {
    throw new Error(`${label} must be ${maximum} characters or fewer`);
  }
  return value;
}

function optionalString(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredString(value, label, maximum);
}

function cleanedRequiredString(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required`);
  if (cleaned.length > maximum) {
    throw new Error(`${label} must be ${maximum} characters or fewer`);
  }
  return cleaned;
}

function cleanedOptionalString(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (cleaned.length > maximum) {
    throw new Error(`${label} must be ${maximum} characters or fewer`);
  }
  return cleaned;
}

function validDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function occurredDate(value: unknown): string | null {
  const cleaned = cleanedOptionalString(value, "Occurred date", 10);
  if (cleaned !== null && !validDateOnly(cleaned)) {
    throw new Error("Occurred date must use a valid YYYY-MM-DD date");
  }
  return cleaned;
}

function isoTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, label, 40);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  if (parsed > MAX_EDITABLE_TIMESTAMP_MS) {
    throw new Error(`${label} must not be later than year 9999`);
  }
  return timestamp;
}

function uuid(value: unknown, label: string): string {
  const identifier = requiredString(value, label, 64);
  if (!UUID_PATTERN.test(identifier)) {
    throw new Error(`${label} must be a UUID`);
  }
  return identifier;
}

function validateTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) {
    throw new Error("Proof tags must be an array of at most 30 values");
  }
  if (
    value.some(
      (tag) =>
        typeof tag !== "string" ||
        tag.trim().replace(/^#+/, "").toLowerCase().length > 80,
    )
  ) {
    throw new Error("Each Proof tag must be 80 characters or fewer");
  }
  const tags = value as string[];
  const normalized = normalizeTags(tags);
  if (
    normalized.length !== tags.length ||
    normalized.some((tag, index) => tag !== tags[index])
  ) {
    throw new Error("Proof backup tags must already be normalized and unique");
  }
  return [...normalized];
}

function inputTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Proof tags must be an array");
  if (
    value.some(
      (tag) =>
        typeof tag !== "string" ||
        tag.trim().replace(/^#+/, "").toLowerCase().length > 80,
    )
  ) {
    throw new Error("Each Proof tag must be 80 characters or fewer");
  }
  return normalizeTags(value as string[]);
}

function validateJsonValue(
  value: unknown,
  path: string,
  depth = 0,
): void {
  if (depth > 20) throw new Error(`${path} is nested too deeply`);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error(`${path} contains too many values`);
    value.forEach((entry, index) =>
      validateJsonValue(entry, `${path}[${index}]`, depth + 1),
    );
    return;
  }
  if (!isPlainObject(value)) throw new Error(`${path} must contain JSON values`);
  const entries = Object.entries(value);
  if (entries.length > 10_000) throw new Error(`${path} contains too many fields`);
  for (const [key, entry] of entries) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new Error(`${path} contains an unsafe field name`);
    }
    validateJsonValue(entry, `${path}.${key}`, depth + 1);
  }
}

function provenance(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error("Proof provenance must be an object");
  validateJsonValue(value, "Proof provenance");
  return value;
}

function canonicalInput(input: ProofItemInput): Omit<
  LocalProofRecord,
  | "id"
  | "userId"
  | "createdAt"
  | "updatedAt"
  | "imageBlob"
  | "imageName"
  | "imageRevision"
  | "imageDigest"
> {
  const title = cleanedRequiredString(input.title, "Title", 200);
  const evidenceText = cleanedRequiredString(
    input.evidenceText,
    "Evidence",
    20_000,
  );
  if (!isProofCategory(input.category)) {
    throw new Error("Choose a valid Proof category");
  }
  if (!isProofSourceType(input.sourceType)) {
    throw new Error("Choose a valid Proof source type");
  }
  const source = cleanedOptionalString(input.source, "Source", 500);

  return {
    title,
    evidenceText,
    occurredOn: occurredDate(input.occurredOn),
    category: input.category,
    sourceType: input.sourceType,
    source,
    tags: inputTags(input.tags),
    person: cleanedOptionalString(input.person, "Person", 200),
    project: cleanedOptionalString(input.project, "Project", 200),
    provenance: {
      kind: "manual",
      captured_via: "proof_gallery",
      source_type: input.sourceType,
      ...(source ? { source } : {}),
    },
    visibility: PROOF_VISIBILITY,
  };
}

function assertBlob(value: unknown, label: string): Blob {
  const candidate = value as Partial<Blob> | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Object.prototype.toString.call(candidate) !== "[object Blob]" ||
    typeof candidate.size !== "number" ||
    typeof candidate.type !== "string" ||
    typeof candidate.arrayBuffer !== "function" ||
    typeof candidate.slice !== "function"
  ) {
    throw new Error(`${label} must be an image Blob`);
  }
  if (!SAFE_IMAGE_TYPES.has(candidate.type) || candidate.size > MAX_IMAGE_BYTES) {
    throw new Error(`${label} has an unsupported type or size`);
  }
  return candidate as Blob;
}

async function sha256Buffer(buffer: ArrayBuffer): Promise<string> {
  if (!crypto.subtle) {
    throw new Error("This browser cannot run Proof integrity checks");
  }
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(blob: Blob): Promise<string> {
  return sha256Buffer(await blob.arrayBuffer());
}

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return sha256Buffer(buffer);
}

function validateStoredRecord(value: unknown): LocalProofRecord {
  if (!isPlainObject(value)) throw new Error("Local Proof record is invalid");
  assertExactKeys(
    value,
    [
      "id",
      "userId",
      "title",
      "evidenceText",
      "occurredOn",
      "category",
      "sourceType",
      "source",
      "tags",
      "person",
      "project",
      "provenance",
      "visibility",
      "createdAt",
      "updatedAt",
      "imageBlob",
      "imageName",
      "imageRevision",
      "imageDigest",
    ],
    "Local Proof record",
  );

  const id = uuid(value.id, "Proof id");
  if (value.userId !== LOCAL_PROOF_OWNER_ID) {
    throw new Error("Local Proof storage refused an item for another owner");
  }
  if (value.visibility !== PROOF_VISIBILITY) {
    throw new Error("Local Proof storage refused a non-private item");
  }
  if (!isProofCategory(value.category)) {
    throw new Error("Local Proof record has an unsupported category");
  }
  if (!isProofSourceType(value.sourceType)) {
    throw new Error("Local Proof record has an unsupported source type");
  }

  const createdAt = isoTimestamp(value.createdAt, "Created timestamp");
  const updatedAt = isoTimestamp(value.updatedAt, "Updated timestamp");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error("Updated timestamp cannot precede created timestamp");
  }

  const imageBlob = value.imageBlob === null ? null : assertBlob(value.imageBlob, "Proof image");
  const imageName =
    value.imageName === null
      ? null
      : requiredString(value.imageName, "Proof image name", 1_024);
  const imageRevision =
    value.imageRevision === null
      ? null
      : uuid(value.imageRevision, "Proof image revision");
  const imageDigest =
    value.imageDigest === null
      ? null
      : requiredString(value.imageDigest, "Proof image digest", 64);
  if (imageDigest !== null && !/^[0-9a-f]{64}$/.test(imageDigest)) {
    throw new Error("Proof image digest must be a SHA-256 value");
  }
  if (
    (imageBlob === null) !== (imageName === null) ||
    (imageBlob === null) !== (imageRevision === null) ||
    (imageBlob === null) !== (imageDigest === null)
  ) {
    throw new Error("Local Proof image metadata is incomplete");
  }

  return {
    id,
    userId: LOCAL_PROOF_OWNER_ID,
    title: requiredString(value.title, "Title", 200),
    evidenceText: requiredString(value.evidenceText, "Evidence", 20_000),
    occurredOn: occurredDate(value.occurredOn),
    category: value.category,
    sourceType: value.sourceType,
    source: optionalString(value.source, "Source", 500),
    tags: validateTags(value.tags),
    person: optionalString(value.person, "Person", 200),
    project: optionalString(value.project, "Project", 200),
    provenance: provenance(value.provenance),
    visibility: PROOF_VISIBILITY,
    createdAt,
    updatedAt,
    imageBlob,
    imageName,
    imageRevision,
    imageDigest,
  };
}

function revokeImageUrl(id: string): void {
  const cached = objectUrlCache.get(id);
  if (!cached) return;
  if (typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(cached.url);
  }
  objectUrlCache.delete(id);
}

function imageUrl(record: LocalProofRecord): string | null {
  if (!record.imageBlob || !record.imageRevision) {
    revokeImageUrl(record.id);
    return null;
  }

  const cached = objectUrlCache.get(record.id);
  if (cached?.revision === record.imageRevision) return cached.url;
  revokeImageUrl(record.id);
  if (typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(record.imageBlob);
  objectUrlCache.set(record.id, { revision: record.imageRevision, url });
  return url;
}

function mapRecord(recordValue: unknown, relevance: number | null = null): ProofItem {
  const record = validateStoredRecord(recordValue);
  return {
    id: record.id,
    userId: LOCAL_PROOF_OWNER_ID,
    title: record.title,
    evidenceText: record.evidenceText,
    occurredOn: record.occurredOn,
    category: record.category,
    sourceType: record.sourceType,
    source: record.source,
    tags: [...record.tags],
    person: record.person,
    project: record.project,
    imagePath:
      record.imageRevision === null
        ? null
        : `local-proof://${record.id}/${record.imageRevision}`,
    imageUrl: imageUrl(record),
    provenance: record.provenance,
    visibility: PROOF_VISIBILITY,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    relevance,
  };
}

function normalizedFilters(filters: ProofFilters): {
  category: ProofFilters["category"];
  tag: string | null;
} {
  if (filters.category !== null && !isProofCategory(filters.category)) {
    throw new Error("Choose a valid Proof category");
  }
  if (filters.tag === null) return { category: filters.category, tag: null };
  if (typeof filters.tag !== "string") throw new Error("Proof tag filter is invalid");
  const [tag] = normalizeTags([filters.tag]);
  if (!tag) throw new Error("Proof tag filter is empty");
  return { category: filters.category, tag };
}

function recordMatchesFilters(
  record: LocalProofRecord,
  filters: ReturnType<typeof normalizedFilters>,
): boolean {
  return (
    (!filters.category || record.category === filters.category) &&
    (!filters.tag || record.tags.includes(filters.tag))
  );
}

async function allRecords(): Promise<LocalProofRecord[]> {
  const database = await openDatabase();
  const transaction = database.transaction(ITEM_STORE, "readonly");
  const resultPromise = requestResult(transaction.objectStore(ITEM_STORE).getAll());
  const [values] = await Promise.all([resultPromise, transactionComplete(transaction)]);
  return (values as unknown[]).map(validateStoredRecord);
}

async function addRecord(record: LocalProofRecord): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(ITEM_STORE, "readwrite");
  const addPromise = requestResult(transaction.objectStore(ITEM_STORE).add(record));
  await Promise.all([addPromise, transactionComplete(transaction)]);
}

function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

async function checkedUpdate(
  existing: ProofItem,
  next: Omit<
    LocalProofRecord,
    | "id"
    | "userId"
    | "createdAt"
    | "updatedAt"
    | "imageBlob"
    | "imageName"
    | "imageRevision"
    | "imageDigest"
  >,
  image: File | null,
  imageDigest: string | null,
  removeExistingImage: boolean,
): Promise<LocalProofRecord> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ITEM_STORE, "readwrite");
    const store = transaction.objectStore(ITEM_STORE);
    const request = store.get(existing.id);
    let nextRecord: LocalProofRecord | null = null;
    let explicitError: unknown = null;

    request.onsuccess = () => {
      try {
        if (request.result === undefined) {
          throw new Error("Proof changed in another tab. Reload before editing it.");
        }
        const current = validateStoredRecord(request.result);
        if (current.updatedAt !== existing.updatedAt) {
          throw new Error("Proof changed in another tab. Reload before editing it.");
        }

        const replaceImage = image !== null;
        nextRecord = {
          ...next,
          id: current.id,
          userId: LOCAL_PROOF_OWNER_ID,
          createdAt: current.createdAt,
          updatedAt: nextTimestamp(current.updatedAt),
          imageBlob: replaceImage
            ? image.slice(0, image.size, image.type)
            : removeExistingImage
              ? null
              : current.imageBlob,
          imageName: replaceImage
            ? image.name
            : removeExistingImage
              ? null
              : current.imageName,
          imageRevision: replaceImage
            ? crypto.randomUUID()
            : removeExistingImage
              ? null
              : current.imageRevision,
          imageDigest: replaceImage
            ? imageDigest
            : removeExistingImage
              ? null
              : current.imageDigest,
        };
        store.put(nextRecord);
      } catch (error) {
        explicitError = error;
        transaction.abort();
      }
    };
    request.onerror = () => {
      explicitError = request.error;
    };
    transaction.oncomplete = () => {
      if (!nextRecord) {
        reject(new Error("Local Proof update completed without a record"));
        return;
      }
      resolve(nextRecord);
    };
    transaction.onerror = () => {
      reject(
        explicitError ??
          transaction.error ??
          new Error("Local Proof update failed"),
      );
    };
    transaction.onabort = () => {
      reject(
        explicitError ??
          transaction.error ??
          new Error("Local Proof update was aborted"),
      );
    };
  });
}

async function checkedDelete(existing: ProofItem): Promise<void> {
  const database = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ITEM_STORE, "readwrite");
    const store = transaction.objectStore(ITEM_STORE);
    const request = store.get(existing.id);
    let explicitError: unknown = null;

    request.onsuccess = () => {
      try {
        if (request.result === undefined) {
          throw new Error("Proof changed in another tab. Reload before deleting it.");
        }
        const current = validateStoredRecord(request.result);
        if (current.updatedAt !== existing.updatedAt) {
          throw new Error("Proof changed in another tab. Reload before deleting it.");
        }
        store.delete(existing.id);
      } catch (error) {
        explicitError = error;
        transaction.abort();
      }
    };
    request.onerror = () => {
      explicitError = request.error;
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        explicitError ??
          transaction.error ??
          new Error("Local Proof delete failed"),
      );
    transaction.onabort = () =>
      reject(
        explicitError ??
          transaction.error ??
          new Error("Local Proof delete was aborted"),
      );
  });
}

export async function listLocalProofItems(
  filters: ProofFilters = EMPTY_PROOF_FILTERS,
): Promise<ProofItem[]> {
  const normalized = normalizedFilters(filters);
  const records = (await allRecords()).filter((record) =>
    recordMatchesFilters(record, normalized),
  );
  return sortProofItems(records.map((record) => mapRecord(record)), "newest");
}

export async function createLocalProofItem(
  input: ProofItemInput,
  image: File | null,
): Promise<{ item: ProofItem; semanticReady: boolean }> {
  const fields = canonicalInput(input);
  if (image) {
    await validateProofImage(image);
    requiredString(image.name, "Proof image name", 1_024);
  }
  const imageBlob = image ? image.slice(0, image.size, image.type) : null;
  const timestamp = new Date().toISOString();
  const record: LocalProofRecord = {
    ...fields,
    id: crypto.randomUUID(),
    userId: LOCAL_PROOF_OWNER_ID,
    createdAt: timestamp,
    updatedAt: timestamp,
    imageBlob,
    imageName: image?.name ?? null,
    imageRevision: image ? crypto.randomUUID() : null,
    imageDigest: imageBlob ? await sha256(imageBlob) : null,
  };
  await addRecord(record);
  const item = mapRecord(record);
  publishLocalProofChange("change");
  return { item, semanticReady: false };
}

export async function updateLocalProofItem(
  existing: ProofItem,
  input: ProofItemInput,
  image: File | null,
  removeExistingImage: boolean,
): Promise<{
  item: ProofItem;
  semanticReady: boolean;
  cleanupFailed: boolean;
}> {
  if (
    existing.userId !== LOCAL_PROOF_OWNER_ID ||
    existing.visibility !== PROOF_VISIBILITY
  ) {
    throw new Error("Local Proof storage refused an item for another owner");
  }
  const fields = canonicalInput(input);
  if (image) {
    await validateProofImage(image);
    requiredString(image.name, "Proof image name", 1_024);
  }
  const imageDigest = image ? await sha256(image) : null;
  const record = await checkedUpdate(
    existing,
    fields,
    image,
    imageDigest,
    removeExistingImage,
  );
  revokeImageUrl(existing.id);
  const item = mapRecord(record);
  publishLocalProofChange("change");
  return {
    item,
    semanticReady: false,
    cleanupFailed: false,
  };
}

export async function deleteLocalProofItem(
  item: ProofItem,
): Promise<{ cleanupFailed: boolean }> {
  if (
    item.userId !== LOCAL_PROOF_OWNER_ID ||
    item.visibility !== PROOF_VISIBILITY
  ) {
    throw new Error("Local Proof storage refused an item for another owner");
  }
  await checkedDelete(item);
  revokeImageUrl(item.id);
  publishLocalProofChange("change");
  return { cleanupFailed: false };
}

const SEARCH_STOP_WORDS = new Set([
  "am",
  "against",
  "always",
  "are",
  "brain",
  "did",
  "evidence",
  "for",
  "from",
  "have",
  "here",
  "i",
  "me",
  "my",
  "not",
  "proof",
  "right",
  "saying",
  "show",
  "that",
  "the",
  "things",
  "this",
  "times",
  "what",
  "when",
  "with",
]);

const SEARCH_TERM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ended: ["end", "recovered", "recovery"],
  failing: ["fail", "failed", "failure"],
  finished: ["finish", "complete", "completed", "done", "shipped"],
  valued: ["chose", "chosen", "trusted", "hired", "enjoyed"],
};

function searchable(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function grammaticalForms(term: string): string[] {
  if (term.length > 4 && term.endsWith("ies")) {
    return [term, `${term.slice(0, -3)}y`];
  }
  if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) {
    return [term, term.slice(0, -1)];
  }
  return [term];
}

function queryTermGroups(query: string): string[][] {
  const all = [...new Set(searchable(query).split(/\s+/).filter(Boolean))];
  const meaningful = all.filter((term) => !SEARCH_STOP_WORDS.has(term));
  const selected = meaningful.length > 0 ? meaningful : all;
  return selected.map((term) => [
    ...new Set([
      ...grammaticalForms(term),
      ...(SEARCH_TERM_ALIASES[term] ?? []),
    ]),
  ]);
}

function containsTokenSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  if (sequence.length === 0 || sequence.length > tokens.length) return false;
  return tokens.some((_, start) =>
    sequence.every((term, offset) => tokens[start + offset] === term),
  );
}

function lexicalScore(record: LocalProofRecord, query: string): number {
  const termGroups = queryTermGroups(query);
  const phraseTokens = searchable(query).split(/\s+/).filter(Boolean);
  const fields = [
    { value: searchable(record.title), weight: 8 },
    { value: searchable(record.evidenceText), weight: 6 },
    { value: searchable(record.source ?? ""), weight: 5 },
    { value: searchable(record.tags.join(" ")), weight: 5 },
    { value: searchable(record.person ?? ""), weight: 4 },
    { value: searchable(record.project ?? ""), weight: 4 },
    { value: searchable(record.category), weight: 2 },
    { value: searchable(record.sourceType), weight: 2 },
    { value: searchable(record.occurredOn ?? ""), weight: 1 },
  ].map((field) => ({
    ...field,
    tokens: field.value.split(/\s+/).filter(Boolean),
  }));
  let score = 0;
  let matchedTerms = 0;

  for (const alternatives of termGroups) {
    let best = 0;
    for (const field of fields) {
      if (alternatives.some((term) => field.tokens.includes(term))) {
        best = Math.max(best, field.weight);
      }
    }
    if (best > 0) {
      matchedTerms += 1;
      score += best;
    }
  }

  if (matchedTerms === 0) return 0;
  score += (matchedTerms / Math.max(termGroups.length, 1)) * 10;
  if (
    fields.some((field) => containsTokenSequence(field.tokens, phraseTokens))
  ) {
    score += 12;
  }
  return score;
}

export async function searchLocalProofItems(
  query: string,
  filters: ProofFilters = EMPTY_PROOF_FILTERS,
): Promise<ProofSearchResult> {
  const trimmed = query.trim();
  if (trimmed.length < 3) throw new Error("Search needs at least 3 characters");
  if (trimmed.length > 2_000) {
    throw new Error("Search must be 2,000 characters or fewer");
  }
  const normalized = normalizedFilters(filters);
  const scored = (await allRecords())
    .filter((record) => recordMatchesFilters(record, normalized))
    .map((record) => ({ record, relevance: lexicalScore(record, trimmed) }))
    .filter(({ relevance }) => relevance > 0)
    .map(({ record, relevance }) => mapRecord(record, relevance));

  return {
    items: sortProofItems(scored, "relevance").slice(0, 10),
    semanticDegraded: true,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error("Proof backup image data is not canonical base64");
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Proof backup image data is not valid base64");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64(bytes) !== value) {
    throw new Error("Proof backup image data is not canonical base64");
  }
  return bytes;
}

async function backupImage(record: LocalProofRecord): Promise<BackupImage | null> {
  if (!record.imageBlob || !record.imageName || !record.imageDigest) return null;
  const digest = await sha256(record.imageBlob);
  if (digest !== record.imageDigest) {
    throw new Error(
      `Local image integrity check failed for Proof item ${record.id}`,
    );
  }
  const bytes = new Uint8Array(await record.imageBlob.arrayBuffer());
  return {
    name: record.imageName,
    type: record.imageBlob.type,
    size: record.imageBlob.size,
    integritySha256: digest,
    base64: bytesToBase64(bytes),
  };
}

function backupItemBody(
  record: Omit<LocalProofRecord, "userId">,
  image: BackupImage | null,
): BackupItemBody {
  return {
    id: record.id,
    title: record.title,
    evidenceText: record.evidenceText,
    occurredOn: record.occurredOn,
    category: record.category,
    sourceType: record.sourceType,
    source: record.source,
    tags: [...record.tags],
    person: record.person,
    project: record.project,
    provenance: record.provenance,
    visibility: PROOF_VISIBILITY,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    image,
  };
}

function canonicalBackupItemBody(body: BackupItemBody): Record<string, unknown> {
  return {
    id: body.id,
    title: body.title,
    evidenceText: body.evidenceText,
    occurredOn: body.occurredOn,
    category: body.category,
    sourceType: body.sourceType,
    source: body.source,
    tags: body.tags,
    person: body.person,
    project: body.project,
    provenance: body.provenance,
    visibility: body.visibility,
    createdAt: body.createdAt,
    updatedAt: body.updatedAt,
    image: body.image
      ? {
          name: body.image.name,
          type: body.image.type,
          size: body.image.size,
          integritySha256: body.image.integritySha256,
        }
      : null,
  };
}

async function itemIntegrityReceipt(
  body: BackupItemBody,
): Promise<BackupIntegrityReceipt> {
  return {
    purpose: "corruption-detection",
    algorithm: "SHA-256",
    sha256: await sha256Text(stableJson(canonicalBackupItemBody(body))),
  };
}

export async function exportLocalProofBackup(): Promise<Blob> {
  const records = (await allRecords()).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (records.length > MAX_BACKUP_ITEMS) {
    throw new Error("Proof Gallery has too many items for one safe backup");
  }
  const decodedImageBytes = records.reduce(
    (total, record) => total + (record.imageBlob?.size ?? 0),
    0,
  );
  if (decodedImageBytes > MAX_BACKUP_IMAGE_BYTES) {
    throw new Error(
      "Proof images are too large for one safe backup; split the gallery before exporting",
    );
  }
  const items: BackupItem[] = [];
  for (const record of records) {
    const body = backupItemBody(record, await backupImage(record));
    items.push({ ...body, integrity: await itemIntegrityReceipt(body) });
  }
  const document: BackupDocument = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    encryption: "none",
    exportedAt: new Date().toISOString(),
    items,
  };
  const backup = new Blob([`${JSON.stringify(document, null, 2)}\n`], {
    type: "application/json",
  });
  if (backup.size > MAX_BACKUP_BYTES) {
    throw new Error("Proof backup is too large to export safely");
  }
  return backup;
}

type ValidatedBackupItem = {
  record: Omit<LocalProofRecord, "userId"> & { userId?: never };
  body: BackupItemBody;
  integrity: BackupIntegrityReceipt;
};

function validateBackupIntegrity(value: unknown): BackupIntegrityReceipt {
  if (!isPlainObject(value)) {
    throw new Error("Proof backup item integrity receipt must be an object");
  }
  assertExactKeys(
    value,
    ["purpose", "algorithm", "sha256"],
    "Proof backup item integrity receipt",
  );
  if (
    value.purpose !== "corruption-detection" ||
    value.algorithm !== "SHA-256"
  ) {
    throw new Error(
      "Proof backup item integrity receipt must be labeled for SHA-256 corruption detection",
    );
  }
  const digest = requiredString(
    value.sha256,
    "Proof backup item integrity SHA-256",
    64,
  );
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error("Proof backup item integrity SHA-256 is invalid");
  }
  return {
    purpose: "corruption-detection",
    algorithm: "SHA-256",
    sha256: digest,
  };
}

function validateBackupImageDeclaration(value: unknown): BackupImage | null {
  if (value === null) return null;
  if (!isPlainObject(value)) {
    throw new Error("Proof backup image must be an object or null");
  }
  assertExactKeys(
    value,
    ["name", "type", "size", "integritySha256", "base64"],
    "Proof backup image",
  );
  const name = requiredString(value.name, "Proof image name", 1_024);
  if (typeof value.type !== "string" || !SAFE_IMAGE_TYPES.has(value.type)) {
    throw new Error("Proof backup image type is unsupported");
  }
  if (
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > MAX_IMAGE_BYTES
  ) {
    throw new Error("Proof backup image size is invalid");
  }
  const integritySha256 = requiredString(
    value.integritySha256,
    "Proof backup image integrity SHA-256",
    64,
  );
  if (!/^[0-9a-f]{64}$/.test(integritySha256)) {
    throw new Error("Proof backup image integrity SHA-256 is invalid");
  }
  if (typeof value.base64 !== "string") {
    throw new Error("Proof backup image data must be base64 text");
  }
  if (value.base64.length !== 4 * Math.ceil(value.size / 3)) {
    throw new Error("Proof backup image size does not match its encoded data");
  }
  return {
    name,
    type: value.type,
    size: value.size,
    integritySha256,
    base64: value.base64,
  };
}

function validateBackupItem(value: unknown): ValidatedBackupItem {
  if (!isPlainObject(value)) throw new Error("Proof backup item must be an object");
  assertExactKeys(
    value,
    [
      "id",
      "title",
      "evidenceText",
      "occurredOn",
      "category",
      "sourceType",
      "source",
      "tags",
      "person",
      "project",
      "provenance",
      "visibility",
      "createdAt",
      "updatedAt",
      "image",
      "integrity",
    ],
    "Proof backup item",
  );
  if (!isProofCategory(value.category)) {
    throw new Error("Proof backup contains an unsupported category");
  }
  if (!isProofSourceType(value.sourceType)) {
    throw new Error("Proof backup contains an unsupported source type");
  }
  if (value.visibility !== PROOF_VISIBILITY) {
    throw new Error("Proof backup contains a non-private item");
  }
  const createdAt = isoTimestamp(value.createdAt, "Created timestamp");
  const updatedAt = isoTimestamp(value.updatedAt, "Updated timestamp");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error("Updated timestamp cannot precede created timestamp");
  }

  const record = {
    id: uuid(value.id, "Proof id"),
    title: requiredString(value.title, "Title", 200),
    evidenceText: requiredString(value.evidenceText, "Evidence", 20_000),
    occurredOn: occurredDate(value.occurredOn),
    category: value.category,
    sourceType: value.sourceType,
    source: optionalString(value.source, "Source", 500),
    tags: validateTags(value.tags),
    person: optionalString(value.person, "Person", 200),
    project: optionalString(value.project, "Project", 200),
    provenance: provenance(value.provenance),
    visibility: PROOF_VISIBILITY,
    createdAt,
    updatedAt,
    imageBlob: null,
    imageName: null,
    imageRevision: null,
    imageDigest: null,
  };
  const image = validateBackupImageDeclaration(value.image);
  return {
    record,
    body: backupItemBody(record, image),
    integrity: validateBackupIntegrity(value.integrity),
  };
}

async function importedRecord(
  validated: ValidatedBackupItem,
): Promise<LocalProofRecord> {
  const expectedItemIntegrity = await itemIntegrityReceipt(validated.body);
  if (expectedItemIntegrity.sha256 !== validated.integrity.sha256) {
    throw new Error(
      "Proof backup item corruption-detection integrity check failed",
    );
  }
  const image = validated.body.image;
  if (image === null) {
    return { ...validated.record, userId: LOCAL_PROOF_OWNER_ID };
  }
  const bytes = base64ToBytes(image.base64);
  if (bytes.byteLength !== image.size) {
    throw new Error("Proof backup image size does not match its data");
  }
  const imageBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const file = new File([imageBuffer], image.name, { type: image.type });
  await validateProofImage(file);
  const actualDigest = await sha256(file);
  if (actualDigest !== image.integritySha256) {
    throw new Error(
      "Proof backup image corruption-detection integrity check failed",
    );
  }
  return {
    ...validated.record,
    userId: LOCAL_PROOF_OWNER_ID,
    imageBlob: file.slice(0, file.size, file.type),
    imageName: image.name,
    imageRevision: crypto.randomUUID(),
    imageDigest: actualDigest,
  };
}

async function parseBackup(blob: Blob): Promise<LocalProofRecord[]> {
  if (blob.size > MAX_BACKUP_BYTES) {
    throw new Error("Proof backup is too large to import safely");
  }
  let value: unknown;
  try {
    value = JSON.parse(await blob.text());
  } catch {
    throw new Error("Proof backup is not valid JSON");
  }
  if (!isPlainObject(value)) throw new Error("Proof backup must be an object");
  assertExactKeys(
    value,
    ["format", "version", "encryption", "exportedAt", "items"],
    "Proof backup",
  );
  if (value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) {
    throw new Error("Proof backup format or version is unsupported");
  }
  if (value.encryption !== "none") {
    throw new Error("This importer accepts only the declared unencrypted format");
  }
  isoTimestamp(value.exportedAt, "Export timestamp");
  if (!Array.isArray(value.items) || value.items.length > MAX_BACKUP_ITEMS) {
    throw new Error("Proof backup contains an invalid number of items");
  }

  const validatedItems: ValidatedBackupItem[] = [];
  const ids = new Set<string>();
  let decodedImageBytes = 0;
  for (const item of value.items) {
    const validated = validateBackupItem(item);
    if (ids.has(validated.record.id)) {
      throw new Error("Proof backup contains duplicate ids");
    }
    ids.add(validated.record.id);
    decodedImageBytes += validated.body.image?.size ?? 0;
    if (decodedImageBytes > MAX_BACKUP_IMAGE_BYTES) {
      throw new Error(
        "Proof backup declares more than 48 MiB of decoded image data",
      );
    }
    validatedItems.push(validated);
  }

  const records: LocalProofRecord[] = [];
  for (const validated of validatedItems) {
    records.push(await importedRecord(validated));
  }
  return records;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalRecord(record: LocalProofRecord): Record<string, unknown> {
  return {
    id: record.id,
    title: record.title,
    evidenceText: record.evidenceText,
    occurredOn: record.occurredOn,
    category: record.category,
    sourceType: record.sourceType,
    source: record.source,
    tags: record.tags,
    person: record.person,
    project: record.project,
    provenance: record.provenance,
    visibility: record.visibility,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    image:
      record.imageBlob && record.imageName && record.imageDigest
        ? {
            name: record.imageName,
            type: record.imageBlob.type,
            size: record.imageBlob.size,
            integritySha256: record.imageDigest,
          }
        : null,
  };
}

function recordsAreIdentical(
  current: LocalProofRecord,
  incoming: LocalProofRecord,
): boolean {
  return stableJson(canonicalRecord(current)) === stableJson(canonicalRecord(incoming));
}

async function insertNonConflictingRecords(
  records: LocalProofRecord[],
): Promise<LocalProofRecord[]> {
  if (records.length === 0) return [];
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(ITEM_STORE, "readwrite");
    const store = transaction.objectStore(ITEM_STORE);
    const inserted: LocalProofRecord[] = [];
    let explicitError: unknown = null;

    for (const record of records) {
      const request = store.get(record.id);
      request.onsuccess = () => {
        if (explicitError) return;
        try {
          if (request.result === undefined) {
            store.add(record);
            inserted.push(record);
            return;
          }
          const current = validateStoredRecord(request.result);
          if (!recordsAreIdentical(current, record)) {
            throw new Error(
              `Proof backup conflicts with the existing item ${record.id}; nothing was imported`,
            );
          }
        } catch (error) {
          explicitError = error;
          transaction.abort();
        }
      };
      request.onerror = () => {
        explicitError ??= request.error;
      };
    }

    transaction.oncomplete = () => resolve(inserted);
    transaction.onerror = () =>
      reject(
        explicitError ??
          transaction.error ??
          new Error("Local Proof import failed"),
      );
    transaction.onabort = () =>
      reject(
        explicitError ??
          transaction.error ??
          new Error("Local Proof import was aborted"),
      );
  });
}

export async function importLocalProofBackup(
  blob: Blob,
): Promise<LocalProofImportResult> {
  const records = await parseBackup(blob);
  const inserted = await insertNonConflictingRecords(records);
  const items = sortProofItems(
    inserted.map((record) => mapRecord(record)),
    "newest",
  );
  publishLocalProofChange("change");
  return {
    imported: inserted.length,
    importedCount: inserted.length,
    items,
  };
}

export async function clearLocalProofItems(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(ITEM_STORE, "readwrite");
  const clearPromise = requestResult(transaction.objectStore(ITEM_STORE).clear());
  await Promise.all([clearPromise, transactionComplete(transaction)]);
  releaseLocalProofImageUrls();
  publishLocalProofChange("clear");
}

export async function requestLocalProofPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage) return false;
  try {
    if (
      typeof navigator.storage.persisted === "function" &&
      (await navigator.storage.persisted())
    ) {
      return true;
    }
    return typeof navigator.storage.persist === "function"
      ? await navigator.storage.persist()
      : false;
  } catch {
    return false;
  }
}

export function releaseLocalProofImageUrls(): void {
  for (const id of [...objectUrlCache.keys()]) revokeImageUrl(id);
}
