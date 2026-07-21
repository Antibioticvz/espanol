# Спецификация: iOS приложение "Audio Learner"

> ⚠️ **Историческое ТЗ.** Реализация местами осознанно отклоняется — список отклонений в [DECISIONS.md](DECISIONS.md), при противоречии приоритетен он.

**Версия:** 1.0  
**Платформа:** iOS 15+, iPad OS 15+  
**Язык разработки:** Swift + SwiftUI  
**Базовые фреймворки:** AVFoundation, CoreData, MediaPlayer  

---

## 1. ОБЗОР И ФИЛОСОФИЯ

### 1.1 Назначение
Audio Learner — **полнофункциональное мобильное приложение** для обучения иностранным языкам через:
- Воспроизведение аудио-нарезок с синхронизацией текста
- Управление сессиями обучения (повторения, скорость, паузы)
- Отслеживание прогресса (spaced repetition, статистика)
- Поддержка режимов воспроизведения (плей, loop, фоновая работа)

### 1.2 Целевой пользователь
- Студент/учащийся испанского языка (B1-B2)
- Использует приложение ежедневно на прогулке, в дороге, во время спорта
- Занятия: 15-60 минут в день
- Нужна гибкость: выбор фраз, настройка темпа, отслеживание прогресса

### 1.3 Ключевые отличия от обычного плеера
- **Спaced Repetition**: интервальное повторение (fирма выученного материала)
- **Lock Screen Integration**: текст фразы на экране блокировки
- **Session Mode**: настройка: N повторений × скорость × пауза
- **Progress Tracking**: каждая фраза имеет статус (learning / inProgress / mastered)
- **Widget**: информация о текущей сессии на главном экране / lock screen
- **Offline**: полностью локальное, никаких аккаунтов

---

## 2. АРХИТЕКТУРА И ТЕХНИЧЕСКИЙ СТЕК

### 2.1 Архитектура (MVVM + Repository)

```
┌─────────────────────────────────────────────────────────┐
│                     iOS App (SwiftUI)                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Views (SwiftUI)                                  │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ • ContentView                                    │  │
│  │ • LessonListView                                 │  │
│  │ • ImportLessonView                               │  │
│  │ • PhraseSelectionView                            │  │
│  │ • SessionConfigView                              │  │
│  │ • SessionPlayerView                              │  │
│  │ • StatisticsView                                 │  │
│  │ • SettingsView                                   │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↓                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ViewModels (@Observable, @State)                │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ • LessonViewModel                                │  │
│  │ • SessionViewModel                               │  │
│  │ • PlayerViewModel                                │  │
│  │ • StatisticsViewModel                            │  │
│  │ • SettingsViewModel                              │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↓                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Services & Repositories                          │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ • LessonRepository (CoreData CRUD)               │  │
│  │ • SessionPlayerService (AVFoundation)            │  │
│  │ • AudioEngineService (AVAudioEngine)             │  │
│  │ • LockScreenService (MPNowPlayingInfoCenter)     │  │
│  │ • SpacedRepeatService (логика SRS)               │  │
│  │ • StatisticsService (расчёты статистики)         │  │
│  │ • FileImportService (распаковка ZIP)             │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↓                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Models (CoreData + Codable)                      │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ • Lesson (урок)                                  │  │
│  │ • LessonBlock (блок внутри урока)                │  │
│  │ • Phrase (фраза)                                 │  │
│  │ • AudioFile (файл audio)                         │  │
│  │ • LessonProgress (прогресс по уроку)             │  │
│  │ • LearningSession (выполненная сессия)           │  │
│  │ • PhraseStatistics (статистика фразы)            │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↓                              │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Local Storage                                    │  │
│  ├──────────────────────────────────────────────────┤  │
│  │ • CoreData (Phrase, Session, Progress)           │  │
│  │ • FileManager (Documents/AudioLearner/lessons)   │  │
│  │ • UserDefaults (предпочтения)                    │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Проектная структура

```
AudioLearner/
├── Models/
│   ├── Lesson.swift           # CoreData entity
│   ├── LessonBlock.swift
│   ├── Phrase.swift
│   ├── AudioFile.swift
│   ├── LessonProgress.swift
│   ├── LearningSession.swift
│   ├── PhraseStatistics.swift
│   ├── SessionConfig.swift    # Codable для сохранения
│   └── Types.swift            # Enums (PhraseState и т.д.)
│
├── ViewModels/
│   ├── LessonViewModel.swift
│   ├── SessionViewModel.swift
│   ├── PlayerViewModel.swift
│   ├── StatisticsViewModel.swift
│   ├── SettingsViewModel.swift
│   └── ImportViewModel.swift
│
├── Views/
│   ├── ContentView.swift       # Main tab view
│   ├── Lessons/
│   │   ├── LessonListView.swift
│   │   ├── LessonDetailView.swift
│   │   └── ImportLessonView.swift
│   ├── Session/
│   │   ├── PhraseSelectionView.swift
│   │   ├── SessionConfigView.swift
│   │   ├── SessionPlayerView.swift
│   │   └── SessionCompletedView.swift
│   ├── Statistics/
│   │   ├── StatisticsMainView.swift
│   │   ├── LessonStatsView.swift
│   │   ├── WordCloudView.swift
│   │   └── CalendarHeatmapView.swift
│   ├── Settings/
│   │   ├── SettingsView.swift
│   │   ├── AppearanceView.swift
│   │   └── AboutView.swift
│   └── Components/
│       ├── PhraseCard.swift
│       ├── ProgressBar.swift
│       ├── AudioWaveform.swift
│       ├── FilterBar.swift
│       └── StateIndicator.swift
│
├── Services/
│   ├── Repositories/
│   │   └── LessonRepository.swift
│   ├── Audio/
│   │   ├── SessionPlayerService.swift
│   │   ├── AudioEngineService.swift
│   │   └── LockScreenService.swift
│   ├── Learning/
│   │   ├── SpacedRepeatService.swift
│   │   └── StatisticsService.swift
│   └── Import/
│       └── FileImportService.swift
│
├── Utilities/
│   ├── DateFormatter+Extensions.swift
│   ├── Colors.swift
│   ├── Strings.swift
│   └── Haptics.swift
│
├── App.swift                   # @main
├── AudioLearner.entitlements
├── Info.plist
└── Localizable.strings         # i18n (опционально)
```

### 2.3 Фреймворки и зависимости

**Встроенные (из iOS SDK):**
- `SwiftUI` — UI фреймворк
- `AVFoundation` — аудио воспроизведение, контроль скорости
- `MediaPlayer` — lock screen управление
- `CoreData` — локальная БД
- `FileManager` — работа с файлами
- `Combine` — reactive programming
- `NotificationCenter` — сигналы между компонентами

**SPM (Swift Package Manager) опционально:**
- `ZipFoundation` — распаковка ZIP архивов
- `Charts` — графики статистики (опционально)

---

## 3. МОДЕЛИ ДАННЫХ (COREDATA)

### 3.1 Lesson (Урок)

```swift
@Entity
@NSManaged class Lesson {
    @NSManaged var topicId: String           // Primary key: "04-hablar-de-mi-mismo"
    @NSManaged var topicNumber: Int          // 1-50
    @NSManaged var titleRu: String           // "Рассказ о себе"
    @NSManaged var titleEs: String?          // "Cuéntame sobre ti"
    @NSManaged var createdAt: Date           // дата создания урока
    @NSManaged var importedAt: Date          // дата импорта на iOS
    @NSManaged var generatorVersion: String  // "1.0.0"
    
    // Связи
    @NSManaged var blocks: NSSet<LessonBlock>        // 1-to-many
    @NSManaged var progress: LessonProgress?         // 1-to-1
    @NSManaged var sessions: NSSet<LearningSession>  // 1-to-many
    @NSManaged var audioFiles: NSSet<AudioFile>      // 1-to-many
    
    // Метаданные для быстрого доступа
    @NSManaged var phraseCount: Int          // кэшированное значение
    @NSManaged var vocabCount: Int
    @NSManaged var characterCountEs: Int
    @NSManaged var characterCountRu: Int
}
```

### 3.2 LessonBlock (Блок)

```swift
@Entity
@NSManaged class LessonBlock {
    @NSManaged var blockId: String           // "b1", "b2", ...
    @NSManaged var type: String              // "verb_group", "phrase_group", "vocabulary", "story"
    @NSManaged var titleRu: String           // "Кто я — происхождение и факты"
    @NSManaged var orderIndex: Int           // 0, 1, 2, 3...
    
    // Связи
    @NSManaged var lesson: Lesson
    @NSManaged var groups: NSSet<PhraseGroup>  // 1-to-many (для verb_group, phrase_group)
    @NSManaged var phrases: NSSet<Phrase>      // 1-to-many (напрямую для vocabulary)
}
```

### 3.3 PhraseGroup (Группа фраз)

```swift
@Entity
@NSManaged class PhraseGroup {
    @NSManaged var groupId: String           // "llamarse", "Первое знакомство"
    @NSManaged var key: String
    @NSManaged var translationRu: String?    // перевод (для verb_group)
    @NSManaged var orderIndex: Int
    
    // Связи
    @NSManaged var block: LessonBlock
    @NSManaged var phrases: NSSet<Phrase>    // 1-to-many
}
```

### 3.4 Phrase (Фраза)

```swift
@Entity
@NSManaged class Phrase {
    @NSManaged var phraseId: String          // "04-b1-llamarse-01"
    @NSManaged var textEs: String            // "Me llamo Victor."
    @NSManaged var textRu: String            // "Меня зовут Виктор."
    
    // Аудио
    @NSManaged var audioFileEs: AudioFile?
    @NSManaged var audioFileRu: AudioFile?
    
    // Прогресс обучения
    @NSManaged var state: String             // "learning", "inProgress", "mastered"
    @NSManaged var lastReviewDate: Date?     // дата последнего повтора
    @NSManaged var reviewCount: Int = 0      // сколько раз повторяли
    @NSManaged var nextReviewDate: Date?     // для SRS (когда повторять)
    @NSManaged var easeFactor: Double = 2.5  // для SM-2 алгоритма (опционально)
    @NSManaged var interval: Int = 1         // интервал в днях (опционально)
    
    // Связи
    @NSManaged var group: PhraseGroup?
    @NSManaged var lesson: Lesson?
    @NSManaged var statistics: PhraseStatistics?
    
    // Вычисляемое свойство
    var durationSeconds: TimeInterval {
        (audioFileEs?.durationMs ?? 0 + audioFileRu?.durationMs ?? 0) / 1000.0
    }
}
```

### 3.5 AudioFile (Файл аудио)

```swift
@Entity
@NSManaged class AudioFile {
    @NSManaged var fileId: String            // "04-b1-llamarse-01-es"
    @NSManaged var language: String          // "es" или "ru"
    @NSManaged var localPath: String         // Documents/lessons/04-hablar-de-mi-mismo/audio/es/04-b1-llamarse-01.mp3
    @NSManaged var durationMs: Int           // 1200
    @NSManaged var fileSize: Int             // 18432
    @NSManaged var isDownloaded: Bool        // true (всегда true на iOS)
    
    // Связи
    @NSManaged var phrase: Phrase?
    @NSManaged var lesson: Lesson
    
    // Вычисляемое
    var fileURL: URL {
        URL(fileURLWithPath: localPath)
    }
}
```

### 3.6 PhraseStatistics (Статистика фразы)

```swift
@Entity
@NSManaged class PhraseStatistics {
    @NSManaged var phrase: Phrase
    @NSManaged var correctCount: Int = 0     // сколько раз правильно (опционально)
    @NSManaged var totalReviewCount: Int = 0
    @NSManaged var lastReviewedAt: Date?
    @NSManaged var averageReviewTime: Double = 0  // sec
}
```

### 3.7 LessonProgress (Прогресс по уроку)

```swift
@Entity
@NSManaged class LessonProgress {
    @NSManaged var lesson: Lesson
    
    // Счётчики
    @NSManaged var phrasesLearning: Int = 0    // состояние = learning
    @NSManaged var phrasesInProgress: Int = 0  // состояние = inProgress
    @NSManaged var phrasesMastered: Int = 0    // состояние = mastered
    
    // Статистика
    @NSManaged var totalSessionsCompleted: Int = 0
    @NSManaged var totalMinutesLearned: Int = 0
    @NSManaged var totalPhrasesReviewed: Int = 0
    @NSManaged var streakDays: Int = 0         // текущая полоса дней подряд
    @NSManaged var lastAccessedAt: Date?
    @NSManaged var lastCompletedSessionAt: Date?
    
    // Вычисляемое
    var percentMastered: Double {
        let total = phrasesLearning + phrasesInProgress + phrasesMastered
        return total > 0 ? Double(phrasesMastered) / Double(total) : 0
    }
}
```

### 3.8 LearningSession (Выполненная сессия)

```swift
@Entity
@NSManaged class LearningSession {
    @NSManaged var sessionId: UUID
    @NSManaged var lesson: Lesson
    @NSManaged var startedAt: Date
    @NSManaged var completedAt: Date?        // nil если в процессе
    
    // Конфигурация (сохранена как JSON Data)
    @NSManaged var configData: Data          // JSONEncoder(SessionConfig)
    
    // Статистика
    @NSManaged var phrasesCount: Int         // сколько фраз в сессии
    @NSManaged var phrasesRepeats: Int       // общее число повторений (фраз × повторения)
    @NSManaged var actualDurationSeconds: Int
    @NSManaged var phrasesCompletedCount: Int  // сколько завершено (из phrasesCount)
    
    // Обновления состояния
    @NSManaged var phraseUpdates: NSSet<PhraseStateUpdate>  // какие фразы изменили state
    
    // Вычисляемое
    var completionPercent: Double {
        phrasesCount > 0 ? Double(phrasesCompletedCount) / Double(phrasesCount) : 0
    }
}
```

### 3.9 PhraseStateUpdate (Обновление состояния фразы)

```swift
@Entity
@NSManaged class PhraseStateUpdate {
    @NSManaged var phraseId: String
    @NSManaged var oldState: String          // "learning" → "inProgress"
    @NSManaged var newState: String
    @NSManaged var updatedAt: Date
    @NSManaged var session: LearningSession
}
```

---

## 4. ЭКРАНЫ И ПОЛЬЗОВАТЕЛЬСКИЙ ИНТЕРФЕЙС

### 4.1 Tab View (главная структура)

```swift
// ContentView
TabView {
    // Tab 1: Lessons
    LessonListView()
        .tabItem { Label("Уроки", systemImage: "books.vertical") }
    
    // Tab 2: Session (создание и запуск)
    SessionTabView()
        .tabItem { Label("Сессия", systemImage: "play.circle") }
    
    // Tab 3: Statistics
    StatisticsView()
        .tabItem { Label("Статистика", systemImage: "chart.bar") }
    
    // Tab 4: Settings
    SettingsView()
        .tabItem { Label("Параметры", systemImage: "gear") }
}
```

### 4.2 Экран 1: Уроки (LessonListView)

```
┌─────────────────────────────────────────────────────┐
│ Уроки                                    [+]        │
├─────────────────────────────────────────────────────┤
│                                                     │
│ [Сортировка ▼] [Фильтр ▼]                           │
│                                                     │
│ Соображение: Готовые / Все / С прогрессом          │
│                                                     │
│ ═════════════════════════════════════════════════  │
│                                                     │
│ 📚 Рассказ о себе (Тема 04)                         │
│ ────────────────────────────────────────────────    │
│ 81 фраза | 15 слов | ✓ Готово                       │
│ Дата импорта: 21 июля 2026                          │
│                                                     │
│ Прогресс: [██████████░░░░░░░░░░] 50%                │
│          ├─ Выучено: 24 | В процессе: 38 | Учу: 19 │
│                                                     │
│ [▶ Играть] [📊 Статистика] [⋯ Ещё]                 │
│                                                     │
│ Меню (⋯):                                           │
│  • Просмотр подробностей                          │
│  • Переименовать                                   │
│  • Удалить урок (⚠ не восстановимо)               │
│  • Поделиться ZIP (опционально)                   │
│  • Экспортировать прогресс (CSV)                  │
│                                                     │
│ ═════════════════════════════════════════════════  │
│                                                     │
│ 🛒 Покупки в магазине (Тема 03)                     │
│ ────────────────────────────────────────────────    │
│ 67 фраз | 20 слов | ✓ Готово                        │
│ Дата импорта: 20 июля 2026                          │
│                                                     │
│ Прогресс: [████████████░░░░░░░░] 60%                │
│          ├─ Выучено: 31 | В процессе: 28 | Учу: 8  │
│                                                     │
│ [▶ Играть] [📊 Статистика] [⋯ Ещё]                 │
│                                                     │
│ ═════════════════════════════════════════════════  │
│                                                     │
│ Кнопка [+] → ImportLessonView                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Функционал:**
- Список всех импортированных уроков
- Прогресс-бар по каждому уроку
- Кнопка "Играть" → переход в SessionTabView с выбранным уроком
- Фильтр по статусу (готовые / в процессе / не начинал)
- Сортировка (дата, название, прогресс)
- Долгий тап → контекстное меню (удалить, переименовать)
- Кнопка [+] → ImportLessonView

### 4.3 Экран Import Lesson (ImportLessonView)

```
┌──────────────────────────────────────────────────┐
│ Импорт урока                                 [×] │
├──────────────────────────────────────────────────┤
│                                                  │
│ [📁 Выбрать файл ZIP]                            │
│ или                                              │
│ [☁️ iCloud Drive]                                │
│ или                                              │
│ [🔗 Перетащите файл сюда]                        │
│                                                  │
│ ─────────────────────────────────────────────    │
│                                                  │
│ 📋 Информация об уроке:                          │
│                                                  │
│ Название: Рассказ о себе                        │
│ ID: 04-hablar-de-mi-mismo                        │
│ Фраз: 81                                         │
│ Размер: 34.2 МБ                                  │
│ Дата создания: 21 июля 2026, 14:27              │
│ Версия генератора: 1.0.0                        │
│                                                  │
│ ─────────────────────────────────────────────    │
│                                                  │
│ Если урок уже существует:                        │
│                                                  │
│ ⚠ Урок "Рассказ о себе" уже импортирован         │
│                                                  │
│ Что делать?                                      │
│ ◉ Обновить (сохранить прогресс)                  │
│ ○ Заменить (потерять весь прогресс)              │
│ ○ Отмена                                         │
│                                                  │
│ ─────────────────────────────────────────────    │
│                                                  │
│ [Импортировать] [Отмена]                         │
│                                                  │
│ Статус: Подготовка...                            │
│ [████░░░░░░] 40%                                 │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Функционал:**
- File Picker (выбрать ZIP из Documents, Downloads, iCloud Drive)
- Drag & Drop (перетащить ZIP файл в окно)
- Валидация ZIP (проверка наличия lesson.json, структуры)
- Парсинг lesson.json и показ информации об уроке
- Обработка конфликтов (если урок с таким ID уже есть)
- Progress bar при распаковке и копировании файлов

### 4.4 Экран 2: Сессия — Выбор фраз (PhraseSelectionView)

```
┌──────────────────────────────────────────────────┐
│ Выбор фраз                                   [<] │
├──────────────────────────────────────────────────┤
│                                                  │
│ Урок: Рассказ о себе (81 фраза)                 │
│                                                  │
│ Фильтр по статусу:                               │
│ [✓ Все] [Выучено] [В процессе] [Учу]            │
│                                                  │
│ Фильтр по группе:                                │
│ [✓ Все группы] [1-10] [11-20] [21-30] ...       │
│                                                  │
│ ┌─────────────────────────────────────────────┐ │
│ │ Поиск фраз...                               │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ Действия (선택된: 35 из 81)                      │
│ [Select All] [Clear All] [Invert]               │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ ▼ Блок 1: verb_group (20 фраз)                  │
│                                                  │
│   ▼ llamarse (5 фраз)                            │
│     ☑ Me llamo Victor. - Меня зовут Виктор.     │
│     ☑ ¿Cómo te llamas tú? - Как тебя зовут?    │
│     ☑ Todos me llaman Vic. - Все зовут...      │
│     ☐ (ещё 2 фразы)                             │
│                                                  │
│   ▼ tener (6 фраз)                               │
│     ☑ Tengo cuarenta años. - Мне сорок лет.    │
│     ...                                          │
│                                                  │
│ ▼ Блок 2: phrase_group (30 фраз)                │
│   ...                                            │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ Статус:                                          │
│ [██████████░░░░░░░░░░] 43% (35 из 81)           │
│                                                  │
│ [Назад] [Далее: Настройки →]                     │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Функционал:**
- Список всех фраз в виде дерева (блоки → группы → фразы)
- Чекбоксы для выбора
- Фильтр по статусу (Все / Выучено / В процессе / Учу)
- Фильтр по группе (1-10, 11-20, 21-30...)
- Кнопки "Select All", "Clear All", "Invert"
- Поиск по тексту (ES или RU)
- Показ выбранного количества / общего

### 4.5 Экран 3: Сессия — Конфигурация (SessionConfigView)

```
┌──────────────────────────────────────────────────┐
│ Параметры сессии                             [<] │
├──────────────────────────────────────────────────┤
│                                                  │
│ Выбрано: 35 фраз                                │
│ Ожидаемое время: 8 мин                          │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ Количество повторений                            │
│ [◄ 1 ▲ ▼ 5 ►]                                    │
│ ↳ Каждую фразу повторим 5 раз                   │
│                                                  │
│ Скорость воспроизведения                         │
│ [◄▪───○───►]  0.5 × (50%)                       │
│ ↳ Медленнее (0.5x) для лучшего понимания         │
│ Варианты: [0.5x] [0.75x] [1.0x] [1.5x] [2.0x]  │
│                                                  │
│ Пауза между повторениями                         │
│ [◄ 3 ▲ ▼ 7 ►] сек                               │
│ ↳ Пауза после каждого повтора фразы              │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ Режим воспроизведения                            │
│ ◉ Один раз (проиграть все и готово)              │
│ ○ Цикл фраз (зацикливать фразы, пока не нажму)  │
│ ○ Цикл сессии (повторить всю сессию N раз)      │
│   ├─ Количество: [2] раза                       │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ Показ текста на lock screen                     │
│ ◉ Оригинал + Перевод                             │
│ ○ Только оригинал                                │
│ ○ Только перевод                                 │
│ ○ Скрыть                                         │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ Обновление статуса фраз                          │
│ ☑ Разрешить обновлять state при воспроизведении │
│ ☐ Отключить отслеживание в этой сессии          │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 📊 РАСЧЁТ:                                       │
│                                                  │
│ Фраз: 35                                         │
│ Языков (ES + RU): 2                              │
│ Повторений: 5                                    │
│ Пауз: 4 (между повторениями)                    │
│                                                  │
│ Общее время (примерно):                          │
│ = 35 × 2 × 1.2 сек × 5 × 0.5 (скорость) + пауз  │
│ ≈ 8 минут 45 секунд                             │
│                                                  │
│ [Назад] [▶ Начать сессию →]                      │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Функционал:**
- Счётчик повторений (stepper или слайдер)
- Слайдер скорости (0.5x - 2.0x)
- Счётчик паузы между повторениями (в секундах)
- Выбор режима воспроизведения (один раз / цикл фраз / цикл сессии)
- Выбор отображения текста на lock screen
- Toggle отслеживания прогресса
- Расчёт ожидаемого времени сессии
- Кнопка "Начать сессию"

### 4.6 Экран 4: Сессия — Плеер (SessionPlayerView)

**Основной плеер:**
```
┌──────────────────────────────────────────────────┐
│ Сессия: Рассказ о себе                       [×] │
├──────────────────────────────────────────────────┤
│                                                  │
│ Прогресс сессии:                                 │
│ [████████░░░░░░░░░░░░░░] 35% (11 / 31 фраз)    │
│ Осталось: ~5 мин                                │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ Текущая фраза (повтор 3 из 5):                   │
│                                                  │
│ 🇪🇸 "¿Cómo te llamas tú?"                        │
│ 🇷🇺 "Как тебя зовут?"                            │
│                                                  │
│ [🔊 Воспроизведение: 2.1 / 3.2 сек]             │
│ [████████───────────────] 2.1 / 3.2 sec         │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ Следующая фраза:                                 │
│ 🇪🇸 "Tengo cuarenta años."                      │
│ 🇷🇺 "Мне сорок лет."                             │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ Управление:                                      │
│                                                  │
│ [⏮ Предыдущая] [⏸ Пауза] [▶ Плей] [⏭ Следующая]│
│                                                  │
│ Дополнительно:                                  │
│ [❤️ Добавить в избранное] [🔁 Повторить фразу] │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ Параметры сессии (свёрнутые):                    │
│ Скорость: 0.5x | Повторы: 3/5 | Пауза: 7 сек   │
│                                                  │
│ [⚙ Показать параметры]                           │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ [⏹ Завершить сессию]                             │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Расширенный вид (при разворачивании параметров):**
```
┌──────────────────────────────────────────────────┐
│ Параметры текущей сессии                         │
├──────────────────────────────────────────────────┤
│                                                  │
│ Скорость: [◄▪───────○───────►] 0.5x              │
│ Пауза между повторениями: [7] сек                │
│ Текущий режим: Один раз (35 фраз)                │
│                                                  │
│ Быстрые действия:                                │
│ [▶▶ x1.5] [⏸ Пауза] [↻ Сброс сессии]            │
│                                                  │
│ [Свернуть]                                       │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Функционал:**
- Отображение текущей фразы (ES + RU)
- Preview следующей фразы
- Прогресс-бар аудио
- Кнопки управления: Play/Pause, Previous, Next
- Кнопка "Повторить фразу" (переиграть текущую)
- Кнопка "Добавить в избранное" (для быстрого повтора позже)
- Lock screen интеграция (текст и переводы на экране блокировки)
- Фоновое воспроизведение (можно свернуть приложение, плей продолжится)
- Slider для скорости (в реальном времени)
- Отслеживание повторений (3/5)

### 4.7 Экран 5: Сессия — Завершение (SessionCompletedView)

```
┌──────────────────────────────────────────────────┐
│ Сессия завершена! 🎉                             │
├──────────────────────────────────────────────────┤
│                                                  │
│ Урок: Рассказ о себе                             │
│ Дата: 21 июля 2026, 15:34                        │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 📊 РЕЗУЛЬТАТЫ СЕССИИ:                            │
│                                                  │
│ Фраз завершено: 35 из 35 ✓                       │
│ Время сеанса: 8 мин 45 сек                       │
│ Среднее время на фразу: 15 сек                   │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 📈 ОБНОВЛЕНИЯ СТАТУСА ФРАЗ:                     │
│                                                  │
│ Повышены в статусе:                              │
│ • 5 фраз: learning → inProgress                  │
│ • 3 фразы: inProgress → mastered                 │
│                                                  │
│ Осталось в текущем статусе:                      │
│ • 27 фраз в режиме inProgress                    │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ ✨ ДОСТИЖЕНИЯ РАЗБЛОКИРОВАНЫ:                   │
│                                                  │
│ • Первый шаг (1-я завершённая сессия) 🎯        │
│ • Три подряд (3 сессии за 3 дня) ⏱             │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ Рекомендации:                                    │
│ • Повторите урок "Покупки в магазине" - 3 дня  │
│ • Учите слова из "Ключевая лексика" - давно    │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ [Вернуться в уроки] [Новая сессия] [Статистика]│
│                                                  │
└──────────────────────────────────────────────────┘
```

**Функционал:**
- Показ результатов сессии
- Список изменений в статусе фраз
- Разблокированные достижения
- Рекомендации по повтору других уроков
- Кнопки быстрого навигации

### 4.8 Экран 6: Статистика (StatisticsView)

```
┌──────────────────────────────────────────────────┐
│ Статистика                                       │
├──────────────────────────────────────────────────┤
│                                                  │
│ Период: [Сегодня ▼] [За неделю] [За месяц] [Всё]│
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 📊 ОБЩИЕ ПОКАЗАТЕЛИ:                             │
│                                                  │
│ Сессий завершено: 42                             │
│ Всего часов обучения: 21.5                       │
│ Средняя сессия: 31 мин                           │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 🔥 ПОЛОСА АКТИВНОСТИ:                            │
│                                                  │
│ Сегодня: ✓ (30 мин)                              │
│ Вчера:   ✓ (45 мин)                              │
│ 2 дня:   ✓ (25 мин)                              │
│ 3 дня:   ✗                                       │
│ 4 дня:   ✓ (60 мин)                              │
│                                                  │
│ Текущая полоса: 3 дня подряд 🎯                 │
│ Лучшая полоса: 15 дней подряд 🏆                │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 📅 КАЛЕНДАРЬ АКТИВНОСТИ (Heatmap):               │
│                                                  │
│ Пн Вт Ср Чт Пт Сб Вс                             │
│ ░░ ░░ ░░ ░░ ░░ ░░ ░░ (неделя 1)                 │
│ ░░ ▓▓ ▓▓ ░░ ▓▓ ▓▓ ░░ (неделя 2)                 │
│ ░░ ░░ ▓▓ ▓▓ ▓▓ ░░ ░░ (неделя 3)                 │
│ ░░ ░░ ░░ ░░ ░░ ░░ ░░ (неделя 4)                 │
│                                                  │
│ ░░ = нет активности                              │
│ ▓▓ = активность                                  │
│ ██ = высокая активность                          │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 📖 ПО УРОКАМ:                                    │
│                                                  │
│ ▼ Рассказ о себе (Тема 04)                       │
│   Выучено: 24 / 81 (30%)                         │
│   Сессий: 12 | Часов: 6.5                        │
│                                                  │
│ ▼ Покупки в магазине (Тема 03)                   │
│   Выучено: 31 / 67 (46%)                         │
│   Сессий: 18 | Часов: 9.2                        │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 📈 СЛОВА, ТРЕБУЮЩИЕ ПОВТОРА:                    │
│                                                  │
│ 🔴 СРОЧНО (пересдача < 2 дней):                 │
│   • Me llamo Victor (5 дней не повторяла)        │
│   • ¿Cómo te llamas? (7 дней)                    │
│                                                  │
│ 🟡 СКОРО (пересдача 2-7 дней):                   │
│   • Tengo cuarenta años (3 дня)                  │
│   • Soy programador (5 дней)                     │
│                                                  │
│ 🟢 В НОРМЕ (пересдача > 7 дней):                │
│   • Encantado de conocerte (12 дней)             │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ [Экспортировать CSV]                             │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Функционал:**
- Фильтр по периоду (сегодня / неделя / месяц / всё время)
- Общие показатели (сессии, часы, среднее время)
- Полоса активности (streak)
- Календарь активности (heatmap)
- Статистика по урокам
- Список слов для повтора (по срочности)
- Экспорт статистики в CSV

### 4.9 Экран 7: Параметры (SettingsView)

```
┌──────────────────────────────────────────────────┐
│ Параметры                                        │
├──────────────────────────────────────────────────┤
│                                                  │
│ 🎨 ВНЕШНИЙ ВИД:                                  │
│                                                  │
│ Тема оформления                                  │
│ ◉ Светлая                                        │
│ ○ Тёмная                                         │
│ ○ По системе                                     │
│                                                  │
│ Размер шрифта:                                   │
│ [◄───○────►] Средний                             │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 🔊 АУДИО:                                        │
│                                                  │
│ ☑ Вибрация при начале фразы                      │
│ ☑ Звук при переходе на новую фразу              │
│ ☑ Вибрация при завершении сессии                 │
│                                                  │
│ Громкость по умолчанию:                          │
│ [◄───●────►] 80%                                 │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 🎯 ОБУЧЕНИЕ:                                     │
│                                                  │
│ Режим повтора по умолчанию                       │
│ [Один раз ▼]                                     │
│ └─ Flash card режим (опционально)                │
│    ☐ Включить (показывать вопрос, потом ответ)  │
│                                                  │
│ Автоматический переход к следующей фразе        │
│ ☑ Через [3] сек после завершения аудио          │
│                                                  │
│ Обновлять статус фраз при пропуске               │
│ ☑ Да, обновлять                                 │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ 💾 ДАННЫЕ И РЕЗЕРВНАЯ КОПИЯ:                    │
│                                                  │
│ Размер базы данных: 450 МБ                      │
│ Последняя резервная копия: 21 июля, 14:00      │
│                                                  │
│ [Создать резервную копию сейчас]                │
│ [Восстановить из резервной копии]                │
│ [Экспортировать данные (ZIP)]                    │
│ [⚠ Очистить все данные]                         │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ ℹ️ О ПРИЛОЖЕНИИ:                                 │
│                                                  │
│ Версия: 1.0.0                                    │
│ Сборка: 42                                       │
│ iOS: 15.0+                                       │
│                                                  │
│ [Проверить обновления]                           │
│ [Политика конфиденциальности]                    │
│ [Условия использования]                          │
│ [Об авторе]                                      │
│                                                  │
│ ═════════════════════════════════════════════  │
│                                                  │
│ [Написать отзыв] [Сообщить об ошибке]           │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Функционал:**
- Выбор темы (светлая / тёмная / система)
- Размер шрифта
- Параметры звука и вибрации
- Громкость по умолчанию
- Режим повтора по умолчанию
- Автоматический переход к следующей фразе
- Резервная копия данных
- Экспорт/импорт данных
- Информация о приложении и ссылки

---

## 5. РЕЖИМЫ ВОСПРОИЗВЕДЕНИЯ

### 5.1 Режим "Один раз"

```
Логика:
1. Проиграть все 35 выбранных фраз по порядку
2. Каждая фраза: ES → пауза → RU (оба языка подряд)
3. После каждого повтора: пауза (7 сек)
4. После N повторений: переход к следующей фразе
5. После всех фраз: завершение сессии

Пример (2 повтора, 5 сек пауза):
- Фраза 1 (ES): 3.2 сек
- Фраза 1 (RU): 1.1 сек
- ПАУЗА: 5 сек
- Фраза 1 (ES): 3.2 сек
- Фраза 1 (RU): 1.1 сек
- ПАУЗА: 5 сек
- Фраза 2 (ES): ...
```

### 5.2 Режим "Цикл фраз"

```
Логика:
1. Проиграть текущую фразу N раз (с повторениями и паузами)
2. Кнопка "Следующая" → переходит на следующую фразу
3. Кнопка "Повторить фразу" → повторяет текущую (не увеличивает счётчик)
4. Пользователь может остановить в любой момент
5. При повороте экрана: сохранять текущую позицию

Использование: для более медленного обучения, когда нужно понять одну фразу
```

### 5.3 Режим "Цикл сессии"

```
Логика:
1. Проиграть все фразы один раз (как в режиме "Один раз")
2. После завершения: начать с начала ещё раз
3. Количество циклов: настраивается (например, 3 раза)
4. После N циклов: завершение сессии

Использование: для массивного повтора (например, перед экзаменом)
```

---

## 6. LOCK SCREEN ИНТЕГРАЦИЯ

### 6.1 Lock Screen UI

```
┌──────────────────────────────────────────────────┐
│ 🎵 Audio Learner                      [14:35]    │
│                                                  │
│ Рассказ о себе                                   │
│ ¿Cómo te llamas tú? • Как тебя зовут?            │
│                                                  │
│ [⏮] [⏸] [⏭]                                       │
│                                                  │
│ [████████───────────────] 2.1 / 3.2 sec         │
│                                                  │
└──────────────────────────────────────────────────┘
```

**MPNowPlayingInfoCenter параметры:**

```swift
var nowPlayingInfo = [
    MPMediaItemPropertyTitle: "¿Cómo te llamas tú?",           // текст ES
    MPMediaItemPropertyArtist: "Как тебя зовут?",              // текст RU
    MPMediaItemPropertyAlbum: "Рассказ о себе",                // название урока
    MPMediaItemPropertyPlaybackDuration: 3.2,
    MPNowPlayingInfoPropertyElapsedPlaybackTime: 2.1,
    MPNowPlayingInfoPropertyPlaybackRate: 0.5,                 // текущая скорость
    MPMediaItemPropertyAlbumTrackNumber: 11,                   // номер фразы
    MPMediaItemPropertyAlbumNumberOfTracks: 35,                // всего фраз
    MPMediaItemPropertyArtwork: artwork                        // обложка (опционально)
]
```

**Режимы отображения текста:**

```
Настройка: "Показ текста на lock screen"

1. Оригинал + Перевод (по умолчанию)
   Title: "¿Cómo te llamas tú?"
   Artist: "Как тебя зовут?"

2. Только оригинал
   Title: "¿Cómo te llamas tú?"
   Artist: ""

3. Только перевод
   Title: "Как тебя зовут?"
   Artist: ""

4. Скрыть
   Title: "Фраза"
   Artist: "" (или название урока)
```

### 6.2 Remote Command Center (кнопки управления)

```swift
// Play / Pause
commandCenter.playCommand.addTarget { event in
    self.player.play()
    return .success
}

commandCenter.pauseCommand.addTarget { event in
    self.player.pause()
    return .success
}

// ← Предыдущая фраза
commandCenter.skipBackwardCommand.preferredIntervals = [3]
commandCenter.skipBackwardCommand.addTarget { event in
    self.skipToPreviousPhrase()
    return .success
}

// → Следующая фраза
commandCenter.skipForwardCommand.preferredIntervals = [3]
commandCenter.skipForwardCommand.addTarget { event in
    self.skipToNextPhrase()
    return .success
}
```

---

## 7. WIDGET (iOS 16.2+)

### 7.1 Lock Screen Widget

**Показывает:** текущая фраза + прогресс

```
┌─────────────────────────┐
│ 📚 Learning Session     │
├─────────────────────────┤
│ ¿Cómo te llamas?        │
│ 11 / 35 фраз            │
│                         │
│ [▶ Продолжить]          │
└─────────────────────────┘
```

**Код:**

```swift
struct SessionWidgetView: View {
    let session: LearningSession
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("📚 Learning Session")
                .font(.caption2)
                .foregroundColor(.gray)
            
            if let currentPhrase = session.currentPhrase {
                Text(currentPhrase.textEs)
                    .font(.caption)
                    .lineLimit(1)
                
                Text("\(session.completedCount) / \(session.phrasesCount) фраз")
                    .font(.caption2)
                    .foregroundColor(.blue)
            }
        }
        .padding(.small)
    }
}
```

### 7.2 Home Screen Widget (опционально)

**Показывает:** статистика за день

```
┌──────────────────────┐
│ 🎯 Audio Learner     │
├──────────────────────┤
│ Сегодня: 45 мин      │
│ Сессий: 2            │
│ Фраз: 68             │
│                      │
│ Полоса: 🔥 5 дней   │
└──────────────────────┘
```

---

## 8. ФОНОВОЕ ВОСПРОИЗВЕДЕНИЕ

### 8.1 Audio Session Setup

```swift
import AVFoundation

class AudioSessionManager {
    static let shared = AudioSessionManager()
    
    func setupAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(
            .playback,                      // воспроизведение звука
            mode: .default,
            options: [.duckOthers]          // приглушать другой звук (музыка)
        )
        try? session.setActive(true, options: .notifyOthersOnDeactivation)
    }
}
```

### 8.2 Background Mode включение

**В Info.plist:**
```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>                  <!-- фоновое воспроизведение audio -->
    <string>processing</string>             <!-- обработка данных (опционально) -->
</array>
```

### 8.3 Обработка прерываний

```swift
NotificationCenter.default.addObserver(
    self,
    selector: #selector(handleAudioInterruption(_:)),
    name: AVAudioSession.interruptionNotification,
    object: AVAudioSession.sharedInstance()
)

@objc func handleAudioInterruption(_ notification: Notification) {
    guard let userInfo = notification.userInfo,
          let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
    
    if type == .began {
        // Начало прерывания (телефонный звонок)
        player.pause()
    } else if type == .ended {
        // Конец прерывания
        if let shouldResume = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt,
           shouldResume == AVAudioSession.InterruptionOptions.shouldResume.rawValue {
            player.play()
        }
    }
}
```

---

## 9. SPACED REPETITION (SRS)

### 9.1 Простая модель (без SM-2)

**Состояния фразы:**
- `learning` — новая, никогда не повторяли
- `inProgress` — повторяли, но не достаточно
- `mastered` — хорошо выучена

**Логика обновления (во время сессии):**

```swift
// При завершении фразы в сессии
func completePhrase(_ phrase: Phrase, wasSuccessful: Bool) {
    phrase.reviewCount += 1
    phrase.lastReviewDate = Date()
    
    // Условия перехода
    if phrase.state == "learning" && phrase.reviewCount >= 3 {
        phrase.state = "inProgress"
    } else if phrase.state == "inProgress" && phrase.reviewCount >= 8 {
        phrase.state = "mastered"
    }
    
    // Для полного SRS (опционально):
    // phrase.nextReviewDate = calculateNextReview(phrase)
}
```

### 9.2 Рекомендации по повтору

На основе `lastReviewDate`:

```swift
func getRecommendedPhrases(from lesson: Lesson) -> [Phrase] {
    let today = Date()
    let threeDaysAgo = Calendar.current.date(byAdding: .day, value: -3, to: today)!
    let weekAgo = Calendar.current.date(byAdding: .day, value: -7, to: today)!
    
    return lesson.phrases.filter { phrase in
        guard let lastReviewDate = phrase.lastReviewDate else {
            return true  // Новые фразы
        }
        
        switch phrase.state {
        case "learning":
            return lastReviewDate < threeDaysAgo  // Повторять каждые 3 дня
        case "inProgress":
            return lastReviewDate < weekAgo       // Повторять каждую неделю
        case "mastered":
            return false                          // Не повторять
        default:
            return false
        }
    }
}
```

---

## 10. СТАТИСТИКА И ДОСТИЖЕНИЯ

### 10.1 Метрики, которые отслеживаем

```swift
struct LessonStatistics {
    // Базовые
    let completedSessions: Int
    let totalMinutesLearned: Int
    let averageSessionDuration: TimeInterval
    
    // По фразам
    let phrasesLearning: Int
    let phrasesInProgress: Int
    let phrasesMastered: Int
    let percentMastered: Double
    
    // Активность
    let currentStreak: Int
    let bestStreak: Int
    let lastActivityDate: Date?
    let daysActive: Int
    
    // Производительность
    let averagePhraseReviewCount: Double
    let mostRepeatedPhrase: String?
}
```

### 10.2 Достижения (Achievements)

```swift
enum Achievement: String, CaseIterable {
    case firstSession = "Первый шаг"              // 1 сессия
    case weekWarrior = "Неделя боевая"            // 7 дней подряд
    case monthMarathon = "Месячный марафон"       // 30 дней подряд
    case hundredSessions = "Сотня сессий"         // 100 сессий
    case allMastered = "Полный мастер"            // 100% фраз выучено в уроке
    case speedDemon = "Скоро-говорун"             // 10 сессий на скорости 2.0x
    case nightOwl = "Сова"                        // 5 сессий после 22:00
}
```

---

## 11. ИМПОРТ УРОКОВ

### 11.1 Шаг за шагом

**Сценарий пользователя:**

```
1. На Mac: Combine генерирует урок
   → Нажимает "Экспорт ZIP"
   → /Downloads/lesson-04.zip

2. На iPhone: Получает файл
   → Открывает в Files app
   → Выбирает "Audio Learner"
   → App ловит intent через Document Picker

3. iOS app:
   a) Распаковывает ZIP в temp
   b) Валидирует lesson.json
   c) Проверяет наличие всех audio файлов
   d) Если урок существует → диалог (обновить / заменить)
   e) Копирует папку в Documents/AudioLearner/lessons/
   f) Создаёт CoreData записи (Lesson + Blocks + Phrases)
   g) Показывает "Урок успешно импортирован"

4. Урок появляется в списке на экране "Уроки"
```

### 11.2 Валидация и конфликты

**Валидация:**
```swift
func validateZipFile(_ url: URL) throws -> LessonInfo {
    let unzipPath = FileManager.default.temporaryDirectory.appendingPathComponent("temp_import")
    
    // Распаковать
    try unzipFile(url, to: unzipPath)
    
    // Проверить наличие lesson.json
    let jsonPath = unzipPath.appendingPathComponent("lesson.json")
    guard FileManager.default.fileExists(atPath: jsonPath.path) else {
        throw ImportError.missingJSON
    }
    
    // Парсить и валидировать
    let data = try Data(contentsOf: jsonPath)
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let lesson = try decoder.decode(Lesson.self, from: data)
    
    // Проверить аудио файлы
    for phrase in lesson.allPhrases {
        let esPath = unzipPath.appendingPathComponent(phrase.audioEs)
        let ruPath = unzipPath.appendingPathComponent(phrase.audioRu)
        guard FileManager.default.fileExists(atPath: esPath.path),
              FileManager.default.fileExists(atPath: ruPath.path) else {
            throw ImportError.missingAudioFile(phrase.id)
        }
    }
    
    return lesson.toLessonInfo()
}
```

**Конфликты:**
```swift
func handleConflict(newLesson: LessonInfo) {
    if let existing = repository.fetch(topicId: newLesson.topicId) {
        showDialog("Урок уже импортирован") {
            actions: [
                .init("Обновить", action: {
                    updateLessonAudio(existing, newLesson)
                }),
                .init("Заменить", action: {
                    deleteLessonData(existing)
                    importLesson(newLesson)
                }),
                .init("Отмена", action: {})
            ]
        }
    } else {
        importLesson(newLesson)
    }
}

func updateLessonAudio(_ existing: Lesson, _ new: LessonInfo) {
    // Копируем новые аудио файлы (перезаписываем)
    // CoreData Phrase записи остаются те же
    // state, reviewCount, lastReviewDate НЕ трогаются
}
```

---

## 12. ФАЙЛОВАЯ СТРУКТУРА (iOS)

### 12.1 Documents папка

```
Documents/
└── AudioLearner/
    ├── lessons/
    │   ├── 04-hablar-de-mi-mismo/
    │   │   ├── lesson.json              # манифест урока
    │   │   ├── audio/
    │   │   │   ├── es/
    │   │   │   │   ├── 04-b1-llamarse-01.mp3
    │   │   │   │   ├── 04-b1-llamarse-02.mp3
    │   │   │   │   └── ...
    │   │   │   └── ru/
    │   │   │       ├── 04-b1-llamarse-01.mp3
    │   │   │       └── ...
    │   │   └── imported_at.txt
    │   │
    │   ├── 03-compras-en-la-tienda/
    │   │   └── ...
    │   │
    │   └── temp_imports/               # временная папка при распаковке
    │       └── lesson-04.zip
    │
    ├── backups/                        # резервные копии
    │   ├── backup_2026-07-21_14-27.zip
    │   └── ...
    │
    └── exports/                        # экспорты (CSV, JSON)
        ├── stats_2026-07-21.csv
        └── ...
```

### 12.2 Core Data entities расположение

**Автоматически в:**
```
Library/Application Support/AudioLearner/
└── AudioLearner.sqlite
```

---

## 13. НАСТРОЙКИ И ПОЛЬЗОВАТЕЛЬСКИЕ ПРЕДПОЧТЕНИЯ

### 13.1 UserDefaults ключи

```swift
struct UserDefaults.Keys {
    // Интерфейс
    static let themeStyle = "themeStyle"           // "light", "dark", "system"
    static let fontSize = "fontSize"               // 1.0 (множитель)
    
    // Аудио
    static let vibrationEnabled = "vibrationEnabled"
    static let soundEnabled = "soundEnabled"
    static let defaultVolume = "defaultVolume"     // 0.0 - 1.0
    
    // Обучение
    static let defaultPlaybackMode = "defaultPlaybackMode"  // "once", "loop", "cycle"
    static let autoNextPhrase = "autoNextPhrase"   // boolean
    static let autoNextDelay = "autoNextDelay"     // секунды
    
    // Lock screen
    static let lockScreenDisplay = "lockScreenDisplay"  // "both", "original", "translation", "hidden"
    
    // Резервная копия
    static let lastBackupDate = "lastBackupDate"
}
```

---

## 14. ГОРЯЧИЕ КЛАВИШИ (iOS)

| Сочетание | Действие |
|-----------|----------|
| Пробел | Play / Pause |
| ← / → | Предыдущая / Следующая фраза |
| ↑ / ↓ | Громче / Тише |
| H | Скрыть/показать subtitle (перевод) |
| M | Мute (отключить звук) |

---

## 15. ОБРАБОТКА ОШИБОК

### 15.1 Сценарии

| Сценарий | Обработка |
|----------|-----------|
| Файл не найден | Ошибка при загрузке, предложение импортировать заново |
| Повреждённый ZIP | Валидация, ошибка с подробностью |
| Недостаточно места | Предложение очистить данные или удалить уроки |
| Аудио файл не загружен | Пропустить фразу, отметить ошибку в логе |
| CoreData ошибка | Попытка восстановления из резервной копии |

### 15.2 Логирование

```swift
struct AppLogger {
    static func log(_ message: String, category: String = "General") {
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .short, timeStyle: .medium)
        let logEntry = "[\(timestamp)] [\(category)] \(message)"
        
        // Файл в Documents
        let logsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("logs.txt")
        
        var content = (try? String(contentsOf: logsPath)) ?? ""
        content += "\n" + logEntry
        try? content.write(to: logsPath, atomically: true, encoding: .utf8)
    }
}
```

---

## 16. ПРОИЗВОДИТЕЛЬНОСТЬ И ОПТИМИЗАЦИЯ

- **Ленивая загрузка** фраз (не все сразу в памяти)
- **Кэширование** информации о длительности аудио
- **Оптимизация CoreData** (батчинг, использование `@FetchRequest`)
- **Асинхронная распаковка** ZIP (не блокирует UI)
- **Фоновые операции** (импорт, статистика) в `DispatchQueue`

---

## 17. ЛОКАЛИЗАЦИЯ (i18n)

**Поддерживаемые языки:**
- Русский (основной)
- Английский (опционально)
- Испанский (опционально)

**Strings файл:**
```swift
// Localizable.strings (Russian)
"lessons.title" = "Уроки";
"session.startButton" = "Начать сессию";
"player.pause" = "Пауза";
// ...
```

---

## 18. ТЕСТИРОВАНИЕ

### 18.1 Unit тесты

- Parser (валидация ZIP, JSON)
- SpacedRepeat (логика обновления state)
- Statistics (расчёты)

### 18.2 Integration тесты

- Полный цикл: импорт → сессия → завершение
- CoreData операции

### 18.3 UI тесты

- Навигация между экранами
- Воспроизведение аудио
- Lock screen интеграция

---

## 19. РАЗВЁРТЫВАНИЕ

### 19.1 Сборка

```bash
xcodebuild build \
  -scheme AudioLearner \
  -configuration Release \
  -derivedDataPath build

# Или через Xcode: Product → Build
```

### 19.2 Установка (на устройстве)

1. Подключить iPhone через USB
2. Xcode → Targets → Signing & Capabilities
3. Установить team и bundle ID
4. Product → Run на устройство

### 19.3 TestFlight / App Store (будущее)

- Подготовка скриншотов
- App Store Connect запрос
- Review и публикация

---

## 20. ИЗВЕСТНЫЕ ОГРАНИЧЕНИЯ И БУДУЩИЕ РАСШИРЕНИЯ

### Ограничения v1.0:
- Поддержка только испанского + русского
- Нет поддержки пользовательских голосов (кастом TTS)
- Нет синхронизации между устройствами

### Будущие расширения (v2.0+):
- Поддержка других языков
- Экспорт в Anki (.apkg)
- Offline STT (проверка произношения)
- Синхронизация через iCloud
- Social features (делиться достижениями)
- Интеграция с ChatGPT для создания уроков

---

**Конец спецификации iOS Audio Learner**
