# Combine

Desktop-генератор аудио-уроков испанского языка: превращает размеченный текстовый файл
(`#TOPIC` / `##BLOCK` / `#WORD` / `#CATEGORY` / фразы `ES | RU` / `story`) в набор MP3-файлов
с ID3-тегами и `lesson.json`, готовый к экспорту в ZIP для приложения Audio Learner (iOS).

Полная спецификация — [`../docs/SPEC_COMBINE.md`](../docs/SPEC_COMBINE.md), принятые отклонения
от неё — [`../docs/DECISIONS.md`](../docs/DECISIONS.md) (приоритетнее спеки), формат входного
текста подробно — [`../docs/LESSON_FORMAT.md`](../docs/LESSON_FORMAT.md), контракт `lesson.json` —
[`../shared/lesson.schema.json`](../shared/lesson.schema.json).

## Статус

Main-процесс (все core-сервисы), CLI и IPC-мост — реализованы и покрыты тестами. Renderer
(4 экрана — Импорт/Настройки/Генерация/Библиотека) строится параллельно в ветке
`feat/combine-ui`; в этой ветке вместо него — минимальная заглушка (`src/renderer/App.tsx`),
нужная только для того, чтобы `npm run build`/`npm run dev:web` имели точку входа. При merge
она будет заменена настоящим интерфейсом; каналы IPC (`src/main/ipc-handlers.ts`,
`src/preload/index.ts`) — рабочий вариант этого агента, финальные имена согласует оркестратор.

## Требования

- macOS (провайдер `mock_say` использует системный `say`; голоса по умолчанию — `Mónica` (es),
  `Milena` (ru), но при их отсутствии на машине происходит graceful fallback — см. ниже)
- Node.js ≥ 20 (тестировалось на 22)

## Установка и запуск

```bash
npm install                # из папки combine/
npm run dev                 # Electron в dev-режиме (HMR renderer)
npm run dev:web              # renderer в браузере с mock-IPC — см. docs/DECISIONS.md D-09
npm run build                # electron-vite build (main+preload+renderer) → out/
npm run typecheck            # tsc --noEmit (main/preload/core/cli, затем renderer)
npm test                     # vitest run — без единого реального сетевого вызова
npm run cli -- <parse|generate|export> ...
```

`npm run build` собирает приложение, но **не** упаковывает установщик (`electron-builder` здесь
не используется/не запускается) — это сознательно оставлено оркестратору.

## Провайдеры синтеза речи

| Провайдер | Стоимость | Что нужно |
|---|---|---|
| `mock_say` | бесплатно, офлайн | ничего — использует macOS `say` |
| `elevenlabs` | реальные деньги (~$0.05–0.10 / 1000 симв.) | API-ключ ElevenLabs |

**`mock_say` и голоса по умолчанию.** Если `Mónica`/`Milena` не установлены на машине (CI, чужой
Mac), провайдер сам подбирает первый установленный голос нужной локали (`es_*`/`ru_*`); если и
такого нет — использует системный голос по умолчанию (без `-v`) и предупреждает в лог/статус.
Смотри `src/core/tts/say-voices.ts` и `src/core/tts/mock-say.service.ts`.

**API-ключ ElevenLabs** в приложении шифруется через Electron `safeStorage` и никогда не пишется
на диск в открытом виде (`src/core/settings/settings.service.ts` + `src/main/electron-encryptor.ts`).
В CLI ключ **не сохраняется вообще** — передаётся флагом `--api-key` или переменной окружения
`ELEVENLABS_API_KEY` при каждом запуске.

## CLI (headless, без Electron)

```bash
# Проверка формата без генерации
npm run cli -- parse --input ../shared/sample-lessons/topic-04.txt

# Генерация через бесплатный mock_say + экспорт ZIP
npm run cli -- generate \
  --input ../shared/course/topic-02.txt \
  --provider mock_say \
  --out ~/lessons \
  --export-zip

# Генерация через реальный ElevenLabs (тратит деньги!)
npm run cli -- generate \
  --input ../shared/course/topic-03.txt \
  --provider elevenlabs --api-key "$ELEVENLABS_API_KEY" \
  --voice-es <voice_id_es> --voice-ru <voice_id_ru> \
  --model eleven_multilingual_v2 \
  --out ~/lessons --export-zip

# Экспорт уже сгенерированного урока в ZIP отдельно
npm run cli -- export --lesson ~/lessons/02-gotovka-i-kuhnya
```

Опции `generate`: `--concurrency`, `--max-retries`, `--delay-ms`, `--timeout-ms`, `--stability`,
`--similarity-boost`, `--seed`, `--no-id3`. Повторный запуск `generate` с тем же `--out` резюмирует
существующий урок (обрабатывает только `pending`/`failed` — идемпотентно, готовые файлы не
пересоздаются). `Ctrl+C` во время генерации сохраняет прогресс перед выходом.

Интеграционный тест всего конвейера CLI → `lesson.json` → ZIP (реальный `mock_say`, проверка по
`shared/lesson.schema.json` и распаковка ZIP через системный `unzip`) — в корне монорепо:

```bash
node ../scripts/integration-test.mjs          # быстрый: sample-lessons/topic-04.txt (9 фраз)
node ../scripts/integration-test.mjs --full   # полный: shared/course/topic-02.txt (73 фразы, ~2-3 мин)
```

## Тесты

```bash
npm test
```

Все тесты — против локальных стабов/реальных бесплатных вызовов, **никогда** не обращаются к
настоящему `api.elevenlabs.io` (см. `docs/CLAUDE.md` правило №1 и `docs/DECISIONS.md` D-12):

- `src/core/parser/parser.service.test.ts` — все 4 типа блоков, YAML front-matter, построчные
  ошибки, золотые тесты против `shared/sample-lessons/topic-04.txt` (9 фраз/4 слова/1 рассказ) и
  реальных уроков курса `shared/course/topic-0{2,3,4}.txt` (73/0/0, 84/14/1, 81/14/1 —
  многословные/диакритические ключи `#WORD`, повтор ключа в разных блоках — валиден, повтор
  внутри одного блока — ошибка).
- `src/core/tts/eleven-labs.service.test.ts` — локальный HTTP-стаб (`node:http` на 127.0.0.1,
  инжектируемый `baseUrl`): успех, 429→backoff→успех, `Retry-After`, 401/400 без ретрая, таймаут
  (включая таймаут во время чтения тела ответа), 5xx.
- `src/core/tts/say-voices.test.ts`, `mock-say.service.test.ts` — разбор `say -v '?'` (на
  замокированной строке) и graceful fallback голосов; реальный вызов `say`+lamejs → валидный MP3.
- `src/core/queue/generation-queue.test.ts` — конкурентность, пауза/резюме, идемпотентность,
  отмена, live-стоимость.
- `src/core/file/file.service.test.ts` — `lesson.json` валиден по `shared/lesson.schema.json`
  (ajv), ID3-теги, ZIP экспортируется и распаковывается обратно, статус библиотеки.
- `src/core/settings/settings.service.test.ts`, `src/core/cost/cost-calculator.test.ts`.
- `src/cli/cli.e2e.test.ts` — реальный запуск CLI как отдельного процесса на маленьком (3
  элемента) уроке: `lesson.json` + слышимые MP3 + ZIP, плюс код возврата `parse` на ошибке.

## Структура

```
combine/
├── src/
│   ├── core/          # чистый Node (без Electron) — переиспользуется main-процессом и CLI
│   │   ├── parser/     ParserService
│   │   ├── tts/         TTSProvider, ElevenLabsService, MockSayService, say-voices
│   │   ├── queue/       GenerationQueue, build-items (ParsedLesson ⇄ lesson.json ⇄ задачи)
│   │   ├── file/        FileService (диск, lesson.json, ID3, ZIP, библиотека)
│   │   ├── settings/    SettingsService + Encryptor (Electron-независимый)
│   │   ├── cost/        CostCalculator
│   │   ├── types/       Общие типы (lesson-json.ts зеркалит shared/lesson.schema.json)
│   │   └── util/        slug/транслитерация, WAV→MP3, общие пути
│   ├── main/           Electron main: окно, IPC-хендлеры, сеанс генерации, safeStorage
│   ├── preload/        contextBridge → window.combine
│   ├── renderer/        ЗАГЛУШКА (см. «Статус» выше)
│   └── cli/             generate/parse/export
└── README.md            (этот файл)
```

## Известные ограничения

- Renderer — заглушка (см. «Статус»).
- macOS only (провайдер `mock_say`, ID3/Keychain — предполагают macOS; см. §13 спеки).
- Экспорт для реального ElevenLabs (401/429/5xx-поведение) проверялся против локального
  HTTP-стаба, не против настоящего API — ручная проверка с реальным ключом требуется отдельно
  (см. `docs/DECISIONS.md` D-12).
