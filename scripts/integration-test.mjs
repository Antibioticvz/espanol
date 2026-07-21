#!/usr/bin/env node
/**
 * Интеграционный тест конвейера: Combine CLI (mock_say) → lesson.json → ZIP.
 * Проверяет контракт shared/lesson.schema.json на РЕАЛЬНОМ выводе генератора.
 * iOS-сторона цикла покрыта XCTest-тестами импорта фикстуры в ios/.
 *
 * Запуск:  node scripts/integration-test.mjs          # быстрый (образец 9 фраз)
 *          node scripts/integration-test.mjs --full   # полный (тема 02, 73 фразы, ~2-3 мин)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FULL = process.argv.includes('--full');
const INPUT = FULL ? 'shared/course/topic-02.txt' : 'shared/sample-lessons/topic-04.txt';

const fail = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`✅ ${msg}`);

if (!existsSync(join(ROOT, 'combine', 'package.json'))) {
  fail('combine/ ещё не существует — интеграционный тест запускается после merge приложения Combine.');
}

const out = mkdtempSync(join(tmpdir(), 'espanol-int-'));
console.log(`▶ Генерация ${INPUT} через mock_say → ${out}`);

const gen = spawnSync('npm', ['run', 'cli', '--silent', '--', 'generate',
  '--input', join(ROOT, INPUT), '--provider', 'mock_say', '--out', out, '--export-zip'],
  { cwd: join(ROOT, 'combine'), stdio: 'inherit', timeout: 15 * 60 * 1000 });
if (gen.status !== 0) fail(`CLI завершился с кодом ${gen.status}`);

// Папка урока = единственная поддиректория out
const lessonDirs = readdirSync(out).filter((d) => statSync(join(out, d)).isDirectory());
if (lessonDirs.length !== 1) fail(`Ожидалась 1 папка урока в ${out}, найдено: ${lessonDirs.join(', ')}`);
const lessonDir = join(out, lessonDirs[0]);

// 1. lesson.json соответствует схеме
const lesson = JSON.parse(readFileSync(join(lessonDir, 'lesson.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const schema = JSON.parse(readFileSync(join(ROOT, 'shared', 'lesson.schema.json'), 'utf8'));
if (!ajv.compile(schema)(lesson)) fail('lesson.json не проходит схему:\n' + JSON.stringify(ajv.compile(schema).errors ?? ajv.errors, null, 2));
ok('lesson.json валиден против shared/lesson.schema.json');

// 2. Все элементы done, все аудиофайлы на месте и не пустые
const items = [];
for (const b of lesson.blocks) {
  if (b.groups) b.groups.forEach((g) => items.push(...g.phrases));
  if (b.words) items.push(...b.words);
  if (b.type === 'story') items.push(b);
}
for (const it of items) {
  if (it.status !== 'done') fail(`Элемент не done: ${it.id ?? 'story'} (${it.status})`);
  for (const lang of ['es', 'ru']) {
    const p = join(lessonDir, it.audio[lang]);
    if (!existsSync(p)) fail(`Нет файла ${it.audio[lang]}`);
    if (statSync(p).size < 500) fail(`Подозрительно маленький файл ${it.audio[lang]}`);
    if (!(it.duration_ms[lang] > 0)) fail(`duration_ms.${lang} не положительный у ${it.id ?? 'story'}`);
  }
}
ok(`Все ${items.length} элементов done, ${items.length * 2} MP3 на месте, длительности > 0`);

// 3. Счётчики stats сходятся с фактом
const expect = FULL
  ? { phrase_count: 73, vocab_count: 0, story_count: 0 }
  : { phrase_count: 9, vocab_count: 4, story_count: 1 };
for (const [k, v] of Object.entries(expect)) {
  if (lesson.stats[k] !== v) fail(`stats.${k} = ${lesson.stats[k]}, ожидалось ${v}`);
}
ok(`Счётчики совпали: ${JSON.stringify(expect)}`);

// 4. ZIP существует и содержит lesson.json + столько же mp3
const zips = readdirSync(out).filter((f) => f.endsWith('.zip'))
  .concat(readdirSync(lessonDir).filter((f) => f.endsWith('.zip')).map((f) => join(lessonDirs[0], f)));
if (zips.length === 0) fail('ZIP не найден после --export-zip');
const zipPath = join(out, zips[0]);
const list = spawnSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
const mp3InZip = (list.stdout.match(/\.mp3/g) || []).length;
if (!list.stdout.includes('lesson.json')) fail('В ZIP нет lesson.json');
if (mp3InZip !== items.length * 2) fail(`В ZIP ${mp3InZip} mp3, ожидалось ${items.length * 2}`);
ok(`ZIP корректен: lesson.json + ${mp3InZip} MP3 (${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} МБ)`);

rmSync(out, { recursive: true, force: true });
console.log('\n🎉 Интеграционный тест пройден: Combine CLI → lesson.json → ZIP соответствуют контракту.');
