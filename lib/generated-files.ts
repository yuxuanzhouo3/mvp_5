import { randomUUID } from "node:crypto";

const GENERATED_FILE_TTL_MS = 60 * 60 * 1000;

export type StoredGeneratedFile = {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  createdAt: number;
  expiresAt: number;
};

type GeneratedFileStore = Map<string, StoredGeneratedFile>;

const globalForGeneratedFiles = globalThis as typeof globalThis & {
  __mvp5GeneratedFileStore__?: GeneratedFileStore;
};

function getGeneratedFileStore() {
  if (!globalForGeneratedFiles.__mvp5GeneratedFileStore__) {
    globalForGeneratedFiles.__mvp5GeneratedFileStore__ = new Map();
  }

  return globalForGeneratedFiles.__mvp5GeneratedFileStore__;
}

function cleanupExpiredGeneratedFiles(store: GeneratedFileStore) {
  const now = Date.now();
  for (const [fileId, record] of Array.from(store.entries())) {
    if (record.expiresAt <= now) {
      store.delete(fileId);
    }
  }
}

export function storeGeneratedFile(input: {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const store = getGeneratedFileStore();
  cleanupExpiredGeneratedFiles(store);

  const now = Date.now();
  const record: StoredGeneratedFile = {
    id: randomUUID(),
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    createdAt: now,
    expiresAt: now + GENERATED_FILE_TTL_MS,
  };

  store.set(record.id, record);
  return record;
}

export function readGeneratedFile(fileId: string) {
  const store = getGeneratedFileStore();
  cleanupExpiredGeneratedFiles(store);

  const record = store.get(fileId);
  if (!record) {
    return null;
  }

  if (record.expiresAt <= Date.now()) {
    store.delete(fileId);
    return null;
  }

  return record;
}
