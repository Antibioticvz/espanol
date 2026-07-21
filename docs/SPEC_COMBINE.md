# Спецификация: Приложение "Combine" (Desktop)

**Версия:** 1.0  
**Дата:** 21 июля 2026  
**Назначение:** Генератор аудио-уроков испанского языка через ElevenLabs API

---

## 1. ОБЗОР

### 1.1 Назначение
Combine — однократный инструмент для **генерации набора уроков испанского языка** на основе:
- Текстового файла с разметкой (уроки × блоки × фразы)
- API-ключа ElevenLabs
- Выбора голосов и модели синтеза
- Параметров (retry-логика, паузы между запросами, ID3-теги)

### 1.2 Целевой пользователь
Разработчик/преподаватель, готовящий курс испанского языка. Запускает ~1-2 раза в неделю для генерации новых тем.

### 1.3 Ключевые характеристики
- **Локальное приложение** (никаких аккаунтов, синка, подписок)
- **~9 700 аудиофайлов** на весь курс (50 тем)
- **Генерация в фоне** (долгая операция, ~часы на весь курс)
- **Идемпотентность** (можно паузить/возобновлять, не теряя прогресс)
- **Экспорт в ZIP** для загрузки на iOS

---

## 2. ВХОДНОЙ ФОРМАТ

### 2.1 Основной формат (Markdown-like с разметкой)

```markdown
#TOPIC 4 | Рассказ о себе

##BLOCK verb_group | Кто я — происхождение и факты

#WORD llamarse | зваться
Me llamo Victor. | Меня зовут Виктор.
¿Cómo te llamas tú? | Как тебя зовут?
Todos me llaman Vic, para abreviar. | Все зовут меня Вик, для краткости.

#WORD tener | иметь (возраст)
Tengo cuarenta años. | Мне сорок лет.
¿Cuántos años tienes tú? | Сколько лет тебе?

##BLOCK phrase_group | Ходовые фразы

#CATEGORY Первое знакомство
Mucho gusto, soy Victor. | Очень приятно, я Виктор.
Encantado de conocerte. | Приятно познакомиться.

#CATEGORY О работе
Soy programador. | Я программист.
Trabajo a distancia. | Я работаю удалённо.

##BLOCK vocabulary | Ключевая лексика
el programador | программист
a distancia | удалённо
la familia | семья
el hermano | брат

##BLOCK story | Короткий рассказ
ES: Me llamo Victor y tengo cuarenta años. Soy programador y trabajo a distancia. Tengo una familia grande...
RU: Меня зовут Виктор, мне сорок лет. Я программист и работаю удалённо. У меня большая семья...
```

### 2.2 Правила парсинга

| Элемент | Формат | Пример | Обязателен |
|---------|--------|--------|-----------|
| **Тема** | `#TOPIC <номер> \| <название>` | `#TOPIC 4 \| Рассказ о себе` | ✓ Ровно 1 |
| **Блок** | `##BLOCK <тип> \| <заголовок>` | `##BLOCK verb_group \| Кто я...` | ✓ 1+ |
| **Группа фраз** | `#WORD <слово> \| <перевод>` или `#CATEGORY <название>` | `#WORD llamarse \| зваться` | ○ Опционально |
| **Фраза** | `<ES текст> \| <RU текст>` | `Me llamo Victor. \| Меня зовут Виктор.` | ✓ 1+ |
| **Слово лексики** | `<ES> \| <RU>` | `el programador \| программист` | ✓ В vocabulary |
| **Рассказ** | `ES: <текст>` на строке, затем `RU: <текст>` на следующей | `ES: Me llamo...\nRU: Меня зовут...` | ✓ В story |

### 2.3 Типы блоков

- **`verb_group`** — глаголы и действия, сгруппированные по инфинитиву (llamarse, tener и т.д.)
- **`phrase_group`** — устойчивые фразы, сгруппированные по категориям (Первое знакомство, О работе)
- **`vocabulary`** — плоский список слов без группировки
- **`story`** — один сплошной текст (рассказ B1-B2)

### 2.4 YAML-расширение (опционально)

```yaml
---
topic_id: 04-hablar-de-mi-mismo
topic_number: 4
title_ru: Рассказ о себе
title_es: Cuéntame sobre ti
language_variants:
  spanish_region: es-MX  # es-MX, es-ES
  speed_multiplier: 1.0
---

#TOPIC 4 | Рассказ о себе
...
```

---

## 3. АРХИТЕКТУРА

### 3.1 Технический стек

**Рекомендация: Electron** (максимум совместимости и скорость к MVP)

```
Frontend:
  ├─ React 18 + TypeScript
  ├─ Tailwind CSS (UI)
  ├─ React Query (state management)
  └─ react-markdown (превью)

Backend (Main/Worker process):
  ├─ Node.js + Hono (или Express.js)
  ├─ TypeScript
  ├─ axios (для ElevenLabs API)
  ├─ node-id3 (ID3-теги)
  └─ adm-zip (архивирование)

Безопасность:
  └─ electron-safe-storage (Keychain macOS)

Сборка:
  ├─ webpack / Vite
  ├─ electron-builder (→ .dmg / .exe)
  └─ Notarization для macOS (если публиковать)
```

### 3.2 Папки проекта

```
combine/
├── src/
│   ├── main/                      # Electron main process
│   │   ├── index.ts
│   │   ├── window.ts              # создание окна
│   │   ├── ipc-handlers.ts        # IPC коммуникация
│   │   └── services/
│   │       ├── parser.service.ts
│   │       ├── eleven-labs.service.ts
│   │       ├── file.service.ts
│   │       └── keychain.service.ts
│   │
│   ├── renderer/                  # React фронтенд
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── ImportPage.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   ├── GenerationPage.tsx
│   │   │   └── LibraryPage.tsx
│   │   ├── components/
│   │   │   ├── ParserPreview.tsx
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── LogViewer.tsx
│   │   │   └── VoicePreview.tsx
│   │   ├── hooks/
│   │   │   ├── useGeneration.ts
│   │   │   ├── useSettings.ts
│   │   │   └── useKeychain.ts
│   │   ├── types/
│   │   │   ├── lesson.types.ts
│   │   │   ├── api.types.ts
│   │   │   └── config.types.ts
│   │   └── styles/
│   │       └── globals.css
│   │
│   └── shared/                    # Общие типы
│       ├── types.ts
│       ├── constants.ts
│       └── utils.ts
│
├── public/                        # Assets
├── package.json
├── tsconfig.json
├── webpack.config.js              # Electron webpack конфиг
└── electron-builder.yml           # Сборка
```

---

## 4. ЭКРАНЫ И ФУНКЦИОНАЛ

### 4.1 Экран 1: Импорт текста

**UI Структура:**
```
┌──────────────────────────────────────────────────────┐
│ Импорт урока                                         │
├──────────────────────────────────────────────────────┤
│                                                      │
│ Шаг 1/4: Загрузка текста                             │
│                                                      │
│ [📄 Загрузить файл] [Вставить текст вручную]        │
│                                                      │
│ ┌──────────────────────────────────────────────────┐│
│ │ #TOPIC 4 | Рассказ о себе                       ││
│ │ ##BLOCK verb_group | Кто я — происхождение      ││
│ │ #WORD llamarse | зваться                        ││
│ │ Me llamo Victor. | Меня зовут Виктор.           ││
│ │ ...                                              ││
│ │ (scrollable, монофонт, 600px высота)            ││
│ └──────────────────────────────────────────────────┘│
│                                                      │
│ ✓ Анализ формата                                    │
│   • #TOPIC найден: "Рассказ о себе" ✓              │
│   • Блоков: 4 ✓                                    │
│   • Фраз: 81 ✓                                     │
│   • Символов ES: 3 737                             │
│   • Символов RU: 3 799                             │
│   • Ошибок: 0                                      │
│                                                      │
│ ⚠ Предупреждения:                                   │
│   (нет)                                             │
│                                                      │
│ Статус: ✓ Готово к генерации                        │
│                                                      │
│ [Отмена] [Далее →]                                  │
└──────────────────────────────────────────────────────┘
```

**Функционал:**
- **File picker** — загружает `.txt`, `.md`, `.md.txt`
- **Textarea** — паста текста вручную
- **Live парсинг** — в реальном времени считает блоки, фразы, символы
- **Валидация** — подсвечивает ошибки парсинга с номером строки
- **Кнопка "Даже→"** — переходит на экран настроек если всё окей

**Валидация ошибок:**
```
⚠ Ошибка на строке 45:
  Фраза без разделителя |
  "Me llamo Victor y Victor"
  
✓ Исправить? Скопируй строку выше с правильным форматом
```

---

### 4.2 Экран 2: Настройки API и генерации

**UI: Две панели**

**Левая панель — ElevenLabs параметры:**
```
┌─────────────────────────────────────────┐
│ API Key                                 │
│ [sk-••••••••••••••••••] [Изменить]     │
│ [✓ Подключение активно]                 │
│                                         │
│ Модель TTS                              │
│ ◉ Multilingual v2  ($0.10 / 1000 сим)  │
│ ○ Flash v2.5       ($0.05 / 1000 сим)  │
│                                         │
│ Голос испанский                         │
│ ┌─────────────────────────┐             │
│ │ Pablo ▼ (es-MX)        │             │
│ │ Diego                   │             │
│ │ Maria                   │             │
│ │ Sofia                   │             │
│ └─────────────────────────┘             │
│ [🔊 Слушать тест] (воспроизводит)      │
│                                         │
│ Голос русский                           │
│ ┌─────────────────────────┐             │
│ │ Masha ▼ (ru-RU)        │             │
│ │ Sasha                   │             │
│ │ Natasha                 │             │
│ │ Aleksandr               │             │
│ └─────────────────────────┘             │
│ [🔊 Слушать тест]                       │
│                                         │
│ Параметры синтеза                       │
│                                         │
│ Стабильность (stability)                │
│ [●●●○○] 0.5                             │
│ ↳ 0.0 = более вариативен                │
│ ↳ 1.0 = монотонен                       │
│                                         │
│ Сходство голоса (similarity_boost)      │
│ [●●●●○] 0.75                            │
│ ↳ 0.0 = более экспрессивен              │
│ ↳ 1.0 = точнее копирует голос           │
│                                         │
│ Seed (для воспроизводимости)            │
│ [_______] (пусто = случайный)           │
│                                         │
│ Дополнительно                           │
│ ☑ Добавить ID3-теги (title, artist)    │
│ ☑ Повторять при ошибке (макс 3)        │
│ ☐ Детальное логирование                │
│ ☑ Использовать кэш (не пересоздавать)  │
│                                         │
└─────────────────────────────────────────┘
```

**Правая панель — параметры генерации:**
```
┌─────────────────────────────────────────┐
│ Папка вывода                            │
│ [/Users/user/lessons]                   │
│ [📂 Обзор...]                           │
│                                         │
│ Параллельные запросы                    │
│ [3] (мин 1, макс 5)                     │
│ ℹ Больше = быстрее, но риск 429         │
│                                         │
│ Макс попыток (max retries)              │
│ [3] (1–10)                              │
│                                         │
│ Delay между запросами                   │
│ [100] ms                                │
│                                         │
│ Timeout на запрос                       │
│ [30] сек                                │
│                                         │
│ ═════════════════════════════════════   │
│                                         │
│ 📊 РАСЧЁТ СТОИМОСТИ                    │
│                                         │
│ Модель: Multilingual v2                 │
│ Языков: 2                               │
│ Фраз всего: 81 + 15 (vocab) + 1 (story) │
│                                         │
│ Символов:                               │
│   ES: 3 737                             │
│   RU: 3 799                             │
│   ИТОГО: 7 536                          │
│                                         │
│ Цена: 7 536 × $0.10 / 1000 = $0.75    │
│                                         │
│ ⚠ Это оценка, ± 5% из-за ElevenLabs   │
│   подсчёта. Реальная цена уточнится    │
│   после генерации.                      │
│                                         │
│ ═════════════════════════════════════   │
│                                         │
│ [Назад] [Пересчитать] [Генерировать →] │
└─────────────────────────────────────────┘
```

**Функционал:**
- API-ключ через Keychain (не показывается полностью)
- Dropdown для выбора голосов с preview (кнопка "Слушать")
- Слайдеры для параметров синтеза
- Проверка подключения к API (кнопка сам запускает тест)
- Автоматический расчёт стоимости
- Параметры retry-логики

---

### 4.3 Экран 3: Генерация (Progress & Control)

```
┌─────────────────────────────────────────────────┐
│ Генерация: Рассказ о себе                       │
├─────────────────────────────────────────────────┤
│                                                 │
│ [×] Генерация выполняется... Шаг 3/3             │
│                                                 │
│ ══════ ОБЩИЙ ПРОГРЕСС ══════                    │
│                                                 │
│ Статус: [████████════] 66% (54 / 81 фраз)     │
│                                                 │
│ Текущий элемент:                                │
│ 💬 04-b1-llamarse-02 (ES)                       │
│    "¿Cómo te llamas tú?"                        │
│    [████████───] 3.2 / 4.8 сек                  │
│                                                 │
│ ══════ СТАТИСТИКА ══════                        │
│                                                 │
│ Скорость: 12.4 фраз/мин                        │
│ Осталось: ~3 мин                                │
│ Прошло: 15 мин                                  │
│                                                 │
│ Успешно: 54  | Ошибок: 0  | Пропущено: 0       │
│ Потрачено: $0.41 / $0.75 (55%)                 │
│                                                 │
│ ══════ ДЕРЕВО БЛОКОВ (РАЗВЁРТЫВАЕМОЕ) ══════    │
│                                                 │
│ ▼ BLOCK 1: verb_group (20 фраз) [████████──]   │
│   ▼ llamarse (5 фраз) [██████████]              │
│     ✓ 04-b1-llamarse-01 ES (1.2 сек)           │
│     ✓ 04-b1-llamarse-01 RU (1.1 сек)           │
│     ✓ 04-b1-llamarse-02 ES (1.3 сек)           │
│     ✓ 04-b1-llamarse-02 RU (1.2 сек)           │
│     ⏱ 04-b1-llamarse-03 ES [generating...]    │
│   ▼ tener (6 фраз) [██████░░░░]                 │
│     ...                                         │
│                                                 │
│ ▼ BLOCK 2: phrase_group (30 фраз) [████░░░░░░]│
│                                                 │
│ ▼ BLOCK 3: vocabulary (15 слов) [░░░░░░░░░░]  │
│                                                 │
│ ▼ BLOCK 4: story (1) [░░░░░░░░░░]               │
│                                                 │
│ ══════ ПОСЛЕДНИЕ ЛОГИ ══════                    │
│                                                 │
│ [Show all (15)]                                 │
│                                                 │
│ ✓ [14:52:18] 04-b1-llamarse-02 (RU) Done       │
│ ✓ [14:52:16] 04-b1-llamarse-02 (ES) Done       │
│ ⚠ [14:52:10] 04-b1-llamarse-03 (ES)            │
│     429 Too Many Requests → retry #1/3          │
│ ⚠ [14:52:11] 04-b1-llamarse-03 (ES)            │
│     429 Too Many Requests → retry #2/3          │
│ ✓ [14:52:14] 04-b1-llamarse-03 (ES) Done       │
│ • [14:52:15] 04-b1-llamarse-03 (RU) Generating │
│                                                 │
│              [⏸ Пауза] [⏹ Отмена]               │
│                                                 │
│ Папка вывода: /Users/user/lessons/04-hablar...  │
│               [📂 Открыть в Finder]             │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Функционал:**
- Дерево блоков с развёртываением
- Статусы: ✓ (done) / ⏱ (generating) / ⚠ (failed + причина) / ◯ (pending)
- Real-time логи с временем и деталями
- Кнопки **Пауза** / **Отмена**
- При паузе — JSON сохраняется с `status: paused`
- При возобновлении — берёт только `pending` / `failed`

**Обработка ошибок:**
```
Если произойдёт ошибка (429, 5xx, timeout):
1. Запись в лог с временем и кодом ошибки
2. Автоматический retry с exponential backoff
3. Если все retries исчерпаны → статус = failed
4. Кнопка "Возобновить" → пересчитывает только failed
```

---

### 4.4 Экран 4: Библиотека (завершённые уроки)

```
┌──────────────────────────────────────────────────┐
│ Библиотека уроков                                │
├──────────────────────────────────────────────────┤
│                                                  │
│ [Фильтр] ◉ Все  ○ Готовые  ○ В процессе  ○ Ошибки
│ Сортировка: [По дате ▼] [По размеру] [По теме] │
│                                                  │
│ ══════════════════════════════════════════════  │
│                                                  │
│ 🎯 Рассказ о себе (Тема 04)                     │
│ ───────────────────────────────────             │
│ 81 фраза • 15 слов • ✓ Готово                   │
│ Дата: 21 июля 2026, 14:27                      │
│ Размер: 34.2 МБ                                 │
│ Модель: Multilingual v2                         │
│ Голоса: Pablo (ES) / Masha (RU)                 │
│ Стоимость: $0.74                                │
│                                                  │
│ [🎵 Проиграть] [📂 Папка] [⋯ Ещё]              │
│                                                  │
│ Меню (⋯):                                        │
│  • Экспорт ZIP → Downloads/lesson-04.zip        │
│  • Просмотр JSON (в редакторе)                 │
│  • Переделать (перегенерировать всё)           │
│  • Переделать only failed (только ошибки)      │
│  • Удалить урок                                 │
│  • Скопировать в буфер обмена (JSON)           │
│                                                  │
│ ──────────────────────────────────────────────  │
│                                                  │
│ 🛒 Покупки в магазине (Тема 03)                  │
│ ───────────────────────────────────             │
│ 67 фраз • 20 слов • ✓ Готово                    │
│ Дата: 20 июля 2026, 18:45                      │
│ Размер: 28.1 МБ                                │
│ Стоимость: $0.61                                │
│                                                  │
│ [🎵 Проиграть] [📂 Папка] [⋯ Ещё]              │
│                                                  │
│ ──────────────────────────────────────────────  │
│                                                  │
│ ⚠ Магазин (Тема 02) — В ПРОЦЕССЕ                │
│ ───────────────────────────────────             │
│ 45 фраз • ⏳ Прервана на 50%                     │
│                                                  │
│ [▶ Возобновить] [📂 Папка] [🗑 Удалить]        │
│                                                  │
│ ══════════════════════════════════════════════  │
│                                                  │
│ 📊 СТАТИСТИКА ПО ВСЕМ УРОКАМ:                  │
│                                                  │
│ Готовых: 8                                      │
│ Всего фраз: 613                                 │
│ Всего символов: 29 500                          │
│ Потрачено денег: $7.23                          │
│ Общий размер: ~215 МБ                           │
│                                                  │
│ Дополнительно:                                  │
│ Тариф: Pay-as-you-go (балансе не отслеживается)│
│                                                  │
└──────────────────────────────────────────────────┘
```

**Функционал:**
- Список всех уроков
- Фильтр по статусу
- Сортировка (дата, размер, тема)
- Встроенный плеер (слушать фразы)
- **Экспорт ZIP** → создаёт архив для iOS
- **Переделать** → перегенерирует, не трогая готовые
- **Переделать only failed** → только ошибки
- Удаление урока
- Общая статистика

---

## 5. ЭLEVENLAB ИНТЕГРАЦИЯ

### 5.1 Логика запросов

```
Для каждой фразы:

1. Проверка кэша
   └─ Файл уже есть? (status = done)
      └─ Пропустить

2. Запрос TTS
   ├─ Текст (ES или RU)
   ├─ Голос (voice_id)
   ├─ Модель (multilingual_v2 или flash_v2.5)
   ├─ Параметры (stability, similarity_boost, seed)
   └─ → audio.mp3

3. Сохранение
   ├─ Создать папку audio/{lang}/
   ├─ Сохранить файл с ID
   ├─ Добавить ID3-теги (если включено)
   └─ Обновить JSON (status = done)

4. На ошибке
   ├─ Код 429 (rate limit) → exponential backoff
   ├─ Код 5xx (сервер) → exponential backoff
   ├─ Timeout → retry
   └─ Макс retries = 3 (настраивается)

5. Final
   └─ JSON (status = done / failed)
```

### 5.2 Rate Limiting

**ElevenLabs лимиты (по тарифу):**
- Free: ~10 req/min
- Starter: ~30 req/min
- Creator/Pro: 500+ req/min

**Реализация в Combine:**
```typescript
// Очередь с семафором
const MAX_CONCURRENT = 3;  // начально для Free
const DELAY_BETWEEN_REQUESTS = 100; // ms

async function generateWithRateLimit(phrases: Phrase[]) {
  const queue = new PQueue({ concurrency: MAX_CONCURRENT });
  const results = [];
  
  for (const phrase of phrases) {
    queue.add(async () => {
      await sleep(DELAY_BETWEEN_REQUESTS);
      return generatePhrase(phrase);
    });
  }
  
  results = await queue.onIdle();
}

// Exponential backoff
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
}
```

### 5.3 ID3-теги

Если `add_id3_tags: true`:

```
Параметр       | Значение
───────────────┼─────────────────────────────────────
Title (TIT2)   | "Me llamo Victor."
Artist (TPE1)  | "Pablo" (для ES) / "Masha" (для RU)
Album (TALB)   | "Рассказ о себе"
Comment (COMM) | "Меня зовут Виктор."
Year (TYER)    | 2026
Genre (TCON)   | "Language Learning"
Track (TRCK)   | "04-b1-llamarse-01"
```

**Реализация (Node.js):**
```typescript
import * as id3 from 'node-id3';

await id3.write({
  title: phrase.textEs,
  artist: voiceName,
  album: lessonTitle,
  comment: { text: phrase.textRu },
  year: new Date().getFullYear().toString()
}, filePath);
```

---

## 6. JSON-СХЕМА УРОКА

```json
{
  "topic_id": "04-hablar-de-mi-mismo",
  "topic_number": 4,
  "title_ru": "Рассказ о себе",
  "title_es": "Cuéntame sobre ti",
  "created_at": "2026-07-21T14:27:00Z",
  "generator_version": "1.0.0",
  
  "config": {
    "model": "eleven_multilingual_v2",
    "voice_spanish": "Pablo",
    "voice_russian": "Masha",
    "stability": 0.5,
    "similarity_boost": 0.75,
    "seed": null
  },
  
  "stats": {
    "phrase_count": 81,
    "vocab_count": 15,
    "story_count": 1,
    "total_elements": 97,
    "characters_es": 3737,
    "characters_ru": 3799,
    "total_characters": 7536,
    "estimated_cost_usd": 0.75,
    "actual_cost_usd": 0.74,
    "generation_duration_seconds": 720,
    "file_size_mb": 34.2
  },
  
  "blocks": [
    {
      "block_id": "b1",
      "type": "verb_group",
      "title_ru": "Кто я — происхождение и факты",
      "title_es": "Quién soy - origen y hechos",
      "groups": [
        {
          "key": "llamarse",
          "translation_ru": "зваться",
          "order_index": 0,
          "phrases": [
            {
              "id": "04-b1-llamarse-01",
              "es": "Me llamo Victor.",
              "ru": "Меня зовут Виктор.",
              "audio": {
                "es": "audio/es/04-b1-llamarse-01.mp3",
                "ru": "audio/ru/04-b1-llamarse-01.mp3"
              },
              "duration_ms": {
                "es": 1200,
                "ru": 1100
              },
              "status": "done",
              "id3_tags_written": true,
              "generated_at": "2026-07-21T14:27:30Z"
            },
            {
              "id": "04-b1-llamarse-02",
              "es": "¿Cómo te llamas tú?",
              "ru": "Как тебя зовут?",
              "audio": {
                "es": "audio/es/04-b1-llamarse-02.mp3",
                "ru": "audio/ru/04-b1-llamarse-02.mp3"
              },
              "duration_ms": {
                "es": 1300,
                "ru": 1200
              },
              "status": "done",
              "id3_tags_written": true,
              "generated_at": "2026-07-21T14:27:45Z"
            }
          ]
        }
      ]
    },
    {
      "block_id": "b2",
      "type": "phrase_group",
      "title_ru": "Ходовые фразы",
      "groups": [
        {
          "key": "Первое знакомство",
          "order_index": 0,
          "phrases": [
            {
              "id": "04-b2-conocer-01",
              "es": "Mucho gusto, soy Victor.",
              "ru": "Очень приятно, я Виктор.",
              "audio": {
                "es": "audio/es/04-b2-conocer-01.mp3",
                "ru": "audio/ru/04-b2-conocer-01.mp3"
              },
              "duration_ms": {
                "es": 1500,
                "ru": 1400
              },
              "status": "done",
              "id3_tags_written": true,
              "generated_at": "2026-07-21T14:28:10Z"
            }
          ]
        }
      ]
    },
    {
      "block_id": "b3",
      "type": "vocabulary",
      "title_ru": "Ключевая лексика",
      "words": [
        {
          "id": "04-b3-vocab-01",
          "es": "el programador",
          "ru": "программист",
          "audio": {
            "es": "audio/es/04-b3-vocab-01.mp3",
            "ru": "audio/ru/04-b3-vocab-01.mp3"
          },
          "duration_ms": {
            "es": 800,
            "ru": 900
          },
          "status": "done",
          "id3_tags_written": true,
          "generated_at": "2026-07-21T14:28:30Z"
        }
      ]
    },
    {
      "block_id": "b4",
      "type": "story",
      "title_ru": "Короткий рассказ",
      "text_es": "Me llamo Victor y tengo cuarenta años. Soy programador y trabajo a distancia...",
      "text_ru": "Меня зовут Виктор, мне сорок лет. Я программист и работаю удалённо...",
      "audio": {
        "es": "audio/es/04-story.mp3",
        "ru": "audio/ru/04-story.mp3"
      },
      "duration_ms": {
        "es": 15000,
        "ru": 14800
      },
      "split_by_phrase": false,
      "status": "done",
      "id3_tags_written": true,
      "generated_at": "2026-07-21T14:29:00Z"
    }
  ]
}
```

---

## 7. ЭКСПОРТ И ХРАНЕНИЕ

### 7.1 Структура папок на диске

```
~/lessons/
├── 04-hablar-de-mi-mismo/
│   ├── lesson.json              # манифест
│   ├── generation.log           # логи процесса
│   └── audio/
│       ├── es/
│       │   ├── 04-b1-llamarse-01.mp3
│       │   ├── 04-b1-llamarse-02.mp3
│       │   ├── 04-b2-conocer-01.mp3
│       │   ├── 04-b3-vocab-01.mp3
│       │   └── 04-story.mp3
│       └── ru/
│           ├── 04-b1-llamarse-01.mp3
│           ├── 04-b1-llamarse-02.mp3
│           ├── 04-b2-conocer-01.mp3
│           ├── 04-b3-vocab-01.mp3
│           └── 04-story.mp3
│
└── 03-compras-en-la-tienda/
    ├── lesson.json
    └── audio/
        ├── es/ ...
        └── ru/ ...
```

### 7.2 ZIP архив для iOS

```
lesson-04-hablar-de-mi-mismo.zip
├── lesson.json
├── audio/
│   ├── es/
│   │   └── *.mp3
│   └── ru/
│       └── *.mp3
└── README.txt (опционально)
    Lesson ID: 04-hablar-de-mi-mismo
    Created: 2026-07-21
    Generator Version: 1.0.0
```

---

## 8. ГОРЯЧИЕ КЛАВИШИ И СОКРАЩЕНИЯ

| Сокращение | Действие |
|-----------|----------|
| `Cmd+O` | Открыть файл урока |
| `Cmd+V` | Вставить из буфера обмена |
| `Cmd+,` | Настройки |
| `Cmd+S` | Пересчитать стоимость |
| `Cmd+L` | Перейти в библиотеку |

---

## 9. ОБРАБОТКА ОШИБОК И ВОССТАНОВЛЕНИЕ

### 9.1 Сценарии отказа

| Сценарий | Обработка |
|----------|-----------|
| Нет интернета | Показать ошибку, предложить повторить |
| API-ключ неверный | Ошибка при первом запросе, возможность изменить |
| Rate limit (429) | Exponential backoff, автоматический retry |
| Timeout (>30s) | Retry с увеличенным timeout |
| Файл не найден | Ошибка, предложение пересоздать урок |
| Папка заполнена | Ошибка, предложение очистить / выбрать другую |
| Прерывание (Cmd+C) | Сохранить прогресс в JSON, возможность возобновить |

### 9.2 Восстановление после сбоя

```
При перезагрузке приложения:

if (lesson.json exists) {
  const items = lesson.json.blocks.flatMap(b => b.phrases)
    .filter(p => p.status !== 'done');
  
  if (items.length > 0) {
    showDialog("Найден незавершённый урок. Возобновить?");
    → Да: resume generation
    → Нет: reset JSON
  }
}
```

---

## 10. ТЕСТИРОВАНИЕ И QA

### 10.1 Unit тесты

- **Parser**: тестирование парсинга различных форматов (ошибки, edge cases)
- **ElevenLabs Service**: мокирование API, retry-логика
- **File Service**: создание/удаление папок, ID3-теги

### 10.2 Integration тесты

- Полный цикл: импорт → парсинг → генерация → экспорт
- Обработка ошибок (429, 500, timeout)
- Восстановление после прерывания

### 10.3 Реальное тестирование

- На Free API-ключе ElevenLabs (лимит ~10 запросов)
- На реальной теме (4 урок из спецификации)
- Проверка ID3-тегов в плеере (iTunes, Finder)
- Импорт ZIP на iOS

---

## 11. РАЗВЁРТЫВАНИЕ

### 11.1 Сборка

```bash
npm install
npm run build
npm run electron:build
# → Combine-1.0.0.dmg (macOS)
# → Combine-1.0.0.exe (Windows)
```

### 11.2 Первый запуск

1. Скачать Combine
2. Установить
3. При открытии → диалог "Введите API-ключ ElevenLabs"
4. Готово

### 11.3 Обновления

- Auto-updater через electron-updater
- Проверка при старте
- Скачивание и установка фоном

---

## 12. ПРОИЗВОДИТЕЛЬНОСТЬ

- **Генерация 81 фразы**: ~15-20 минут (зависит от API лимитов)
- **Генерация 50 тем**: ~6-8 часов (фоновая работа)
- **Размер лексики + рассказа**: ~5-10 МБ на тему
- **Параллельные запросы**: 3 (рекомендуется для Free тарифа)

---

## 13. ИЗВЕСТНЫЕ ОГРАНИЧЕНИЯ

1. **Текущий формат** требует точного соответствия разделителю `|`
2. **ID3-теги** поддерживаются только для MP3 (не для WAV)
3. **Кэширование** не отслеживает изменение параметров (если изменить голос, нужно пересоздавать)
4. **macOS only** (первая версия; Windows следует позже)

---

## 14. БУДУЩИЕ РАСШИРЕНИЯ (v2)

- Export в Anki (.apkg)
- SQLite индекс для полнотекстового поиска
- Клонирование голоса (требует Pro тариф)
- Пакетная генерация всех 50 тем
- Web интерфейс для браузера

---

**Конец спецификации Combine**
