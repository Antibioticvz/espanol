#!/usr/bin/env node
/**
 * Собирает фикстурный урок (lesson.json + MP3 + ZIP) из образца topic-04.
 * Речь — macOS `say` (Mónica/Milena), MP3 — lamejs (без ffmpeg).
 * Результат валидируется против shared/lesson.schema.json.
 *
 * Запуск: npm run make-fixture
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lame from '@breezystack/lamejs';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';

const Mp3Encoder = lame.Mp3Encoder ?? lame.default?.Mp3Encoder;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOICES = { es: 'Mónica', ru: 'Milena' };
const SAMPLE_RATE = 22050;
const KBPS = 64;

// ── Содержимое урока (зеркало shared/sample-lessons/topic-04.txt) ──────────────
const LESSON = {
  topicNumber: 4,
  topicId: '04-hablar-de-mi-mismo',
  titleRu: 'Рассказ о себе',
  titleEs: 'Cuéntame sobre ti',
  blocks: [
    {
      id: 'b1', type: 'verb_group', titleRu: 'Кто я — происхождение и факты',
      groups: [
        { key: 'llamarse', translationRu: 'зваться', phrases: [
          ['Me llamo Victor.', 'Меня зовут Виктор.'],
          ['¿Cómo te llamas tú?', 'Как тебя зовут?'],
          ['Todos me llaman Vic, para abreviar.', 'Все зовут меня Вик, для краткости.'],
        ]},
        { key: 'tener', translationRu: 'иметь (возраст)', phrases: [
          ['Tengo cuarenta años.', 'Мне сорок лет.'],
          ['¿Cuántos años tienes tú?', 'Сколько лет тебе?'],
        ]},
      ],
    },
    {
      id: 'b2', type: 'phrase_group', titleRu: 'Ходовые фразы',
      groups: [
        { key: 'conocer', titleRu: 'Первое знакомство', phrases: [
          ['Mucho gusto, soy Victor.', 'Очень приятно, я Виктор.'],
          ['Encantado de conocerte.', 'Приятно познакомиться.'],
        ]},
        { key: 'trabajo', titleRu: 'О работе', phrases: [
          ['Soy programador.', 'Я программист.'],
          ['Trabajo a distancia.', 'Я работаю удалённо.'],
        ]},
      ],
    },
    {
      id: 'b3', type: 'vocabulary', titleRu: 'Ключевая лексика',
      words: [
        ['el programador', 'программист'],
        ['a distancia', 'удалённо'],
        ['la familia', 'семья'],
        ['el hermano', 'брат'],
      ],
    },
    {
      id: 'b4', type: 'story', titleRu: 'Короткий рассказ',
      textEs: 'Me llamo Victor y tengo cuarenta años. Soy programador y trabajo a distancia. Tengo una familia grande y un hermano menor.',
      textRu: 'Меня зовут Виктор, мне сорок лет. Я программист и работаю удалённо. У меня большая семья и младший брат.',
    },
  ],
};

// ── WAV → PCM Int16 ────────────────────────────────────────────────────────────
function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Не WAV-файл');
  }
  let offset = 12, fmt = null, data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV без fmt/data чанков');
  if (fmt.bits !== 16 || fmt.channels !== 1) throw new Error(`Ожидался mono 16-bit, получено ${fmt.channels}ch ${fmt.bits}bit`);
  return { samples: new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2), sampleRate: fmt.sampleRate };
}

// ── PCM → MP3 ──────────────────────────────────────────────────────────────────
function encodeMp3(samples, sampleRate) {
  const enc = new Mp3Encoder(1, sampleRate, KBPS);
  const parts = [];
  for (let i = 0; i < samples.length; i += 1152) {
    const out = enc.encodeBuffer(samples.subarray(i, Math.min(i + 1152, samples.length)));
    if (out.length) parts.push(Buffer.from(out));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  return Buffer.concat(parts);
}

// ── Синтез одной строки → MP3-файл, возвращает длительность в мс ───────────────
function synth(text, lang, outPath, tmp) {
  const wavPath = join(tmp, 'utt.wav');
  execFileSync('say', ['-v', VOICES[lang], '-o', wavPath, '--file-format=WAVE', `--data-format=LEI16@${SAMPLE_RATE}`, text]);
  const { samples, sampleRate } = parseWav(readFileSync(wavPath));
  writeFileSync(outPath, encodeMp3(samples, sampleRate));
  return Math.round((samples.length / sampleRate) * 1000);
}

// ── Основная сборка ────────────────────────────────────────────────────────────
function main() {
  const started = Date.now();
  const tmp = join(tmpdir(), `espanol-fixture-${process.pid}`);
  const lessonDir = join(tmp, LESSON.topicId);
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  mkdirSync(join(lessonDir, 'audio', 'es'), { recursive: true });
  mkdirSync(join(lessonDir, 'audio', 'ru'), { recursive: true });

  let charsEs = 0, charsRu = 0, phraseCount = 0, vocabCount = 0, storyCount = 0;

  const makeItem = (id, es, ru) => {
    charsEs += es.length; charsRu += ru.length;
    const audio = { es: `audio/es/${id}.mp3`, ru: `audio/ru/${id}.mp3` };
    console.log(`  🔊 ${id}`);
    const durEs = synth(es, 'es', join(lessonDir, audio.es), tmp);
    const durRu = synth(ru, 'ru', join(lessonDir, audio.ru), tmp);
    return {
      id, es, ru, audio,
      duration_ms: { es: durEs, ru: durRu },
      status: 'done', id3_tags_written: false, generated_at: now,
    };
  };

  const blocks = LESSON.blocks.map((b, bi) => {
    const base = { block_id: b.id, type: b.type, title_ru: b.titleRu, order_index: bi };
    if (b.type === 'verb_group' || b.type === 'phrase_group') {
      return { ...base, groups: b.groups.map((g, gi) => ({
        key: g.key,
        title_ru: g.titleRu ?? null,
        translation_ru: g.translationRu ?? null,
        order_index: gi,
        phrases: g.phrases.map(([es, ru], pi) => { phraseCount++; return makeItem(`${pad(LESSON.topicNumber)}-${b.id}-${g.key}-${pad(pi + 1)}`, es, ru); }),
      }))};
    }
    if (b.type === 'vocabulary') {
      return { ...base, words: b.words.map(([es, ru], wi) => { vocabCount++; return makeItem(`${pad(LESSON.topicNumber)}-${b.id}-vocab-${pad(wi + 1)}`, es, ru); }) };
    }
    // story
    storyCount++;
    charsEs += b.textEs.length; charsRu += b.textRu.length;
    const id = `${pad(LESSON.topicNumber)}-story`;
    const audio = { es: `audio/es/${id}.mp3`, ru: `audio/ru/${id}.mp3` };
    console.log(`  🔊 ${id}`);
    const durEs = synth(b.textEs, 'es', join(lessonDir, audio.es), tmp);
    const durRu = synth(b.textRu, 'ru', join(lessonDir, audio.ru), tmp);
    return {
      ...base, text_es: b.textEs, text_ru: b.textRu, audio,
      duration_ms: { es: durEs, ru: durRu },
      split_by_phrase: false, status: 'done', id3_tags_written: false, generated_at: now,
    };
  });

  const lessonJson = {
    schema_version: '1.0',
    topic_id: LESSON.topicId,
    topic_number: LESSON.topicNumber,
    title_ru: LESSON.titleRu,
    title_es: LESSON.titleEs,
    created_at: now,
    generator_version: 'fixture-1.0.0',
    config: {
      provider: 'mock_say', model: 'macos_say',
      voice_es: { id: VOICES.es, name: VOICES.es },
      voice_ru: { id: VOICES.ru, name: VOICES.ru },
      stability: null, similarity_boost: null, seed: null,
    },
    stats: {
      phrase_count: phraseCount, vocab_count: vocabCount, story_count: storyCount,
      total_elements: phraseCount + vocabCount + storyCount,
      characters_es: charsEs, characters_ru: charsRu, total_characters: charsEs + charsRu,
      estimated_cost_usd: 0, actual_cost_usd: 0,
      generation_duration_seconds: null, file_size_mb: null,
    },
    blocks,
  };

  // Валидация против схемы — фикстура обязана соответствовать контракту
  const schema = JSON.parse(readFileSync(join(ROOT, 'shared', 'lesson.schema.json'), 'utf8'));
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(lessonJson)) {
    console.error('❌ lesson.json не проходит схему:', JSON.stringify(validate.errors, null, 2));
    process.exit(1);
  }

  writeFileSync(join(lessonDir, 'lesson.json'), JSON.stringify(lessonJson, null, 2));

  const zipName = `lesson-${LESSON.topicId}.zip`;
  const zipTmp = join(tmp, zipName);
  const res = spawnSync('zip', ['-r', '-X', '-q', zipTmp, 'lesson.json', 'audio'], { cwd: lessonDir });
  if (res.status !== 0) throw new Error(`zip завершился с кодом ${res.status}: ${res.stderr}`);

  const outDir = join(ROOT, 'shared', 'fixtures');
  mkdirSync(outDir, { recursive: true });
  copyFileSync(zipTmp, join(outDir, zipName));
  const sizeMb = (statSync(join(outDir, zipName)).size / 1024 / 1024).toFixed(2);
  rmSync(tmp, { recursive: true, force: true });

  console.log(`✅ ${zipName} (${sizeMb} МБ, ${phraseCount} фраз + ${vocabCount} слов + ${storyCount} рассказ, схема валидна, ${((Date.now() - started) / 1000).toFixed(1)} c)`);
}

const pad = (n) => String(n).padStart(2, '0');
main();
