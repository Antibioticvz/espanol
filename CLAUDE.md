# CLAUDE.md — правила работы в репозитории espanol

## Что это

Монорепо системы изучения испанского: `combine/` (Electron-генератор аудио-уроков через ElevenLabs/mock),
`ios/` (SwiftUI-плеер Audio Learner). Контракт между ними — `shared/lesson.schema.json` (lesson.json + ZIP).

## Жёсткие правила

1. **Никогда не вызывать реальный ElevenLabs API из тестов или скриптов** — каждый запрос платный.
   Тесты используют локальный HTTP-стаб; для ручной проверки есть mock-провайдер `mock_say` (macOS `say`).
2. `shared/lesson.schema.json` — источник истины формата. Менять формат = менять схему + оба приложения + фикстуру.
3. `docs/DECISIONS.md` приоритетнее исходных SPEC_*.md. Новые осознанные отклонения — фиксировать там же.
4. UI-строки обоих приложений — на русском. Код, идентификаторы, коммиты — на английском.
5. `ios/AudioLearner.xcodeproj` не редактировать и не коммитить — он генерируется из `ios/project.yml` (XcodeGen).

## Команды

```bash
# Combine
cd combine && npm install
npm run dev          # Electron dev
npm run dev:web      # renderer в браузере с mock-IPC (быстрая проверка UI)
npm test             # vitest
npm run typecheck && npm run build

# iOS
cd ios && xcodegen generate
xcodebuild -project AudioLearner.xcodeproj -scheme AudioLearner \
  -destination 'platform=iOS Simulator,name=<симулятор>' build test

# Фикстура (корень)
npm run make-fixture   # пересобирает shared/fixtures/*.zip через say+lamejs
```

## Тестовое окружение

- macOS, Node 22, Xcode 26.2 (симуляторы iOS 17.4 и 26.2). iPhone пользователя — iOS 26.5.2.
- Deployment target iOS: 17.0.
- Голоса macOS для mock: `Mónica` (es_ES), `Milena` (ru_RU).

## Стиль

- TypeScript strict; без `any` без причины. Swift: SwiftUI + @Observable, MVVM + Services (см. спеку).
- Коммиты: conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), маленькие и осмысленные.
