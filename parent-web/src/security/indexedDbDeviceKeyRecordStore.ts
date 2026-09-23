import type { DeviceKeyRecord, DeviceKeyRecordStore } from './deviceKeyCustody';

/**
 * IndexedDB adapter for durable Owner device-key custody.
 *
 * This is the ONLY platform-bound part of custody, and it is deliberately reduced
 * to read/write/remove of a single opaque record so that every security decision
 * lives in `deviceKeyCustody.ts` where it can be tested deterministically without
 * a browser. Nothing here inspects, transforms, or exports key material: the
 * record is handed to IndexedDB and handed back, and the platform's
 * structured-clone algorithm carries the live `CryptoKey` handles. No JWK, no raw
 * bytes, no Base64, no string form of the private key ever exists in this file.
 *
 * WHY INDEXEDDB AND NOT WEB STORAGE: localStorage and sessionStorage can only hold
 * strings, so the only way to use them would be to serialize the private key --
 * which is exactly what the approved design forbids. IndexedDB is the one browser
 * store that can hold a non-extractable CryptoKey by structured clone without the
 * key's bytes ever becoming readable to script.
 *
 * FAIL-CLOSED BEHAVIOUR:
 *  - No IndexedDB (private mode, disabled storage, unsupported context): `read`
 *    reports "nothing stored" rather than throwing, so the caller treats it as
 *    having no key and fails closed. `write` THROWS, because reporting success for
 *    a key that was not persisted would let a caller believe durable authority
 *    exists when it does not.
 *  - A clone failure (a platform that cannot structured-clone CryptoKey) also
 *    throws from `write` for the same reason. It is never silently swallowed.
 *
 * KNOWN LIMITS, not overstated: IndexedDB is per-origin, per-browser-profile, and
 * clearable by the user, by the browser under storage pressure, or by clearing
 * site data. Any of those is DEVICE LOSS, not permission to re-genesis. Nothing
 * here is hardware-backed, and no platform binding is claimed.
 */

const DATABASE_NAME = 'pca-owner-device-key';
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = 'custody';
const RECORD_KEY = 'owner-device-key';

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        // Out-of-line keys: exactly one record, addressed by a fixed constant.
        database.createObjectStore(OBJECT_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open the device-key custody database.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(OBJECT_STORE_NAME, mode);
      const request = action(transaction.objectStore(OBJECT_STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Device-key custody request failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Device-key custody transaction aborted.'));
    });
  } finally {
    database.close();
  }
}

export function createIndexedDbDeviceKeyRecordStore(): DeviceKeyRecordStore {
  return {
    async read() {
      if (!isIndexedDbAvailable()) return undefined;
      try {
        return await withStore<unknown>('readonly', (store) => store.get(RECORD_KEY));
      } catch {
        // Treated as "nothing usable stored". The caller fails closed on null and
        // never generates a replacement key on its own.
        return undefined;
      }
    },

    async write(record: DeviceKeyRecord) {
      if (!isIndexedDbAvailable()) {
        throw new Error('IndexedDB is unavailable, so the owner device key cannot be durably custodied in this browser context.');
      }
      // Deliberately NOT caught: a clone or quota failure must surface, because a
      // caller that believes a key is durable when it is not has lost the key.
      await withStore<IDBValidKey>('readwrite', (store) => store.put(record, RECORD_KEY));
    },

    async remove() {
      if (!isIndexedDbAvailable()) return;
      await withStore<undefined>('readwrite', (store) => store.delete(RECORD_KEY) as unknown as IDBRequest<undefined>);
    },
  };
}
