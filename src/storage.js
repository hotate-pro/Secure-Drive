const DB_NAME = "secure-drive-auth";
const DB_VERSION = 1;

let dbPromise;
let masterKeyPromise;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
      if (!db.objectStoreNames.contains("users")) db.createObjectStore("users", { keyPath: "id" });
      if (!db.objectStoreNames.contains("logs")) db.createObjectStore("logs", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("IndexedDB transaction aborted"));
  });
}

function reqResult(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get(store, key) {
  return reqResult((await openDB()).transaction(store).objectStore(store).get(key));
}

async function put(store, value) {
  return tx(store, "readwrite", s => s.put(value));
}

async function getAll(store) {
  return reqResult((await openDB()).transaction(store).objectStore(store).getAll());
}

async function deleteItem(store, key) {
  return tx(store, "readwrite", s => s.delete(key));
}

async function getOrCreateMasterKey() {
  if (masterKeyPromise) return masterKeyPromise;
  masterKeyPromise = (async () => {
    const existing = await get("meta", "master-key");
    if (existing?.key) return existing.key;
    const key = await crypto.subtle.generateKey(
      { name:"AES-GCM", length:256 }, false, ["encrypt","decrypt"]
    );
    await put("meta", { id:"master-key", key });
    return key;
  })();
  return masterKeyPromise;
}

async function encryptJSON(value) {
  const key = await getOrCreateMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const data = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, plain);
  return { iv:[...iv], data:[...new Uint8Array(data)] };
}

async function decryptJSON(payload) {
  const key = await getOrCreateMasterKey();
  const data = await crypto.subtle.decrypt(
    {name:"AES-GCM", iv:new Uint8Array(payload.iv)},
    key, new Uint8Array(payload.data)
  );
  return JSON.parse(new TextDecoder().decode(data));
}

export async function sha256(text) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

export async function hasUsers() {
  return (await getAll("users")).length > 0;
}

export async function saveUser(user) {
  const protectedData = await encryptJSON({
    embedding: user.embedding,
    cardHash: user.cardHash
  });
  await put("users", {
    id:user.id,
    name:user.name,
    role:user.role,
    disabled:!!user.disabled,
    createdAt:user.createdAt,
    protectedData
  });
}

export async function listUsers() {
  const rows = await getAll("users");
  const out = [];
  for (const row of rows) {
    try {
      const p = await decryptJSON(row.protectedData);
      out.push({...row, embedding:p.embedding, cardHash:p.cardHash});
    } catch {
      out.push({...row, corrupt:true});
    }
  }
  return out;
}

export async function deleteUser(id) {
  await deleteItem("users", id);
}

export async function writeLog(type, detail={}) {
  await put("logs", {
    id:crypto.randomUUID(),
    type,
    at:new Date().toISOString(),
    detail
  });
}

export async function getLogs() {
  return getAll("logs");
}

export async function getMeta(id) {
  return get("meta", id);
}

export async function setMeta(id, value) {
  return put("meta", {id, ...value});
}
