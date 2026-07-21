# 📚 Aprender Español: Audio Learner + Combine

> ⚠️ **Историческое ТЗ.** Как и остальные документы этой папки (SPEC_COMBINE.md,
> SPEC_iOS_AUDIO_LEARNER.md, ARCHITECTURE.md, DEPLOYMENT.md), этот индекс описывает исходный
> план, а не всегда текущую реализацию (диаграммы вроде «Экспорт ZIP → Downloads/» ниже —
> из исходного плана; в реальности ZIP сохраняется в папку уроков, см. `USER_GUIDE.md` §4.1).
> Список фактических отклонений и приоритетный источник истины — [DECISIONS.md](DECISIONS.md).

**Полная техническая спецификация для двухуровневой системы обучения испанскому языку**

---

## 📋 Структура проекта

Этот репо содержит **детальную спецификацию** для двух приложений:

1. **Combine** (Desktop/macOS) — Генератор аудио-уроков из текста
2. **Audio Learner** (iOS) — Мобильное приложение для обучения

### ✅ Созданные документы

```
📄 SPEC_COMBINE.md (50 KB)
   └─ Полная спецификация Desktop приложения
     ├─ Обзор и назначение
     ├─ Входной формат (#TOPIC / ##BLOCK / #WORD)
     ├─ Технический стек (Electron + React + Node.js)
     ├─ Экраны приложения (4 основных)
     │  ├─ Импорт & Парсинг
     │  ├─ Настройки API & Генерации
     │  ├─ Progress с контролем
     │  └─ Библиотека готовых уроков
     ├─ JSON-схема урока (lesson.json)
     ├─ ElevenLabs интеграция
     └─ Экспорт ZIP для iOS

📄 SPEC_iOS_AUDIO_LEARNER.md (80 KB)
   └─ Полная спецификация iOS приложения
     ├─ Архитектура (MVVM + Services)
     ├─ CoreData модели (9 entities)
     ├─ 7 основных экранов
     │  ├─ Список уроков
     │  ├─ Импорт уроков
     │  ├─ Выбор фраз для сессии
     │  ├─ Конфигурация сессии
     │  ├─ Плеер с управлением
     │  ├─ Завершение сессии
     │  ├─ Статистика
     │  └─ Параметры
     ├─ 3 режима воспроизведения
     ├─ Lock Screen интеграция (MPNowPlayingInfoCenter)
     ├─ Widgets (iOS 16.2+)
     ├─ Фоновое воспроизведение
     ├─ Spaced Repetition (SRS)
     ├─ Импорт ZIP файлов
     └─ Файловая структура на iOS

📄 ARCHITECTURE.md (60 KB)
   └─ Архитектура всей системы
     ├─ Двухуровневая архитектура (Desktop ↔ iOS)
     ├─ Полный поток данных (Генерация → Импорт → Обучение → Прогресс)
     ├─ Компоненты обеих систем
     ├─ Data flow диаграммы
     ├─ Обработка ошибок и восстановление
     ├─ Синхронизация и конфликты
     ├─ Резервные копии
     ├─ Производительность & Оптимизация
     ├─ Безопасность (API Key, User Data)
     └─ Roadmap (v1 → v3)

📄 DEPLOYMENT.md (50 KB)
   └─ ElevenLabs API интеграция & Развёртывание
     ├─ Обзор ElevenLabs (тарифы, голоса, лимиты)
     ├─ API Endpoints и коды интеграции (TypeScript)
     ├─ Обработка ошибок и retry логика
     ├─ Развёртывание Combine (сборка, DMG/EXE)
     ├─ Развёртывание iOS (Xcode, TestFlight)
     ├─ Операционные процедуры
     ├─ Troubleshooting
     ├─ Мониторинг расходов & логирование
     ├─ Версионирование и обновления
     ├─ Security checklist
     └─ Performance optimization

📄 README.md (этот файл)
   └─ Навигация и индекс документов
```

---

## 🚀 Быстрый старт

### Для кодера (начало разработки)

1. **Прочитай в этом порядке:**
   ```
   1. ARCHITECTURE.md → Понять общую картину
   2. SPEC_COMBINE.md → Если работаешь на Desktop
   3. SPEC_iOS_AUDIO_LEARNER.md → Если работаешь на iOS
   4. DEPLOYMENT.md → Когда будешь деплоить
   ```

2. **Основные компоненты:**
   - **Desktop:** Electron + React + Hono + ElevenLabs API
   - **iOS:** SwiftUI + CoreData + AVFoundation

3. **Ключевые файлы для старта:**
   - Desktop: `Parser` + `ElevenLabsService` + `GenerationQueue`
   - iOS: `LessonRepository` + `SessionPlayerService` + `SessionViewModel`

### Для переводчика / контент-создателя

1. Используй **формат входных данных** из `SPEC_COMBINE.md § 2.1`
2. Генерируй уроки в **Combine** приложении
3. Экспортируй ZIP и отправляй студентам

### Для тестера / QA

1. Чек-лист в `DEPLOYMENT.md § 10`
2. Troubleshooting гайд в `DEPLOYMENT.md § 5`
3. Test scenarios из `SPEC_COMBINE.md` и `SPEC_iOS_AUDIO_LEARNER.md`

---

## 📊 Диаграммы и схемы

### Поток данных (полный цикл)

```
DESKTOP (Combine)                    MOBILE (iOS)
═════════════════════════════════════════════════════════

[Текст урока]                        
    ↓
[Parser: #TOPIC / ##BLOCK]
    ↓
[Структура + Валидация]
    ↓
[ElevenLabs TTS API]
├─ Генерация: 81 фраза × 2 языка
├─ Контроль скорости + retry
└─ 162 MP3 файла (34 МБ)
    ↓
[lesson.json + audio/]
    ↓
[Экспорт ZIP]
    ├─ /Downloads/lesson-04.zip ──────────┐
    │                                     │
    │ (AirDrop / iCloud / Email)          │
    │                                     ▼
    │                            [FileImportService]
    │                                     │
    │                            ├─ Распаковка
    │                            ├─ Валидация
    │                            ├─ Конфликты?
    │                            └─ Копирование
    │                                     │
    │                            ├─ CoreData:
    │                            │  ├─ Lesson entity
    │                            │  ├─ Phrase entities
    │                            │  └─ AudioFile entities
    │                            │
    │                      [LessonListView]
    │                                     │
    │ [Пользователь учит]                │
    │ ├─ Выбирает фразы (35/81)          │
    │ ├─ Настраивает (5 повторов, 0.5x)  │
    │ ├─ SessionPlayerView               │
    │ └─ Обновляет state (learning→mastered)
    │                                     │
    │                      [LearningSession]
    │                                     │
    │ [Статистика & Достижения]          │
    │                                     │
    └─────────────────────────────────────┘
```

### Архитектура компонентов

```
COMBINE (Desktop)
┌─────────────────────────────────────┐
│ React Frontend                      │
├─────────────────────────────────────┤
│ ImportPage → SettingsPage →         │
│ GenerationPage → LibraryPage        │
└────────────┬────────────────────────┘
             │ IPC
             ▼
┌─────────────────────────────────────┐
│ Electron Main Process               │
├─────────────────────────────────────┤
│ ParserService                       │
│ ElevenLabsService                   │
│ FileService                         │
│ GenerationQueue (rate limiting)     │
└────────────┬────────────────────────┘
             │
             ▼
    ┌────────────────┐
    │ ElevenLabs API │
    └────────────────┘

AUDIO LEARNER (iOS)
┌─────────────────────────────────────┐
│ SwiftUI Views                       │
├─────────────────────────────────────┤
│ LessonListView                      │
│ SessionPlayerView                   │
│ StatisticsView                      │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ ViewModels (@Observable)            │
├─────────────────────────────────────┤
│ SessionViewModel                    │
│ PlayerViewModel                     │
│ StatisticsViewModel                 │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ Services                            │
├─────────────────────────────────────┤
│ SessionPlayerService (AVFoundation) │
│ LessonRepository (CoreData)         │
│ StatisticsService                   │
│ LockScreenService (MediaPlayer)     │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ Persistence                         │
├─────────────────────────────────────┤
│ CoreData (Lesson, Phrase, Progress) │
│ Documents/lessons/ (audio files)    │
│ UserDefaults (settings)             │
└─────────────────────────────────────┘
```

---

## 📈 Метрики и масштабируемость

### Текущий масштаб (50 тем курса)

| Метрика | Значение |
|---------|----------|
| **Всего тем** | 50 |
| **Всего фраз** | ~4 050 (81 avg × 50) |
| **Всего слов лексики** | ~750 (15 avg × 50) |
| **Всего аудиофайлов** | ~9 700 (162 per theme) |
| **Языков** | 2 (ES + RU) |
| **Общий размер** | ~1.7 ТБ (34 МБ × 50) |
| **Стоимость TTS** | ~$37.50 (Multilingual v2) |
| **Время генерации** | ~6–8 часов (фоном) |

### Производительность

| Операция | Время | Масштабируемо? |
|----------|-------|---|
| Генерация 81 фразы | 15–20 мин | Да (rate limited) |
| Импорт ZIP (34 МБ) | 2–3 сек | Да |
| Воспроизведение сессии | Real-time | Да (streaming) |
| Статистика (50 тем) | <200ms | Да (кэшированные вычисления) |

---

## 🔐 Безопасность

### API Key Management
- ✅ Keychain (не в памяти)
- ✅ Не отправляется на сервер
- ✅ Не в логах

### User Data Privacy
- ✅ Локально (никаких облаков)
- ✅ Нет аналитики / трекинга
- ✅ Нет аккаунтов / синхронизации
- ✅ iOS хранит данные с шифрованием ОС

### Обработка ошибок
- ✅ Retry логика (exponential backoff)
- ✅ Graceful degradation (пропустить фразу при ошибке)
- ✅ Резервные копии (daily на iOS)

---

## 📦 Зависимости и требования

### Desktop (Combine)

```
Node.js 18+
npm / yarn
Electron 24+
React 18
Typescript 5+
ElevenLabs API account (Pay-as-you-go)
```

### iOS

```
iOS 15+
Swift 5.9+
Xcode 14+
SwiftUI
CoreData
AVFoundation
MediaPlayer
ZipFoundation (SPM, опционально)
```

---

## 🎯 Ключевые особенности

### Combine (Desktop)
- ✅ Парсинг структурированного текста (#TOPIC / ##BLOCK)
- ✅ Интеграция с ElevenLabs TTS API
- ✅ Rate limiting + retry logic (exponential backoff)
- ✅ Real-time прогресс и логирование
- ✅ ID3 теги в MP3 (опционально)
- ✅ Экспорт ZIP для iOS
- ✅ Идемпотентность (resumable generation)

### Audio Learner (iOS)
- ✅ Импорт ZIP → распаковка → индексация
- ✅ 3 режима воспроизведения (один раз / цикл / цикл сессии)
- ✅ Контроль скорости (0.5x – 2.0x) + паузы между повторениями
- ✅ Спaced Repetition (SRS) — автоматическое обновление статуса фраз
- ✅ Статистика (полоса, календарь активности, рекомендации)
- ✅ Lock Screen интеграция (текст + перевод)
- ✅ Widget (iOS 16.2+)
- ✅ Фоновое воспроизведение
- ✅ Резервные копии + восстановление

---

## 🛠 Процесс разработки

### Phase 1: MVP (текущий)
1. Combine: базовая генерация + ElevenLabs
2. iOS: плеер + импорт + базовый прогресс
3. Минимум UI, работающей функционал

### Phase 2: Полировка (v1.0)
1. UI/UX refinement
2. Полная статистика + SRS
3. Lock screen widget
4. Обработка всех edge cases

### Phase 3: Features (v1.1+)
1. Flash card режим
2. iCloud sync (опционально)
3. Редактирование фраз на iOS
4. Экспорт в Anki (.apkg)

### Phase 4: Advanced (v2.0+)
1. Поддержка других языков
2. STT проверка произношения
3. Web интерфейс для создания уроков
4. Social / cloud synchronization

---

## 📞 Контакты и поддержка

### Где найти информацию

| Вопрос | Документ |
|--------|----------|
| Как работает приложение? | ARCHITECTURE.md |
| Как разработать Desktop приложение? | SPEC_COMBINE.md |
| Как разработать iOS приложение? | SPEC_iOS_AUDIO_LEARNER.md |
| Как развернуть и настроить? | DEPLOYMENT.md |
| Что-то не работает? | DEPLOYMENT.md § 5 (Troubleshooting) |
| Как интегрировать ElevenLabs? | DEPLOYMENT.md § 1 |
| Сколько будет стоить? | DEPLOYMENT.md § 1.3 |

### Контрольные списки

- **Pre-launch checklist:** `DEPLOYMENT.md § 10`
- **Security checklist:** `DEPLOYMENT.md § 8`
- **Testing scenarios:** каждый SPEC_*.md файл

---

## 📝 Версия документации

```
Версия: 1.0
Дата: 21 июля 2026
Статус: Complete specification (ready for development)
Обновлено: [дата последнего обновления]
```

---

## 📖 Как читать эту документацию

### Для быстрого понимания (30 мин)
1. Этот файл (README) — обзор
2. ARCHITECTURE.md § 1 — архитектура
3. SPEC_COMBINE.md § 1–2 — что такое Combine
4. SPEC_iOS_AUDIO_LEARNER.md § 1–2 — что такое iOS app

### Для разработки (полный день)
1. Выбери свой фокус (Combine или iOS)
2. Прочитай соответствующий SPEC_*.md полностью
3. ARCHITECTURE.md — как компоненты взаимодействуют
4. DEPLOYMENT.md — как запустить

### Для интеграции ElevenLabs (2 часа)
1. DEPLOYMENT.md § 1 — обзор ElevenLabs
2. DEPLOYMENT.md § 1.4–1.6 — код интеграции
3. SPEC_COMBINE.md § 5 — как используется в приложении

---

## ✨ Итоги

Эта спецификация описывает **полнофункциональную систему** для обучения языкам:

✅ **Desktop сервис** (Combine) — генерирует высококачественные аудио-уроки  
✅ **Mobile приложение** (iOS) — интерактивный плеер с отслеживанием прогресса  
✅ **Простая передача данных** — ZIP архивы, никакой синхронизации  
✅ **Полностью локальное** — никаких аккаунтов, анализа, облака  
✅ **Масштабируемое** — на 50 тем с ~10K аудио файлами  
✅ **Экономичное** — ~$37 за весь курс (ElevenLabs API)  

**Готово к разработке!** 🚀

---

**Created:** 2026-07-21  
**Last Updated:** 2026-07-21  
**Status:** ✅ Complete
