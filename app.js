import { createSession, seal, open, parseVault, generatePassword } from './crypto.js';

const STORAGE_KEY = 'pswd-vault';
const AUTO_LOCK_MS = 3 * 60 * 1000;   // блокировка после 3 минут бездействия
const CLIPBOARD_CLEAR_MS = 30 * 1000; // попытка очистить буфер обмена через 30 секунд
const VERSION = 8;                    // меняется вместе с CACHE в sw.js

const $ = id => document.getElementById(id);

// Расшифрованные данные живут только в памяти и только пока хранилище открыто
let session = null;
let entries = [];
let selectedId = null;
let editingId = null;
let lockTimer = null;

// ---------- Хранение зашифрованного файла ----------
// На Mac локальный сервер (server.py) пишет файл на диск.
// Без сервера (например, на iPhone) — хранилище браузера.

const API = 'api/vault';
const API_HEADERS = { 'X-Pswd': '1' };
let useServer = false;

async function detectServer() {
  try {
    const r = await fetch(API, { headers: API_HEADERS, cache: 'no-store' });
    // Наш server.py всегда присылает X-Pswd-Path; обычный хостинг (GitHub Pages) — нет
    const path = r.headers.get('X-Pswd-Path');
    if (!path || (r.status !== 200 && r.status !== 404)) return;
    useServer = true;
    $('vault-location').textContent = 'Файл: ' + decodeURIComponent(path);
  } catch { /* сервера нет */ }
}

async function loadVaultText() {
  if (useServer) {
    const r = await fetch(API, { headers: API_HEADERS, cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Сервер не отдал файл хранилища');
    return r.text();
  }
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

async function saveVaultText(text) {
  if (useServer) {
    const r = await fetch(API, { method: 'PUT', headers: { ...API_HEADERS, 'Content-Type': 'text/plain' }, body: text });
    if (!r.ok) throw new Error('сервер не записал файл (код ' + r.status + ')');
    return;
  }
  localStorage.setItem(STORAGE_KEY, text);
}

async function persist() {
  await saveVaultText(await seal(session, { entries }));
}

// ---------- Экраны ----------

function show(name) {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== 'screen-' + name;
  const focus = { setup: 'setup-pw', lock: 'unlock-pw', main: 'search', edit: 'edit-name', change: 'change-pw' }[name];
  if (focus) $(focus).focus();
}

function status(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.className = isError ? 'error' : '';
  clearTimeout(status.t);
  if (text) status.t = setTimeout(() => { el.textContent = ''; }, 4000);
}

async function start() {
  lock();
  await detectServer();
  try {
    show((await loadVaultText()) ? 'lock' : 'setup');
  } catch (err) {
    show('lock');
    status(err.message, true);
  }
}

function lock() {
  session = null;
  entries = [];
  selectedId = null;
  editingId = null;
  clearTimeout(lockTimer);
  for (const id of ['unlock-pw', 'setup-pw', 'setup-pw2', 'change-pw', 'change-pw2', 'search',
                    'edit-name', 'edit-login', 'edit-password', 'edit-note']) $(id).value = '';
  $('list').replaceChildren();
  $('card').hidden = true;
}

function lockNow() {
  if (!session) return;
  lock();
  show('lock');
  status('Хранилище заблокировано');
}

function touch() {
  if (!session) return;
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lockNow, AUTO_LOCK_MS);
}

function busy(form, on) {
  for (const b of form.querySelectorAll('button')) b.disabled = on;
}

// ---------- Создание и вход ----------

$('form-setup').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('setup-pw').value;
  if (pw !== $('setup-pw2').value) return status('Пароли не совпадают', true);
  busy(e.target, true);
  try {
    session = await createSession(pw);
    entries = [];
    await persist();
    enterMain();
    status('Хранилище создано');
  } catch (err) {
    status('Ошибка: ' + err.message, true);
  } finally {
    busy(e.target, false);
  }
});

$('form-unlock').addEventListener('submit', async e => {
  e.preventDefault();
  busy(e.target, true);
  status('Проверяю…');
  try {
    const res = await open(await loadVaultText(), $('unlock-pw').value);
    session = res.session;
    entries = Array.isArray(res.data.entries) ? res.data.entries : [];
    $('unlock-pw').value = '';
    enterMain();
    status('');
  } catch (err) {
    status(err.message, true);
    $('unlock-pw').select();
  } finally {
    busy(e.target, false);
  }
});

function enterMain() {
  show('main');
  renderList();
  touch();
}

// ---------- Поиск и просмотр ----------

function sorted() {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const found = sorted().filter(e => !q || e.name.toLowerCase().includes(q) || (e.login || '').toLowerCase().includes(q));
  const items = found.map(e => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = e.name; // только textContent — никакого HTML из данных
    if (e.id === selectedId) b.classList.add('selected');
    b.addEventListener('click', () => select(e.id));
    li.append(b);
    return li;
  });
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = entries.length ? 'Ничего не найдено' : 'Записей пока нет — нажмите ＋';
    items.push(li);
  }
  $('list').replaceChildren(...items);
  // Единственное совпадение открываем сразу
  if (q && found.length === 1 && found[0].id !== selectedId) select(found[0].id);
  if (selectedId && !found.some(e => e.id === selectedId)) { selectedId = null; $('card').hidden = true; }
}

function select(id) {
  selectedId = id;
  const e = entries.find(x => x.id === id);
  if (!e) return;
  $('card-name').textContent = e.name;
  $('card-login').textContent = e.login || '—';
  $('card-password').textContent = e.password || '';
  $('card-password').classList.add('masked');
  $('btn-reveal').textContent = 'Показать';
  $('card-note').textContent = e.note || '';
  $('card').hidden = false;
  for (const b of $('list').querySelectorAll('button')) b.classList.toggle('selected', b.textContent === e.name);
}

$('search').addEventListener('input', renderList);

$('btn-reveal').addEventListener('click', () => {
  const masked = $('card-password').classList.toggle('masked');
  $('btn-reveal').textContent = masked ? 'Показать' : 'Скрыть';
});

for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', async () => {
    const e = entries.find(x => x.id === selectedId);
    if (!e) return;
    const value = e[btn.dataset.copy] || '';
    try {
      await navigator.clipboard.writeText(value);
      status('Скопировано. Буфер очистится через 30 секунд');
      setTimeout(async () => {
        try {
          if ((await navigator.clipboard.readText()) === value) await navigator.clipboard.writeText('');
        } catch { /* браузер может не разрешить — не страшно */ }
      }, CLIPBOARD_CLEAR_MS);
    } catch {
      status('Не удалось скопировать', true);
    }
  });
}

// ---------- Добавление, изменение, удаление ----------

function openEditor(entry) {
  editingId = entry ? entry.id : null;
  $('edit-title').textContent = entry ? 'Изменить запись' : 'Новая запись';
  $('edit-name').value = entry ? entry.name : $('search').value.trim();
  $('edit-login').value = entry ? entry.login || '' : '';
  $('edit-password').value = entry ? entry.password || '' : generatePassword();
  $('edit-note').value = entry ? entry.note || '' : '';
  show('edit');
}

$('btn-add').addEventListener('click', () => openEditor(null));
$('btn-edit').addEventListener('click', () => openEditor(entries.find(x => x.id === selectedId)));
$('btn-generate').addEventListener('click', () => { $('edit-password').value = generatePassword(); });
$('btn-cancel').addEventListener('click', () => { show('main'); });

$('form-edit').addEventListener('submit', async e => {
  e.preventDefault();
  const record = {
    id: editingId || crypto.randomUUID(),
    name: $('edit-name').value.trim(),
    login: $('edit-login').value.trim(),
    password: $('edit-password').value,
    note: $('edit-note').value.trim(),
  };
  if (!record.name) return status('Укажите название', true);
  const before = entries;
  entries = editingId ? entries.map(x => (x.id === editingId ? record : x)) : [...entries, record];
  try {
    await persist();
  } catch (err) {
    entries = before;
    return status('Не удалось сохранить: ' + err.message, true);
  }
  show('main');
  $('search').value = record.name;
  renderList();
  select(record.id);
  status('Сохранено');
});

$('btn-delete').addEventListener('click', async () => {
  const e = entries.find(x => x.id === selectedId);
  if (!e || !confirm(`Удалить запись «${e.name}»?`)) return;
  const before = entries;
  entries = entries.filter(x => x.id !== e.id);
  try {
    await persist();
  } catch (err) {
    entries = before;
    return status('Не удалось удалить: ' + err.message, true);
  }
  selectedId = null;
  $('card').hidden = true;
  renderList();
  status('Удалено');
});

// ---------- Файл хранилища: экспорт и импорт ----------

$('btn-export').addEventListener('click', async () => {
  const text = await loadVaultText();
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pswd-vault.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Файл сохранён. Он зашифрован — его можно положить в iCloud Drive');
});

for (const btn of document.querySelectorAll('[data-action="import"]')) {
  btn.addEventListener('click', () => $('file-import').click());
}

$('file-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    parseVault(text);
    if ((await loadVaultText()) && !confirm('Заменить текущее хранилище на этом устройстве содержимым файла?')) return;
    await saveVaultText(text);
    lock();
    show('lock');
    status('Файл загружен. Введите его мастер-пароль');
  } catch (err) {
    status(err.message, true);
  }
});

// ---------- Смена мастер-пароля ----------

$('btn-change-pw').addEventListener('click', () => show('change'));
$('btn-change-cancel').addEventListener('click', () => { $('change-pw').value = $('change-pw2').value = ''; show('main'); });

$('form-change').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('change-pw').value;
  if (pw !== $('change-pw2').value) return status('Пароли не совпадают', true);
  busy(e.target, true);
  try {
    session = await createSession(pw); // новая соль и новый ключ
    await persist();
    $('change-pw').value = $('change-pw2').value = '';
    show('main');
    status('Мастер-пароль изменён. Не забудьте заново сохранить файл для других устройств');
  } catch (err) {
    status('Ошибка: ' + err.message, true);
  } finally {
    busy(e.target, false);
  }
});

// ---------- Автоблокировка ----------

$('btn-lock').addEventListener('click', lockNow);
for (const ev of ['pointerdown', 'keydown', 'input']) document.addEventListener(ev, touch, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) lockNow(); });

// ---------- Запуск ----------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

$('app-version').textContent = 'Версия ' + VERSION;

if (!window.isSecureContext || !crypto.subtle) {
  document.querySelector('main').textContent = 'Откройте приложение по адресу https:// (или http://localhost) — иначе браузер не даёт доступ к шифрованию.';
} else {
  start();
}
