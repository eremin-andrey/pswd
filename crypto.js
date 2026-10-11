// Шифрование хранилища: мастер-пароль → PBKDF2-SHA256 → ключ AES-256-GCM.
// Используется только встроенный в браузер WebCrypto, без сторонних библиотек.

export const ITERATIONS = 600000; // рекомендация OWASP для PBKDF2-SHA256
const MIN_ITERATIONS = 100000;   // файл с меньшим числом повторов считаем подозрительным

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

export async function deriveKey(password, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // ключ нельзя извлечь из браузера
    ['encrypt', 'decrypt']
  );
}

// Новый сеанс: случайная соль + ключ из пароля
export async function createSession(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  return { key, salt, iterations: ITERATIONS };
}

// Зашифровать данные → текст файла хранилища. Каждое сохранение — новый IV.
export async function seal(session, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc.encode(JSON.stringify(data));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.key, plain));
  return JSON.stringify({
    format: 'pswd-vault',
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: session.iterations,
    salt: toB64(session.salt),
    iv: toB64(iv),
    ct: toB64(ct),
  });
}

// Проверить, что текст похож на файл хранилища (без расшифровки)
export function parseVault(text) {
  let h;
  try { h = JSON.parse(text); } catch { throw new Error('Файл не похож на хранилище паролей'); }
  if (!h || h.format !== 'pswd-vault' || h.v !== 1) throw new Error('Неизвестный формат файла');
  if (!Number.isInteger(h.iter) || h.iter < MIN_ITERATIONS) throw new Error('Слишком мало повторов PBKDF2 — файл подозрительный');
  return h;
}

// Расшифровать текст файла → { session, data }
export async function open(text, password) {
  const h = parseVault(text);
  const salt = fromB64(h.salt);
  const iv = fromB64(h.iv);
  const ct = fromB64(h.ct);
  const key = await deriveKey(password, salt, h.iter);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    throw new Error('Неверный мастер-пароль или файл повреждён');
  }
  return { session: { key, salt, iterations: h.iter }, data: JSON.parse(dec.decode(plain)) };
}

// Генератор паролей без перекоса распределения (отбрасываем «лишние» байты)
export function generatePassword(length = 20) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?';
  const limit = 256 - (256 % chars.length);
  let out = '';
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += chars[b % chars.length];
    }
  }
  return out;
}
