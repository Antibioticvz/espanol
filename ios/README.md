# Audio Learner (iOS)

SwiftUI-плеер аудио-уроков испанского: сессии с повторениями/скоростью/паузами,
интервальное повторение (SRS), статистика, lock screen, фоновое воспроизведение,
Home Screen виджет. Уроки импортируются ZIP-архивом из генератора Combine
(контракт — `shared/lesson.schema.json`).

- **Deployment target:** iOS 17.0 (см. `docs/DECISIONS.md` D-07)
- **Архитектура:** MVVM + Services + Repository, CoreData (программная модель), `@Observable`
- **Проект генерируется XcodeGen** — `*.xcodeproj` в git не хранится (D-08)
- **Зависимости:** ZIPFoundation (SPM)

## Требования

- macOS + Xcode 26.x
- `xcodegen` (brew: `brew install xcodegen`)
- Симуляторный рантайм iOS 26.2 для сборки/тестов (проект таргетирует iOS 17.0)

## Генерация проекта

```bash
cd ios
xcodegen generate            # создаёт AudioLearner.xcodeproj из project.yml
```

Регенерируйте после добавления/удаления файлов или изменения `project.yml`.
Сам `.xcodeproj` не коммитится (в `.gitignore`).

## Сборка (симулятор)

```bash
cd ios
# Найдите/создайте симулятор с рантаймом iOS 26.2:
xcrun simctl list devices | grep -A20 'iOS 26.2'
# Пример: iPhone 17 (UDID). Если нужного нет — создайте:
#   xcrun simctl create "Test-26" "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-26-2

UDID=<ваш-UDID>
xcodebuild -project AudioLearner.xcodeproj -scheme AudioLearner \
  -destination "platform=iOS Simulator,id=$UDID" \
  CODE_SIGNING_ALLOWED=NO build
```

Для симулятора подпись не нужна (`CODE_SIGNING_ALLOWED=NO`).

## Тесты

```bash
cd ios
xcodebuild -project AudioLearner.xcodeproj -scheme AudioLearner \
  -destination "platform=iOS Simulator,id=$UDID" \
  CODE_SIGNING_ALLOWED=NO test
```

Тесты используют in-memory CoreData (SQLite на `/dev/null`) и фикстуру
`AudioLearnerTests/Fixtures/lesson-04-hablar-de-mi-mismo.zip` (копия из
`shared/fixtures/`). Покрытие: импорт и индексация (9 фраз / 4 слова / 1 рассказ /
28 аудио), конфликты обновить/заменить, переходы SRS на границах 3/8 и
рекомендации по датам, статистика (streak/heatmap/CSV), построение очереди сессии,
Codable lesson.json и отклонение несовместимой `schema_version`.

## Установка на устройство (iPhone)

1. `cd ios && xcodegen generate && open AudioLearner.xcodeproj`
2. Target **AudioLearner** → вкладка **Signing & Capabilities**:
   - включите **Automatically manage signing**;
   - выберите свою **Team**;
   - при необходимости смените **Bundle Identifier** на уникальный
     (по умолчанию `com.victor.audiolearner`; виджет — `.widget`).
3. Повторите выбор Team для таргета **AudioLearnerWidgetExtension**.
4. App Groups: обе цели используют `group.com.victor.audiolearner`
   (для передачи статистики в виджет). При смене Team включите одинаковую
   App Group в обоих таргетах.
5. Выберите устройство и **Product → Run**.

## Импорт урока

- Через приложение: вкладка **Уроки** → **＋** → **Выбрать файл ZIP**.
- Через iOS: откройте `.zip` в Files → **Поделиться / Открыть в…** → **Audio Learner**
  (обрабатывается Document Types + `onOpenURL`).

Файлы копируются в `Documents/AudioLearner/lessons/<topicId>/`. Импорт существующего
урока предлагает: **Обновить** (заменить аудио/тексты, сохранить прогресс фраз) или
**Заменить** (снести всё).

## Структура

```
ios/
├── project.yml                 # источник истины проекта (XcodeGen)
├── AudioLearner/
│   ├── App.swift, AppEnvironment.swift, Views/ContentView.swift
│   ├── Models/                 # Codable DTO (LessonManifest), Types, SessionConfig
│   │   └── CoreData/           # программная модель + 9 сущностей
│   ├── ViewModels/             # SessionFlow, Player/Import/PhraseSelection/Statistics VM
│   ├── Views/                  # Lessons / Session / Statistics / Settings / Components
│   ├── Services/
│   │   ├── Repositories/       # LessonRepository (CRUD + индексация)
│   │   ├── Import/             # FileImportService (ZIP)
│   │   ├── Audio/              # SessionPlayerService, LockScreenService, AudioSessionManager
│   │   ├── Learning/           # SpacedRepeat, Statistics, Achievements
│   │   └── Backup/             # BackupService
│   └── Utilities/              # AppSettings, Haptics, Formatters, Colors, Logger
├── AudioLearnerWidget/         # WidgetKit (статистика дня)
├── AudioLearnerTests/          # XCTest + Fixtures/
└── Shared/                     # WidgetSharedStore (App Group), общий для app+widget
```
