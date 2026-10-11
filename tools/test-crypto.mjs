// Проверка модуля шифрования: node tools/test-crypto.mjs
import assert from 'node:assert/strict';
import { createSession, seal, open, generatePassword, fromB64, toB64 } from '../crypto.js';

const data = { entries: [{ id: '1', name: 'gmail.com', login: 'me@gmail.com', password: 'Пароль-с-кириллицей 🔑', note: '' }] };
const session = await createSession('правильный пароль');
const file = await seal(session, data);

// 1. В файле нет открытого текста
assert.ok(!file.includes('gmail') && !file.includes('me@'), 'открытый текст в файле');
console.log('✓ файл не содержит открытого текста');

// 2. Правильный пароль — данные совпадают
assert.deepEqual((await open(file, 'правильный пароль')).data, data);
console.log('✓ расшифровка верным паролем');

// 3. Неверный пароль — ошибка
await assert.rejects(open(file, 'неправильный'), /Неверный мастер-пароль/);
console.log('✓ неверный пароль отклонён');

// 4. Подмена одного байта шифротекста — обнаружена
const h = JSON.parse(file);
const ct = fromB64(h.ct); ct[5] ^= 1;
await assert.rejects(open(JSON.stringify({ ...h, ct: toB64(ct) }), 'правильный пароль'), /повреждён/);
console.log('✓ подмена данных обнаружена');

// 5. Занижение числа повторов PBKDF2 — отклонено
await assert.rejects(open(JSON.stringify({ ...h, iter: 1000 }), 'правильный пароль'), /подозрительный/);
console.log('✓ ослабленный файл отклонён');

// 6. Каждое сохранение даёт другой шифротекст (новый IV)
assert.notEqual(JSON.parse(await seal(session, data)).ct, h.ct);
console.log('✓ новый IV при каждом сохранении');

// 7. Повторное открытие → сохранение → открытие
const reopened = await open(file, 'правильный пароль');
assert.deepEqual((await open(await seal(reopened.session, data), 'правильный пароль')).data, data);
console.log('✓ пересохранение после открытия');

// 8. Генератор паролей
const pw = generatePassword(20);
assert.equal(pw.length, 20);
assert.notEqual(pw, generatePassword(20));
console.log('✓ генератор паролей:', pw);
