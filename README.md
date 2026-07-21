# 📚 Aprender Español — Audio Learner + Combine

Личная система изучения испанского языка из двух приложений:

| Приложение | Платформа | Назначение |
|---|---|---|
| **Combine** ([combine/](combine/)) | macOS (Electron) | Генерация аудио-уроков из размеченного текста через ElevenLabs TTS (или бесплатный mock-режим на macOS `say`) |
| **Audio Learner** ([ios/](ios/)) | iOS 17+ (SwiftUI) | Плеер уроков: сессии с повторениями/скоростью/паузами, spaced repetition, статистика, lock screen |

Данные передаются между приложениями **ZIP-архивом** (`lesson.json` + MP3). Никаких серверов, аккаунтов и облаков.

## Структура репозитория

```
docs/      — полные спецификации (SPEC_COMBINE, SPEC_iOS_AUDIO_LEARNER, ARCHITECTURE, DEPLOYMENT)
             и DECISIONS.md — принятые отклонения от спеки (приоритетнее спеки!)
shared/    — контракт между приложениями:
             lesson.schema.json  — JSON Schema формата lesson.json
             sample-lessons/     — образцы входного текста (#TOPIC / ##BLOCK / #WORD)
             fixtures/           — готовый фикстурный ZIP для тестов iOS (речь macOS say)
scripts/   — make-fixture.mjs: пересборка фикстурного ZIP
combine/   — Electron-приложение (генератор)
ios/       — iOS-приложение (XcodeGen, xcodeproj генерируется)
```

## Быстрый старт

### Combine (Desktop)

```bash
cd combine
npm install
npm run dev        # Electron в dev-режиме
npm test           # vitest (без сетевых вызовов)
npm run cli -- generate --input ../shared/sample-lessons/topic-04.txt --provider mock_say
```

Без API-ключа ElevenLabs приложение работает в **mock-режиме** (речь синтезирует macOS `say` — бесплатно,
но слышимо и полноценно). Ключ вводится в настройках и хранится в Keychain. Перед дорогой генерацией целой темы
используйте «Тестовую генерацию» — один короткий запрос для проверки ключа и качества голоса.

### iOS Audio Learner

```bash
cd ios
xcodegen generate                     # создаёт AudioLearner.xcodeproj из project.yml
open AudioLearner.xcodeproj           # или сборка из CLI:
xcodebuild -scheme AudioLearner -destination 'platform=iOS Simulator,name=iPhone 15 Pro' build test
```

Установка на iPhone: открыть проект в Xcode → Signing & Capabilities → выбрать Team → Run на устройство.

### Пересборка тестовой фикстуры

```bash
npm install        # в корне (lamejs)
npm run make-fixture
```

## Документация

Читать в порядке: [docs/INDEX.md](docs/INDEX.md) → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) →
спецификация нужного приложения → **[docs/DECISIONS.md](docs/DECISIONS.md)** (обязательно — фиксирует
все отличия реализации от исходной спеки).

## Принципы

- **Локально и приватно**: без аккаунтов, аналитики и синхронизации.
- **Тесты не тратят деньги**: реальный ElevenLabs API в тестах не вызывается никогда (см. D-12).
- **Контракт первичен**: `shared/lesson.schema.json` — единственный источник истины формата урока.
