# Архитектура системы: Audio Learner + Combine

> ⚠️ **Историческое ТЗ.** Реализация местами осознанно отклоняется — список отклонений в [DECISIONS.md](DECISIONS.md), при противоречии приоритетен он.

**Документ:** Общая архитектура, взаимодействие приложений, поток данных  
**Версия:** 1.0  
**Дата:** 21 июля 2026

---

## 1. ОБЩАЯ АРХИТЕКТУРА СИСТЕМЫ

### 1.1 Двухуровневая архитектура

```
┌─────────────────────────────────────────────────────────┐
│ УРОВЕНЬ 1: GENERATION (Desktop / macOS)                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Combine Desktop App                                     │
│ ├─ Импорт текста с разметкой                           │
│ ├─ Парсинг в структуру                                 │
│ ├─ Вызов ElevenLabs API                                │
│ ├─ Генерация MP3 файлов                                │
│ ├─ Создание lesson.json манифеста                      │
│ └─ Экспорт ZIP архива                                  │
│                                                         │
│ Output: lesson-04.zip                                   │
│  ├─ lesson.json                                        │
│  └─ audio/ (es/ + ru/)                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
                          ↓
                    (Транспорт)
         ┌───────────────┬───────────────┬────────────┐
         ▼               ▼               ▼            ▼
    AirDrop        iCloud Drive      Email/ZIP     USB/iTunes
         │               │               │            │
         └───────────────┴───────────────┴────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ УРОВЕНЬ 2: CONSUMPTION (iOS / iPhone / iPad)            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Audio Learner iOS App                                   │
│ ├─ Импорт и распаковка ZIP                             │
│ ├─ Валидация и индексация (CoreData)                   │
│ ├─ Управление сессиями обучения                        │
│ ├─ Воспроизведение с контролем скорости/пауз           │
│ ├─ Отслеживание прогресса (SRS)                        │
│ ├─ Статистика и достижения                             │
│ └─ Lock screen интеграция + widget                     │
│                                                         │
│ Local Storage:                                          │
│ ├─ Documents/AudioLearner/lessons/ (аудио файлы)       │
│ ├─ CoreData (прогресс, статистика)                     │
│ └─ UserDefaults (настройки)                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.2 Ключевые отличия

| Аспект | Combine | Audio Learner |
|--------|---------|---------------|
| **Платформа** | macOS / Windows | iOS / iPadOS |
| **Ответственность** | Генерация контента | Обучение |
| **Частота использования** | 1-2 раза в неделю | Ежедневно |
| **Онлайн-зависимость** | Да (ElevenLabs API) | Нет (полностью offline) |
| **Хранение данных** | Папки на диске | CoreData + Documents |
| **Синхронизация** | Нет | Нет (локальное) |

---

## 2. ПОТОК ДАННЫХ

### 2.1 Полный цикл "Импорт → Обучение → Прогресс"

```
ЭТАП 1: ПОДГОТОВКА КОНТЕНТА (Desktop)
═════════════════════════════════════════════════════════

Пользователь (преподаватель)
    ↓
[Вставить текст урока]
    ├─ Format: #TOPIC 4 | Рассказ о себе
    │           ##BLOCK verb_group | Кто я...
    │           #WORD llamarse | зваться
    │           Me llamo Victor. | Меня зовут Виктор.
    │           ...
    │
Parser (Combine.Services.Parser)
    ├─ Парсит блоки (verb_group, phrase_group, vocabulary, story)
    ├─ Извлекает пары (ES → RU)
    ├─ Считает символы
    ├─ Проверяет корректность
    └─ Output: структура данных Lesson

[Настроить параметры]
    ├─ API Key (Keychain)
    ├─ Голосы (voice_id для ES и RU)
    ├─ Модель (multilingual_v2 / flash_v2.5)
    ├─ Параметры синтеза (stability, similarity_boost)
    └─ Output: SessionConfig

[Генерировать]
    ├─ Очередь запросов к ElevenLabs API
    │  ├─ Для каждой фразы:
    │  │  ├─ POST /v1/text-to-speech/{voice_id}
    │  │  ├─ Текст ES → audio/es/{id}.mp3
    │  │  ├─ Текст RU → audio/ru/{id}.mp3
    │  │  ├─ Обновить JSON (status = done)
    │  │  └─ На ошибке: retry с exponential backoff
    │  └─ Сохранить логи и прогресс
    │
[Экспорт]
    ├─ Создать папку ~/lessons/04-hablar-de-mi-mismo/
    ├─ Архивировать: audio/ + lesson.json → lesson-04.zip
    └─ Готово к передаче на iOS


ЭТАП 2: ИМПОРТ НА iOS
═════════════════════════════════════════════════════════

Пользователь (студент)
    ↓
[Получил файл lesson-04.zip]
    (через AirDrop / iCloud / email / USB)
    ↓
[Открыть в Audio Learner]
    ├─ File Picker (Document Picker Controller)
    ├─ Пользователь выбирает ZIP файл
    └─ iOS передаёт URL в приложение через intent


FileImportService
    ├─ Распаковать ZIP в temp папку
    ├─ Парсить lesson.json (JSONDecoder)
    ├─ Валидировать структуру (наличие всех полей)
    ├─ Проверить аудио файлы
    │  ├─ audio/es/*.mp3 (все должны быть)
    │  └─ audio/ru/*.mp3
    ├─ Если урок существует → показать диалог
    │  ├─ [Обновить] — копировать новые аудио, сохранить прогресс
    │  ├─ [Заменить] — полная замена (потерять прогресс)
    │  └─ [Отмена]
    └─ Output: LessonInfo (готова к индексированию)


LessonRepository (CoreData)
    ├─ Создать entity Lesson
    │  ├─ topicId, topicNumber, titleRu, createdAt, ...
    │  └─ stats (phraseCount, characterCount, ...)
    │
    ├─ Для каждого блока → создать LessonBlock
    │  ├─ blockId, type (verb_group / phrase_group / vocabulary / story)
    │  ├─ titleRu, orderIndex
    │  └─ связь к Lesson
    │
    ├─ Для каждой группы → создать PhraseGroup
    │  ├─ key ("llamarse" или "Первое знакомство")
    │  ├─ translationRu
    │  └─ связь к LessonBlock
    │
    ├─ Для каждой фразы → создать Phrase
    │  ├─ phraseId, textEs, textRu
    │  ├─ state = "learning" (по умолчанию)
    │  ├─ reviewCount = 0
    │  ├─ lastReviewDate = null
    │  └─ связь к PhraseGroup + Lesson
    │
    ├─ Для каждого аудио файла → создать AudioFile
    │  ├─ fileId, language (es / ru)
    │  ├─ localPath (Documents/AudioLearner/lessons/...)
    │  ├─ durationMs (парсить из MP3 metadata)
    │  └─ связь к Phrase + Lesson
    │
    ├─ Создать LessonProgress
    │  ├─ phrasesLearning, phrasesInProgress, phrasesMastered (=0)
    │  └─ связь к Lesson
    │
    └─ Save все в CoreData


FileManager
    ├─ Копировать распакованные файлы
    │  ├─ из ~/temp_imports/lesson-04/
    │  ├─ в ~/Documents/AudioLearner/lessons/04-hablar-de-mi-mismo/
    │  └─ Structure:
    │      lesson.json
    │      audio/
    │      ├─ es/*.mp3
    │      └─ ru/*.mp3
    │
    └─ Удалить temp папку


UI Update
    ├─ Toast: "Урок 'Рассказ о себе' добавлен (81 фраза)"
    ├─ LessonListView обновляется (новый урок в списке)
    └─ Готово к обучению


ЭТАП 3: ОБУЧЕНИЕ (iOS)
═════════════════════════════════════════════════════════

[Выбрать урок → нажать "Играть"]
    └─ Переход в SessionTabView


[Выбрать фразы для сессии]
    ├─ PhraseSelectionView
    ├─ Фильтр: все / выучено / в процессе / учу
    ├─ Выбор группы (1-10 / 11-20 / ...)
    ├─ Мультиселект: 35 из 81 фраз
    └─ Output: selectedPhrases: [Phrase]


[Настроить параметры сессии]
    ├─ SessionConfigView
    ├─ Повторения: 5
    ├─ Скорость: 0.5x
    ├─ Пауза между повторениями: 7 сек
    ├─ Режим воспроизведения: один раз / цикл / цикл сессии
    ├─ Показ текста на lock screen: оригинал + перевод
    └─ Output: SessionConfig


SessionPlayerService
    ├─ Сгенерировать очередь воспроизведения
    │  └─ Для каждой выбранной фразы:
    │     ├─ Повтор 1: фраза ES → пауза 7s → фраза RU
    │     ├─ Пауза 7s
    │     ├─ Повтор 2: фраза ES → пауза 7s → фраза RU
    │     ├─ Пауза 7s
    │     ├─ ... (5 повторений)
    │     └─ Переход к следующей фразе
    │
    └─ Output: очередь [AVPlayerItem] с применённой скоростью 0.5x


AVQueuePlayer + AVAudioEngine
    ├─ Инициализировать плеер
    ├─ Настроить громкость
    ├─ Применить скорость через AVAudioUnitTimePitch (0.5x)
    ├─ Запустить воспроизведение
    └─ Фоновый режим (AVAudioSession.Category = .playback)


SessionPlayerView (UI)
    ├─ Отображение текущей фразы (ES + RU)
    ├─ Progress bar аудио
    ├─ Кнопки: Play / Pause / Previous / Next
    ├─ Скорость: [●●●●○] 0.5x (можно менять в реальном времени)
    ├─ Счётчик повторений: 3/5
    ├─ Lock screen: текст + перевод
    ├─ Обновление MPNowPlayingInfoCenter
    └─ Feedback: вибрация при смене фразы


Во время воспроизведения:
    ├─ Отслеживание текущей позиции (Observer)
    ├─ При завершении фразы:
    │  ├─ Переход к следующей фразе
    │  ├─ Обновление счётчика повторений
    │  └─ При завершении всех повторений:
    │     ├─ Перейти к следующей фразе
    │     └─ Сбросить счётчик
    │
    ├─ При нажатии "Следующая":
    │  ├─ Пропустить оставшиеся повторения
    │  └─ Перейти к следующей фразе
    │
    ├─ При нажатии "Пауза":
    │  └─ Остановить плеер, сохранить позицию
    │
    └─ При нажатии "Завершить сессию":
       └─ Остановить плеер, перейти к SessionCompletedView


ЭТАП 4: ОБНОВЛЕНИЕ ПРОГРЕССА (iOS)
═════════════════════════════════════════════════════════

При завершении сессии:
    ├─ SessionViewModel.completedSession()
    │
    ├─ Для каждой завершённой фразы:
    │  ├─ phrase.reviewCount += 1
    │  ├─ phrase.lastReviewDate = Date()
    │  ├─ Логика обновления state:
    │  │  ├─ if state == "learning" && reviewCount >= 3
    │  │  │  └─ state = "inProgress"
    │  │  └─ else if state == "inProgress" && reviewCount >= 8
    │  │     └─ state = "mastered"
    │  │
    │  └─ Создать PhraseStateUpdate запись (для логирования)
    │
    ├─ Создать LearningSession запись
    │  ├─ sessionId (UUID)
    │  ├─ lesson, startedAt, completedAt
    │  ├─ phrasesCount, phrasesRepeats, actualDurationSeconds
    │  ├─ configData (SessionConfig как JSON)
    │  └─ phraseUpdates (связь к PhraseStateUpdate'ам)
    │
    ├─ Обновить LessonProgress
    │  ├─ phrasesLearning (уменьшилось)
    │  ├─ phrasesInProgress (изменилось)
    │  ├─ phrasesMastered (увеличилось)
    │  ├─ totalSessionsCompleted += 1
    │  ├─ totalMinutesLearned += sessionDuration
    │  └─ lastAccessedAt = Date()
    │
    ├─ Проверить достижения
    │  ├─ firstSession: totalSessionsCompleted == 1 → разблокировать
    │  ├─ weekWarrior: currentStreak == 7 → разблокировать
    │  └─ ...
    │
    └─ Save всё в CoreData


SessionCompletedView
    ├─ Показать результаты сессии
    ├─ Список изменений в state фраз
    ├─ Разблокированные достижения
    ├─ Рекомендации по повтору других уроков
    └─ Кнопки: "Вернуться" / "Новая сессия" / "Статистика"


ЭТАП 5: СТАТИСТИКА (iOS)
═════════════════════════════════════════════════════════

StatisticsView
    ├─ Запрос данных из CoreData
    │  ├─ LessonProgress (по уроку)
    │  ├─ LearningSession (все сессии)
    │  ├─ Phrase (состояние фраз)
    │  └─ LessonProgress.lastAccessedAt (полоса активности)
    │
    ├─ Расчёты (StatisticsService)
    │  ├─ currentStreak (дни подряд)
    │  ├─ bestStreak (макс полоса)
    │  ├─ percentMastered (% выученных по уроку)
    │  └─ nextReviewDates (по SRS)
    │
    ├─ Отображение
    │  ├─ Общие показатели (сессии, часы, среднее время)
    │  ├─ Полоса активности (дни подряд)
    │  ├─ Календарь (heatmap активности)
    │  ├─ По уроках (прогресс каждого)
    │  └─ Слова для повтора (по срочности)
    │
    └─ Экспорт CSV (для анализа извне)
```

---

## 3. КОМПОНЕНТЫ СИСТЕМЫ

### 3.1 Desktop (Combine) компоненты

```
Combine/
├── Frontend (React)
│   ├── ImportPage
│   │   ├── TextInput / FileUpload
│   │   ├── LiveParser (валидация в реальном времени)
│   │   └── Preview (превью структуры)
│   │
│   ├── SettingsPage
│   │   ├── ApiKeyInput (Keychain)
│   │   ├── VoiceSelector (dropdown с preview)
│   │   ├── ModelSelector (flash vs multilingual)
│   │   ├── CostCalculator (реальный расчёт)
│   │   └── AdvancedOptions (stability, similarity, seed)
│   │
│   ├── GenerationPage
│   │   ├── ProgressBar (общий % + текущий элемент)
│   │   ├── BlockTree (развёртываемое дерево блоков)
│   │   ├── Logs (логи с временем и ошибками)
│   │   ├── Controls (Pause / Cancel)
│   │   └─ StatisticsCounter
│   │
│   └── LibraryPage
│       ├── LessonList (фильтр, сортировка)
│       ├── LessonCard (название, статистика)
│       ├── Actions (Play, Export ZIP, Delete)
│       └── GlobalStats (общая статистика)
│
├── Backend (Node.js / Hono)
│   ├── ParserService
│   │   ├── parseMarkdown(text) → structure
│   │   ├── validateStructure(structure) → errors[]
│   │   └── countCharacters(structure) → {es, ru}
│   │
│   ├── ElevenLabsService
│   │   ├── textToSpeech(text, voiceId) → audio.mp3
│   │   ├── withRetry(fn) → exponential backoff
│   │   └── withRateLimit(queue) → max 3 concurrent
│   │
│   ├── FileService
│   │   ├── createLessonFolder(lessonId)
│   │   ├── saveAudioFile(data, path)
│   │   ├── addId3Tags(filePath, metadata)
│   │   └── createZip(folder) → lesson.zip
│   │
│   └── KeychainService
│       └── getApiKey() → stored securely
│
└── IPC (Electron Bridge)
    ├── ipcMain.handle('parse:text', ...)
    ├── ipcMain.handle('generate:lesson', ...)
    ├── ipcMain.on('ui:update', ...)
    └── ipcRenderer.invoke(...) / send(...)
```

### 3.2 iOS компоненты

```
AudioLearner/
├── Views (SwiftUI)
│   ├── LessonListView
│   ├── LessonDetailView
│   ├── ImportLessonView
│   ├── PhraseSelectionView
│   ├── SessionConfigView
│   ├── SessionPlayerView
│   ├── SessionCompletedView
│   ├── StatisticsView
│   ├── SettingsView
│   └── Components/ (переиспользуемые)
│       ├── PhraseCard
│       ├── ProgressBar
│       ├── FilterBar
│       └── StateIndicator
│
├── ViewModels (@Observable)
│   ├── LessonViewModel
│   ├── SessionViewModel
│   ├── PlayerViewModel
│   ├── StatisticsViewModel
│   └── SettingsViewModel
│
├── Services
│   ├── LessonRepository (CoreData CRUD)
│   │   ├── fetchLessons()
│   │   ├── saveLesson(lesson)
│   │   ├── deleteLesson(lessonId)
│   │   └── updatePhraseState(phraseId, newState)
│   │
│   ├── SessionPlayerService (AVFoundation)
│   │   ├── generatePlayQueue(phrases, config)
│   │   ├── play() / pause() / resume()
│   │   ├── skipToNextPhrase()
│   │   ├── setPlaybackSpeed(rate)
│   │   └── cleanUp()
│   │
│   ├── AudioEngineService (AVAudioEngine)
│   │   ├── setupAudioGraph()
│   │   ├── setPlaybackSpeed(rate)
│   │   ├── adjustVolume(value)
│   │   └─ tearDown()
│   │
│   ├── LockScreenService (MediaPlayer)
│   │   ├── updateNowPlayingInfo(phrase, config)
│   │   ├── setupRemoteCommands()
│   │   └── updateLockScreenDisplay(mode)
│   │
│   ├── SpacedRepeatService
│   │   ├── getNextReviewDate(phrase)
│   │   ├── calculateEaseFactor(...)
│   │   └── getRecommendedPhrases(lesson)
│   │
│   ├── StatisticsService
│   │   ├── calculateStreak()
│   │   ├── getActivityHeatmap(period)
│   │   ├── getPhraseStats(phrase)
│   │   └── generateCSV()
│   │
│   └── FileImportService
│       ├── extractZip(url)
│       ├── validateLesson(structure)
│       ├── handleConflicts(existing, new)
│       └── importToDocuments(folder)
│
├── Models (CoreData)
│   ├── Lesson
│   ├── LessonBlock
│   ├── PhraseGroup
│   ├── Phrase
│   ├── AudioFile
│   ├── LessonProgress
│   ├── LearningSession
│   ├── PhraseStatistics
│   └── PhraseStateUpdate
│
├── Utilities
│   ├── DateFormatters
│   ├── ColorScheme
│   ├── HapticFeedback
│   └── Constants
│
└── Persistence
    ├── CoreData Stack
    ├── Documents FileManager
    ├── UserDefaults
    └── Backup / Export
```

---

## 4. DATA FLOW ДИАГРАММЫ

### 4.1 Generation Flow (Combine)

```
User Input (Text)
    ↓
Parser
├─ Markdown parsing
├─ Validation
└─ Structure: {blocks, phrases, words}
    ↓
Cost Calculator
├─ Count chars (ES + RU)
├─ Estimate cost
└─ Show user
    ↓
Settings Applied
├─ API Key (Keychain)
├─ Voice IDs
├─ Model
└─ Synthesis params
    ↓
Generation Queue
├─ Create queue of requests
├─ Concurrent limit: 3
└─ Rate limiting: 100ms delay
    ↓
ElevenLabs API Loop
├─ For each phrase
│  ├─ POST textToSpeech (ES)
│  ├─ POST textToSpeech (RU)
│  ├─ Save MP3 files
│  ├─ Update JSON status
│  └─ On error: retry with backoff
├─ Update progress UI
└─ On completion: finalize
    ↓
Lesson Folder
├─ lesson.json (manifest)
├─ audio/es/*.mp3
└─ audio/ru/*.mp3
    ↓
Export ZIP
├─ Archive folder
├─ Save to ~/Downloads/
└─ Ready for iOS
```

### 4.2 Import & Indexing Flow (iOS)

```
ZIP File (from AirDrop / iCloud / etc)
    ↓
FileImportService
├─ Extract to temp
├─ Validate structure
├─ Parse lesson.json
└─ Check audio files
    ↓
Conflict Resolution
├─ If lesson exists
│  ├─ Show dialog
│  ├─ [Update] → audio files only
│  ├─ [Replace] → full delete + re-import
│  └─ [Cancel]
└─ If new → proceed
    ↓
Copy to Documents
├─ Create: Documents/AudioLearner/lessons/{topicId}/
├─ Copy: audio/ folder
├─ Copy: lesson.json
└─ Delete: temp
    ↓
CoreData Indexing
├─ Create Lesson entity
├─ Create LessonBlock entities
├─ Create PhraseGroup entities
├─ Create Phrase entities
│  └─ state = "learning"
│  └─ reviewCount = 0
├─ Create AudioFile entities
│  └─ localPath = Documents/...
└─ Create LessonProgress entity
    ├─ phrasesLearning = totalCount
    ├─ phrasesInProgress = 0
    └─ phrasesMastered = 0
    ↓
UI Refresh
├─ LessonListView updates
├─ Show toast notification
└─ User can now create sessions
```

### 4.3 Session Playback Flow (iOS)

```
User Creates Session
├─ Select lesson
├─ Select phrases
├─ Configure (repetitions, speed, pause)
└─ Start session
    ↓
SessionPlayerService
├─ Generate play queue
│  ├─ For each phrase
│  │  ├─ For each repetition (1 to N)
│  │  │  ├─ Add AVPlayerItem (ES audio)
│  │  │  ├─ Add silence (pause duration)
│  │  │  ├─ Add AVPlayerItem (RU audio)
│  │  │  └─ Add silence (pause duration)
│  │  └─ Between phrases: extra silence
│  └─ Apply speed to all items
│
├─ Initialize AVQueuePlayer
├─ Set AVAudioSession (.playback)
└─ Start playback
    ↓
During Playback
├─ Observe current time
├─ Update UI (progress bar, current phrase)
├─ Update lock screen (MPNowPlayingInfoCenter)
├─ Handle user actions (skip, repeat, pause)
├─ On phrase end: next phrase
└─ On all complete: finish session
    ↓
Session Complete
├─ Stop playback
├─ Calculate statistics
├─ Update phrase states
│  ├─ phrase.reviewCount += 1
│  ├─ phrase.lastReviewDate = now
│  └─ Update state based on logic
├─ Create LearningSession record
├─ Update LessonProgress
├─ Check achievements
└─ Show completion screen
```

---

## 5. ОБРАБОТКА ОШИБОК И ВОССТАНОВЛЕНИЕ

### 5.1 Combine (Desktop)

| Ошибка | Обработка |
|--------|-----------|
| Неверный формат текста | Парсер показывает строку с ошибкой, пользователь исправляет |
| API ключ неверный | Тест подключения → ошибка → "Проверьте ключ" |
| Rate limit (429) | Exponential backoff (1s → 2s → 4s) + retry (макс 3) |
| Timeout (>30s) | Retry с увеличенным timeout |
| Нет интернета | Ошибка при первом запросе → пользователь проверяет сеть |
| Папка не существует | Создать автоматически |
| Недостаточно места | Ошибка от ОС → пользователь очищает |
| Прерывание (Cmd+C) | JSON сохранен с текущим прогрессом → возобновить позже |

### 5.2 iOS

| Ошибка | Обработка |
|--------|-----------|
| ZIP повреждён | Ошибка при экстрации → "Файл повреждён" |
| Неверная структура | Валидация → ошибка → "Файл не подходит" |
| Аудио файл отсутствует | Ошибка при индексации → "Некоторые файлы потеряны" |
| CoreData сбой | Попытка восстановления → fallback на резервную копию |
| Аудио не воспроизводится | Пропустить фразу, показать ошибку в логе |
| Недостаточно места | Предложить удалить старые уроки |
| Интерферирующий звук | AVAudioSession автоматически приглушает |

---

## 6. СИНХРОНИЗАЦИЯ И КОНФЛИКТЫ

### 6.1 Между Desktop и iOS

**Конфликты:**
```
Сценарий 1: Изменена конфигурация голосов
├─ На Desktop: изменил голос ES на "Diego"
├─ На iOS: уже импортирован урок с "Pablo"
├─ Решение: iOS не трогает уже готовые файлы
│  └─ Переимпортировать урок или оставить как есть

Сценарий 2: Пользователь редактирует фразы на Desktop
├─ На Desktop: изменил текст фразы в исходном файле
├─ На iOS: уже выучена старая версия фразы
├─ Решение: CoreData хранит независимо
│  └─ iOS не синхронизируется → версии могут отличаться

→ ИТОГ: Синхронизация не нужна, так как разные назначения
```

### 6.2 Импорт одного урока дважды

```
Сценарий: Пользователь импортирует урок 04 дважды
├─ Первый раз: успешно импортирован
├─ Второй раз: урок с тем же ID уже существует
│
├─ Диалог выбора:
│  ├─ [Обновить]
│  │  ├─ Копировать новые аудио файлы (перезапись)
│  │  ├─ CoreData Phrase записи остаются те же
│  │  ├─ state, reviewCount, lastReviewDate НЕ меняются
│  │  └─ ✓ Прогресс сохраняется
│  │
│  ├─ [Заменить]
│  │  ├─ Удалить старые файлы и запись Lesson
│  │  ├─ Импортировать как новый урок
│  │  ├─ ⚠ ПОТЕРЯТЬ весь прогресс (warning)
│  │  └─ ✗ Прогресс теряется
│  │
│  └─ [Отмена]
│     └─ Ничего не делать

→ По умолчанию: [Обновить] (сохранить прогресс)
```

---

## 7. РЕЗЕРВНЫЕ КОПИИ И ВОССТАНОВЛЕНИЕ

### 7.1 Автоматические резервные копии (iOS)

```
Trigger: Ежедневно при запуске приложения (если нет копии за сегодня)

Backup включает:
├─ CoreData export (все записи)
├─ Documents/AudioLearner/lessons/ (все аудио)
├─ UserDefaults (настройки)
└─ Metadata (дата, версия приложения)

Save to: Documents/AudioLearner/backups/backup_YYYY-MM-DD_HH-mm.zip

Retention: Хранить последние 7 дней (старые удалять)

Size estimate:
├─ CoreData: ~1 МБ
├─ Уроки: 200 МБ (за ~50 тем)
└─ Итого: ~200 МБ (сжато → ~50 МБ)
```

### 7.2 Восстановление

```
Сценарий: Приложение сбилось, потеряны данные

Действия при следующем запуске:
├─ Проверить целостность CoreData
├─ Если сбой → обнаружить
├─ Предложить восстановление из резервной копии
│  ├─ [Восстановить] → загрузить последнюю backup
│  └─ [Начать заново] → очистить всё
└─ Если успешно восстановлено → Toast "Восстановлено"
```

---

## 8. ПРОИЗВОДИТЕЛЬНОСТЬ И ОПТИМИЗАЦИЯ

### 8.1 Desktop (Combine)

| Операция | Время | Оптимизация |
|----------|-------|-----------|
| Парсинг 81 фразы | ~100ms | Regex-based parsing |
| Генерация 81 фраз ES + RU | ~15-20 мин | Очередь с max 3 concurrent |
| Экспорт ZIP | ~1-2 сек | Архивирование с сжатием |
| **Генерация 50 тем** | **6-8 часов** | Фоновая работа (пользователь может свернуть) |

### 8.2 iOS

| Операция | Время | Оптимизация |
|----------|-------|-----------|
| Распаковка 34 МБ ZIP | ~2-3 сек | Асинхронно в background queue |
| Импорт (CoreData индексирование) | ~1-2 сек | Батчинг операций |
| Загрузка LessonListView (100 фраз) | <100ms | @FetchRequest с NSFetchedResultsController |
| Воспроизведение 35 фраз (8 мин) | Realtime | Streaming, не кэширование в памяти |
| Расчёт статистики | ~100-200ms | Фоновый thread, кэширование |

---

## 9. БЕЗОПАСНОСТЬ

### 9.1 API Key Management

```
Combine (Desktop):
├─ Хранение: Keychain (macOS) или аналог (Windows)
├─ Передача: Не отправляется на сервер
├─ Доступ: Только из Main process
└─ UI: Показывается как sk-••••••••••••

iOS:
├─ API Key не нужен (обработка только offline)
├─ Если будет (в будущем): Keychain
└─ Никогда не передавать на сервер
```

### 9.2 User Data Privacy

```
Combine:
├─ Генерируемые файлы: локально (~/lessons/)
├─ Логи: локально
└─ API логи ElevenLabs: управляются ElevenLabs

iOS:
├─ CoreData: зашифрована iOS (на диске устройства)
├─ Аудио файлы: в Documents (защищены)
├─ Статистика: локально
└─ Никаких аналитики, никаких аккаунтов
```

---

## 10. МАСШТАБИРУЕМОСТЬ

### 10.1 Desktop (Combine)

- **Текущая модель:** 50 тем × ~9 700 файлов
- **Лимит:** Практический лимит зависит от API Rate Limiting
- **Масштабирование:** Добавить больше параллельных запросов (если тариф позволяет)

### 10.2 iOS

- **Лимит хранилища:** 64 ГБ (всё приложение + данные)
- **Практический лимит:** ~200-300 тем (зависит от размера аудио)
- **Оптимизация:** Нет отправки на сервер → не нужна масштабируемость сервера

---

## 11. ROADMAP (v1 → v2+)

### v1.0 (MVP)
- ✓ Combine: генерация
- ✓ iOS: плеер + SRS + статистика
- ✓ ZIP экспорт / импорт

### v1.1 (Polish)
- iCloud Drive синхронизация уроков
- Flash card режим (вопрос → ответ → провалидировать)
- Редактирование фраз на iOS (перегенерировать отдельные)

### v2.0 (Features)
- Экспорт в Anki (.apkg)
- Поддержка других языков
- STT проверка произношения
- Web интерфейс для создания уроков

### v3.0 (Social)
- Синхронизация прогресса через облако
- Делиться достижениями
- Collaborative lessons (совместное обучение)

---

**Конец документа "Архитектура системы"**
