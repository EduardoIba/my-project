export const DATA_KEY = 'importlaser-compras-v1';
export const CLEANUP_VERSION = 'real-use-1';
export const BACKUP_KEY = `${DATA_KEY}-backup-before-${CLEANUP_VERSION}`;
export const PURCHASE_RESET_VERSION = 'fresh-start-2026-11-05';
export const RESET_BACKUP_KEY = `${DATA_KEY}-backup-before-${PURCHASE_RESET_VERSION}`;

// Explicitly requested fresh start. Back up and verify the original before
// changing operational data; this token must never change on routine releases.
export function loadDatabase(storage, defaults) {
  const raw = storage.getItem(DATA_KEY);
  const original = raw === null ? {} : JSON.parse(raw);
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('Dados locais inválidos.');
  const db = {...defaults, requests: [], imports: [], ...original};
  if (db.purchaseResetVersion === PURCHASE_RESET_VERSION) return db;
  let backupKey = RESET_BACKUP_KEY;
  if (raw !== null) {
    const existingBackup = storage.getItem(RESET_BACKUP_KEY);
    let matches = false;
    try {matches = existingBackup !== null && JSON.parse(existingBackup).originalRaw === raw;} catch {}
    if (!matches) {
      if (existingBackup !== null) backupKey += `-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const backup = JSON.stringify({createdAt: new Date().toISOString(), sourceKey: DATA_KEY, originalRaw: raw, data: original});
      storage.setItem(backupKey, backup);
      if (storage.getItem(backupKey) !== backup) throw new Error('Não foi possível verificar o backup anterior à limpeza.');
    }
  }
  const clean = {...db, requests: [], imports: [], activeBatchId: '', purchaseResetVersion: PURCHASE_RESET_VERSION,
    ...(raw !== null ? {resetBackupKey: backupKey} : {})};
  for (const field of ['purchases', 'generatedOrders', 'orderHistory', 'purchaseOperations']) {
    if (Object.hasOwn(clean, field)) clean[field] = [];
  }
  storage.setItem(DATA_KEY, JSON.stringify(clean));
  return clean;
}

export function downloadJson(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
