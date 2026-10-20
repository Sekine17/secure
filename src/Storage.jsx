const DB_NAME = "checkin-kiosk";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("kv").objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- Server + brauzer yaddaşı ---------- */

export async function dbGet(key) {
  let r = null;
  try {
    r = await fetch(`/api/kv/${key}`, { cache: "no-store" });
  } catch {
    r = null;
  }
  if (r && r.ok) {
    const j = await r.json();
    if (j.value !== null && j.value !== undefined) return j.value;
    return idbGet(key); // serverdə hələ yoxdur: köhnə brauzer məlumatı
  }
  throw new Error("server oxunmadı");
}

export async function dbSet(key, value) {
  try {
    await idbSet(key, value);
  } catch {
    /* ehtiyat nüsxə alınmadı */
  }
  const r = await fetch(`/api/kv/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw new Error("server");
}

/* ---------- Admin parolu (hash ilə saxlanılır) ---------- */

const SALT = "checkin-kiosk::";
export const DEFAULT_PASSWORD = "admin123";

async function sha256(text) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return "x" + h;
}

export async function isDefaultPassword() {
  try {
    return !(await dbGet("auth"));
  } catch {
    return true;
  }
}

export async function verifyPassword(input) {
  let stored;
  try {
    stored = await dbGet("auth");
  } catch {
    stored = null;
  }
  if (!stored) return input === DEFAULT_PASSWORD;
  return (await sha256(SALT + input)) === stored;
}

export async function changePassword(newPassword) {
  await dbSet("auth", await sha256(SALT + newPassword));
}