# ElevenLabs API Интеграция & Развёртывание

> ⚠️ **Историческое ТЗ.** Здесь есть фактические ошибки (заголовок `Authorization: Bearer` — на деле `xi-api-key`; вымышленные ID голосов; модель `eleven_flash_v2.5` — на деле `eleven_flash_v2_5`). Сверяйтесь с [DECISIONS.md](DECISIONS.md) (D-01…D-03) и официальной документацией ElevenLabs.

**Документ:** Детали интеграции с ElevenLabs, развёртывание, операционные процедуры  
**Версия:** 1.0  
**Дата:** 21 июля 2026

---

## 1. ELEVENLAB API ИНТЕГРАЦИЯ

### 1.1 Обзор ElevenLabs

**Сервис:** Text-to-Speech API (TTS)  
**Поддерживаемые языки:** 32+ (включая ES и RU)  
**Модели:**
- **Multilingual v2** — высокое качество, естественная просодия
- **Flash v2.5** — быстрый, дешевле, но менее полировано
- **Standard v1** (deprecated) — старая модель, не использовать

**Тарифы:**
- Free: 10 000 символов/месяц (rate limit ~10-20 req/min)
- Pay-as-you-go: $0.05–$0.10 за 1000 символов (в зависимости от модели)
- Starter ($6/месяц): $0.05–$0.10 за 1000 символов + фичи
- Creator ($99/месяц): включённые символы + голос клонирование
- Pro ($249/месяц): премиум функции + приоритет

**Выбор для проекта:** Pay-as-you-go (самый экономичный для этого объёма)

### 1.2 Голосы

**Для испанского (es-MX):**
```
ID       | Имя  | Пол | Регион | URL Preview
---------+------+-----+--------+------------------------------------------
"pablo"  | Pablo | M  | es-MX  | https://api.elevenlabs.io/voices/pablo
"diego"  | Diego | M  | es-MX  | https://api.elevenlabs.io/voices/diego
"maria"  | Maria | F  | es-MX  | https://api.elevenlabs.io/voices/maria
"sofia"  | Sofia | F  | es-MX  | https://api.elevenlabs.io/voices/sofia
```

**Для русского (ru-RU):**
```
ID         | Имя      | Пол | Регион | URL Preview
-----------+----------+-----+--------+-------------------------------------------
"masha"    | Masha    | F  | ru-RU  | https://api.elevenlabs.io/voices/masha
"sasha"    | Sasha    | M  | ru-RU  | https://api.elevenlabs.io/voices/sasha
"natasha"  | Natasha  | F  | ru-RU  | https://api.elevenlabs.io/voices/natasha
"aleksandr"| Aleksandr | M | ru-RU  | https://api.elevenlabs.io/voices/aleksandr
```

### 1.3 API Endpoints

**Text-to-Speech:**
```
POST /v1/text-to-speech/{voice_id}
Content-Type: application/json

Request Body:
{
  "text": "Me llamo Victor.",
  "model_id": "eleven_multilingual_v2",  // или eleven_flash_v2.5
  "voice_settings": {
    "stability": 0.5,                    // 0.0 - 1.0
    "similarity_boost": 0.75             // 0.0 - 1.0
  },
  "seed": null                            // null = random, число = fixed
}

Response:
audio/mpeg stream (MP3)
Size: ~18-30 KB (зависит от длины текста)
Duration: 1-5 сек
```

**Headers:**
```
Authorization: Bearer sk-XXXXXXXXXXXXXXXXXXXX
Content-Type: application/json
Accept: audio/mpeg
User-Agent: AudioLearner/1.0
```

**Rate Limits (по тарифу):**
```
Free: 10 req/min (жёсткий лимит)
Pay-as-you-go: 30-100 req/min (зависит от использования)
Starter+: 500 req/min

Обработка лимитов:
├─ 429 Too Many Requests → exponential backoff
├─ 401 Unauthorized → неверный API ключ
├─ 400 Bad Request → ошибка в параметрах
└─ 5xx Server Error → retry с backoff
```

### 1.4 Код интеграции (Node.js)

```typescript
// ElevenLabsService.ts
import axios, { AxiosError } from 'axios';
import * as fs from 'fs';
import { Readable } from 'stream';

interface TextToSpeechParams {
  text: string;
  voice_id: string;
  model_id: 'eleven_multilingual_v2' | 'eleven_flash_v2.5';
  stability?: number;
  similarity_boost?: number;
  seed?: number | null;
}

interface TTSResponse {
  audioBuffer: Buffer;
  durationMs: number;
}

class ElevenLabsService {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';
  private maxRetries = 3;
  private initialBackoffMs = 1000;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Генерирует аудио из текста
   */
  async textToSpeech(params: TextToSpeechParams): Promise<TTSResponse> {
    return this.retryWithBackoff(() => this.generateAudio(params));
  }

  /**
   * Основной вызов к API
   */
  private async generateAudio(params: TextToSpeechParams): Promise<TTSResponse> {
    const url = `${this.baseUrl}/text-to-speech/${params.voice_id}`;
    
    const payload = {
      text: params.text,
      model_id: params.model_id,
      voice_settings: {
        stability: params.stability ?? 0.5,
        similarity_boost: params.similarity_boost ?? 0.75
      },
      ...(params.seed !== undefined && { seed: params.seed })
    };

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        responseType: 'arraybuffer',
        timeout: 30000 // 30 сек
      });

      // Парсить длительность из заголовков (если доступна)
      const durationMs = this.estimateDurationMs(
        (response.data as Buffer).length,
        params.text
      );

      return {
        audioBuffer: response.data as Buffer,
        durationMs
      };
    } catch (error) {
      throw this.handleError(error as AxiosError);
    }
  }

  /**
   * Retry с exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        // Не retry для 401 (invalid key)
        if ((error as AxiosError).response?.status === 401) {
          throw error;
        }
        
        // Retry только для 429, 5xx
        if (![429, 500, 502, 503, 504].includes(
          (error as AxiosError).response?.status ?? 0
        )) {
          throw error;
        }

        // Exponential backoff
        const delayMs = this.initialBackoffMs * Math.pow(2, attempt);
        console.log(`Retry attempt ${attempt + 1}/${this.maxRetries} after ${delayMs}ms`);
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  /**
   * Оценка длительности аудио в мс
   */
  private estimateDurationMs(bufferSize: number, text: string): number {
    // Примерное значение: MP3 ~5.5 Kbps
    // Или по тексту: ~150 слов в минуту = 2.5 слова в сек
    const wordCount = text.split(/\s+/).length;
    const estimatedSecs = wordCount / 2.5; // 2.5 слова в сек
    return Math.round(estimatedSecs * 1000);
  }

  /**
   * Обработка ошибок API
   */
  private handleError(error: AxiosError): Error {
    if (error.response?.status === 401) {
      return new Error('Invalid API key');
    } else if (error.response?.status === 429) {
      return new Error('Rate limit exceeded');
    } else if (error.response?.status === 400) {
      return new Error(`Bad request: ${(error.response.data as any).error}`);
    } else if (error.response?.status && error.response.status >= 500) {
      return new Error('ElevenLabs server error');
    } else if (error.code === 'ECONNABORTED') {
      return new Error('Request timeout');
    } else {
      return new Error(`API error: ${error.message}`);
    }
  }

  /**
   * Тест подключения
   */
  async testConnection(): Promise<boolean> {
    try {
      // Простой запрос к API для проверки ключа
      await axios.get(`${this.baseUrl}/user`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        timeout: 5000
      });
      return true;
    } catch {
      return false;
    }
  }
}

export default ElevenLabsService;
```

### 1.5 Очередь генерации (с rate limiting)

```typescript
// GenerationQueue.ts
import PQueue from 'p-queue';

interface GenerationTask {
  phraseId: string;
  text: string;
  language: 'es' | 'ru';
  voiceId: string;
  onProgress?: (phraseId: string, status: 'pending' | 'generating' | 'done' | 'failed') => void;
}

class GenerationQueue {
  private queue: PQueue;
  private elevenLabsService: ElevenLabsService;
  private tasks: Map<string, GenerationTask> = new Map();

  constructor(
    elevenLabsService: ElevenLabsService,
    concurrency: number = 3,
    interval: number = 1000 // 1 сек interval
  ) {
    this.elevenLabsService = elevenLabsService;
    this.queue = new PQueue({
      concurrency,
      interval,
      intervalCap: concurrency // макс concurrency в interval
    });
  }

  /**
   * Добавить задачу в очередь
   */
  async addTask(
    task: GenerationTask,
    outputPath: string
  ): Promise<{ audioBuffer: Buffer; durationMs: number }> {
    this.tasks.set(task.phraseId, task);
    
    return this.queue.add(async () => {
      try {
        task.onProgress?.(task.phraseId, 'generating');

        const result = await this.elevenLabsService.textToSpeech({
          text: task.text,
          voice_id: task.voiceId,
          model_id: 'eleven_multilingual_v2',
          stability: 0.5,
          similarity_boost: 0.75
        });

        // Сохранить файл
        await fs.promises.writeFile(outputPath, result.audioBuffer);

        task.onProgress?.(task.phraseId, 'done');
        return result;
      } catch (error) {
        task.onProgress?.(task.phraseId, 'failed');
        throw error;
      }
    });
  }

  /**
   * Получить текущий размер очереди
   */
  getQueueSize(): number {
    return this.queue.size;
  }

  /**
   * Ожидать завершения всех задач
   */
  async waitForAll(): Promise<void> {
    await this.queue.onIdle();
  }

  /**
   * Очистить очередь
   */
  clear(): void {
    this.queue.clear();
    this.tasks.clear();
  }
}

export default GenerationQueue;
```

### 1.6 Обработка ошибок при генерации

```typescript
// GenerationService.ts
interface GenerationError {
  phraseId: string;
  language: 'es' | 'ru';
  code: 'rate_limit' | 'auth_failed' | 'invalid_text' | 'server_error' | 'timeout' | 'unknown';
  message: string;
  timestamp: Date;
  retryCount: number;
  nextRetryAt?: Date;
}

class ErrorHandler {
  private errors: Map<string, GenerationError[]> = new Map();

  recordError(error: GenerationError): void {
    const key = `${error.phraseId}_${error.language}`;
    if (!this.errors.has(key)) {
      this.errors.set(key, []);
    }
    this.errors.get(key)!.push(error);
  }

  getErrors(phraseId: string, language: 'es' | 'ru'): GenerationError[] {
    const key = `${phraseId}_${language}`;
    return this.errors.get(key) || [];
  }

  shouldRetry(phraseId: string, language: 'es' | 'ru'): boolean {
    const errors = this.getErrors(phraseId, language);
    if (errors.length === 0) return true;
    
    const lastError = errors[errors.length - 1];
    
    // Не retry 401 (auth failed)
    if (lastError.code === 'auth_failed') return false;
    
    // Не retry invalid_text
    if (lastError.code === 'invalid_text') return false;
    
    // Retry max 3 раза
    return lastError.retryCount < 3;
  }

  getRetryDelay(retryCount: number): number {
    // 1s, 2s, 4s
    return Math.pow(2, retryCount) * 1000;
  }
}

export default ErrorHandler;
```

---

## 2. РАЗВЁРТЫВАНИЕ COMBINE (DESKTOP)

### 2.1 Локальная разработка

**Требования:**
- Node.js 18+
- npm / yarn
- Electron 24+
- macOS 10.15+ или Windows 10+

**Установка:**

```bash
# Клонировать репо
git clone https://github.com/yourusername/aprender-espanol
cd aprender-espanol/combine

# Установить зависимости
npm install

# Запустить dev server (webpack + Electron)
npm run dev

# Или в двух терминалах:
# Terminal 1: npm run react-dev (React hot reload на порту 3000)
# Terminal 2: npm run electron-dev (Electron, автозагрузка при изменении)
```

**Структура npm scripts:**

```json
{
  "scripts": {
    "dev": "concurrently \"npm run react-dev\" \"npm run electron-dev\"",
    "react-dev": "react-scripts start",
    "electron-dev": "wait-on http://localhost:3000 && electron .",
    "build:react": "react-scripts build",
    "build:electron": "npm run build:react && electron-builder",
    "build": "npm run build:electron",
    "pack": "electron-builder --dir",
    "dist:mac": "npm run build && electron-builder --mac",
    "dist:win": "npm run build && electron-builder --win",
    "test": "jest",
    "lint": "eslint src"
  }
}
```

### 2.2 Сборка

**macOS:**

```bash
npm run dist:mac
# → Combine-1.0.0.dmg (в папке dist/)
# → Размер: ~150 МБ (Electron + dependencies)
```

**Windows:**

```bash
npm run dist:win
# → Combine-1.0.0.exe (installer)
# → Combine-1.0.0-portable.exe (portable)
```

**electron-builder.yml:**

```yaml
appId: "com.audiolearner.combine"
productName: "Combine"

directories:
  buildResources: "assets"
  output: "dist"

files:
  - "package.json"
  - "dist/main"
  - "dist/renderer"
  - "node_modules"

mac:
  target: ["dmg", "zip"]
  category: "public.app-category.education"
  icon: "assets/icon.icns"

win:
  target: ["nsis", "portable"]
  certificateFile: null  # Опционально для кодового подписи
  icon: "assets/icon.ico"

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  installerIcon: "assets/installer-icon.ico"
  uninstallerIcon: "assets/uninstaller-icon.ico"
```

### 2.3 Первый запуск

**Пользователь скачивает:** Combine-1.0.0.dmg

1. Распаковать DMG
2. Перетащить Combine.app в Applications
3. Открыть Combine
4. **Диалог:** "Введите ElevenLabs API Key"
   - `sk-XXXXXXXXXXXXXXXXXXXXX`
   - Кнопка "Сохранить в Keychain"
5. **Диалог:** "Выберите папку для уроков"
   - По умолчанию: `~/lessons`
   - Можно выбрать другую
6. **Готово:** Combine запущен, можно начинать генерировать

---

## 3. РАЗВЁРТЫВАНИЕ iOS

### 3.1 Требования разработки

```
macOS 12+
Xcode 14+ (может быть тяжело, ~25 ГБ)
iOS 15+ deployment target
Swift 5.9+
```

### 3.2 Подготовка проекта

**1. Создать проект Xcode:**

```bash
# Либо через Xcode GUI, либо:
xcodegen generate  # если используем XcodeGen

# Или просто:
# File → New → Project → iOS App
```

**2. Структура:**

```
AudioLearner/
├── AudioLearner.xcodeproj
├── AudioLearner.xcworkspace (если CocoaPods)
├── AudioLearner/
│   ├── App.swift (@main)
│   ├── ContentView.swift
│   ├── Models/
│   ├── ViewModels/
│   ├── Views/
│   ├── Services/
│   ├── Utilities/
│   └── Assets.xcassets
├── AudioLearnerTests/
├── AudioLearnerUITests/
└── Podfile (если используем CocoaPods)
```

**3. Signing & Capabilities (важно!):**

- Xcode → Targets → Signing & Capabilities
- Выбрать Team (ваш Apple ID)
- Bundle ID: `com.yourname.audiolearner`
- Включить capabilities:
  - [ ] Background Modes → Audio, AirPlay, and Picture in Picture
  - [ ] Nearby Interaction (опционально)

### 3.3 Установка на iOS устройство

**Вариант 1: Через USB**

```bash
# Подключить iPhone через USB
# Xcode → Product → Destination → выбрать устройство
# Product → Run (⌘R)
# Приложение установится и запустится на устройстве
```

**Вариант 2: Через TestFlight (будущее)**

```bash
# 1. Создать Apple Developer Account (~$99/год)
# 2. В Xcode: Signing & Capabilities → Team = Developer Team
# 3. Archive и upload на App Store Connect
# 4. Тестеры получат invite на TestFlight
```

### 3.4 Build settings

**Release Build:**

```bash
xcodebuild build-for-release \
  -scheme AudioLearner \
  -configuration Release \
  -derivedDataPath build
```

**Архивирование (для distribution):**

```bash
xcodebuild archive \
  -scheme AudioLearner \
  -configuration Release \
  -archivePath build/AudioLearner.xcarchive
```

---

## 4. ОПЕРАЦИОННЫЕ ПРОЦЕДУРЫ

### 4.1 Генерация новой темы (процедура)

**Каждую неделю / по необходимости:**

```
ШАГ 1: Подготовка текста
├─ Написать текст темы в формате #TOPIC / ##BLOCK / #WORD
├─ Валидировать формат (парсить locally)
└─ Готово

ШАГ 2: Генерация в Combine
├─ Открыть Combine
├─ Вставить текст
├─ Настроить: голоса (Pablo / Masha), модель (Multilingual v2)
├─ Нажать "Генерировать"
├─ Ждать ~15-20 мин (для 81 фразы)
└─ Готово: ~/lessons/04-hablar-de-mi-mismo/

ШАГ 3: Экспорт и передача на iOS
├─ Combine: нажать "Экспорт ZIP"
├─ Сохраняется: ~/Downloads/lesson-04.zip
├─ Передать на iPhone:
│  ├─ AirDrop (быстро, если рядом)
│  └─ или iCloud Drive (если настроена синхронизация)
└─ На iPhone открыть → Audio Learner импортирует

ШАГ 4: Проверка на iOS
├─ Открыть Audio Learner
├─ Урок появляется в списке
├─ Создать тестовую сессию (5 фраз, 1x скорость)
├─ Проверить воспроизведение
├─ Lock screen должен показывать текст
└─ Если всё ОК → готово к обучению
```

### 4.2 Мониторинг расходов (ElevenLabs)

**Еженедельно:**

```
1. Перейти на https://elevenlabs.io/account
2. Посмотреть "Usage This Month"
3. Ожидаемые расходы:
   ├─ 50 тем × 3750 сим × 2 языка × $0.10 / 1000
   ├─ = 375 000 сим × $0.10 / 1000
   ├─ = $37.50 за весь курс (один раз)
   └─ При обновлении: +$37.50

4. Если используется Flash:
   ├─ То же самое, но $0.05 за 1000
   ├─ = $18.75 за весь курс (в два раза дешевле)

5. Если расходы превышают бюджет:
   ├─ Использовать Flash вместо Multilingual v2
   ├─ Или сократить количество фраз в темах
```

### 4.3 Резервные копии (Combine)

**Еженедельно:**

```bash
# Скопировать папку уроков
cp -r ~/lessons ~/lessons_backup_$(date +%Y-%m-%d)

# Или использовать Time Machine (на macOS)
# Time Machine: обычно автоматически делает резервные копии

# Или облако (опционально):
# Sync ~/lessons с Google Drive, Dropbox, или iCloud Drive
```

### 4.4 Очистка дисков (iOS)

**Ежемесячно, если место заканчивается:**

```
На iPhone в Audio Learner:
1. Параметры → Данные и резервная копия
2. Посмотреть размер: "База: 450 МБ, Уроки: X МБ"
3. Если много неиспользуемых уроков:
   ├─ Уроки → долгий тап на урок → "Удалить"
   └─ Это не удалит прогресс, только файлы (могут пересбаланировать)
```

---

## 5. TROUBLESHOOTING

### 5.1 Combine (Desktop)

| Проблема | Решение |
|----------|---------|
| "Invalid API Key" | Проверить ключ в Keychain, переввести заново |
| "429 Too Many Requests" | Дождаться, пока лимит восстановится (обычно в течение часа) |
| "No space left on device" | Проверить ~/ свободное место, очистить другие файлы |
| Генерация зависла | Нажать "Отмена", потом "Возобновить" (продолжит с failed элементов) |
| JSON не парсится | Проверить формат текста, ищется разделитель ` | ` |
| Zip не создаётся | Проверить что папка ~/lessons/ существует и доступна |

### 5.2 iOS

| Проблема | Решение |
|----------|---------|
| ZIP не импортируется | Проверить что это правильный ZIP от Combine, валидировать структуру |
| Аудио не воспроизводится | Проверить что в Documents/ есть audio/ папки, перепроверить права доступа |
| App кращется при импорте | Больше памяти, закрыть другие приложения, перезагрузить iPhone |
| Lock screen не обновляется | Перезагрузить сессию, проверить настройки ("Показ текста на lock screen") |
| Прогресс потерян | Восстановить из резервной копии (Параметры → Данные) |
| CoreData ошибка | Очистить приложение (Settings → General → iPhone Storage → Audio Learner → Delete App), переустановить |

---

## 6. МОНИТОРИНГ И ЛОГИРОВАНИЕ

### 6.1 Combine (Desktop)

**Логирование:**

```
~/.audiolearner/
└── logs/
    ├── combine.log (основной лог)
    ├── generation_2026-07-21.log (лог генерации по дате)
    └── api_errors.log (ошибки API)
```

**Формат лога:**

```
[2026-07-21 14:27:30] INFO: Started generation for lesson 04
[2026-07-21 14:27:35] DEBUG: Generating phrase 04-b1-llamarse-01 (ES)
[2026-07-21 14:27:37] SUCCESS: 04-b1-llamarse-01 (ES) 1.2s
[2026-07-21 14:27:38] DEBUG: Generating phrase 04-b1-llamarse-01 (RU)
[2026-07-21 14:27:40] SUCCESS: 04-b1-llamarse-01 (RU) 1.1s
[2026-07-21 14:27:45] WARNING: Rate limited (429), retrying in 2s
[2026-07-21 14:27:48] SUCCESS: Retry successful
...
[2026-07-21 14:45:00] SUCCESS: Lesson 04 generated (81 phrases, 162 audio files)
[2026-07-21 14:45:05] INFO: Cost: $0.74 (actual) vs $0.75 (estimated)
```

### 6.2 iOS

**Логирование:**

```
Documents/AudioLearner/
└── logs/
    ├── app.log (основной лог)
    ├── import.log (логи импорта)
    ├── playback.log (логи воспроизведения)
    └── errors.log (ошибки)
```

**Просмотр логов:**

```swift
// На устройстве можно открыть Параметры → Audio Learner
// и просмотреть логи, или экспортировать
```

---

## 7. ВЕРСИОНИРОВАНИЕ И ОБНОВЛЕНИЯ

### 7.1 Version Scheme

**Combine:**
```
v1.0.0 = 2026-07-21 (Initial Release)
v1.0.1 = Bug fixes
v1.1.0 = New features (e.g., export to Anki)
v2.0.0 = Major redesign
```

**iOS:**
```
v1.0.0 = 2026-07-21 (Initial Release)
v1.0.1 = Bug fixes
v1.1.0 = Lock screen widget, flash card mode
v2.0.0 = Cloud sync, social features
```

### 7.2 Обновление Combine

**Процедура:**

```
1. Разработка в ветке `develop`
2. Тестирование локально
3. Merge в `main`
4. Tag: `v1.0.1`
5. Build: npm run dist:mac / dist:win
6. Upload на GitHub Releases
7. Пользователи получают уведомление об обновлении
   (через electron-updater)
```

### 7.3 Обновление iOS

**Процедура:**

```
1. Разработка в Xcode
2. Тестирование на устройстве
3. Увеличить version (Info.plist)
   ├─ Version: 1.0.1
   └─ Build: 2
4. Archive → eksportировать
5. Upload на TestFlight (если публиковать)
6. Или просто распространять через USB / iCloud
```

---

## 8. SECURITY CHECKLIST

### 8.1 Перед production (Combine)

- [ ] API ключ хранится в Keychain (не в памяти)
- [ ] Generated файлы не содержат чувствительных данных
- [ ] HTTPS только для API запросов к ElevenLabs
- [ ] Логи не содержат API ключ (редактирование необходимо)
- [ ] Error messages не раскрывают внутреннюю структуру

### 8.2 Перед distribution (iOS)

- [ ] App не требует аккаунтов / login
- [ ] Никаких аналитики (или прозрачное opt-in)
- [ ] CoreData хранится с эшифровкой iOS
- [ ] Нет трекинга пользователя
- [ ] Privacy policy понятная и честная

---

## 9. PERFORMANCE OPTIMIZATION

### 9.1 Combine (Desktop)

```
Текущие узкие места:
├─ Генерация (ограничено rate limit ElevenLabs)
├─ Архивирование (может быть медленным на HDD)
└─ UI обновления (React батчинг)

Оптимизация:
├─ Использовать SSD (для хранилища)
├─ Параллельные запросы: 3–5 (в зависимости от тарифа)
├─ React.memo для компонентов
└─ Виртуализация списков (если много уроков)
```

### 9.2 iOS

```
Текущие узкие места:
├─ Распаковка ZIP (медленно на старых устройствах)
├─ CoreData индексирование (при большом объёме)
└─ Воспроизведение аудио (OK, оптимизировано)

Оптимизация:
├─ Асинхронная распаковка (не блокирует UI)
├─ Батчинг CoreData операций
├─ Ленивая загрузка фраз (не все сразу в памяти)
└─ Кэширование метаданных (дурация, размер)
```

---

## 10. DISASTER RECOVERY

### 10.1 Потеря данных на Desktop

```
Сценарий: Папка ~/lessons/ удалена случайно

Восстановление:
1. Time Machine restore (macOS) → вернуть папку
2. Или Google Drive sync → вернуть из облака
3. Если нет backup → переделать генерацию (ещё раз запустить)
   (JSON сохранен в Combine, можно пересоздать)
```

### 10.2 Потеря данных на iOS

```
Сценарий: Приложение сбилось, CoreData повреждена

Восстановление:
1. Резервная копия в Documents/AudioLearner/backups/
   ├─ Если есть backup from today → восстановить
   └─ Если старая → потерять день-два прогресса

2. Если backup не поможет:
   ├─ Удалить приложение
   ├─ Переустановить
   ├─ Переимпортировать уроки (аудио восстановятся)
   └─ Прогресс потеряется (новый старт)

3. Предотвращение:
   └─ Автоматические резервные копии (daily в корзину)
```

---

## CHECKLIST: ГОТОВНОСТЬ К ЗАПУСКУ

### До first use

- [ ] Combine установлена и работает
- [ ] ElevenLabs API ключ добавлен и проверен
- [ ] Первая тема сгенерирована успешно
- [ ] ZIP экспортирован
- [ ] iOS приложение установлено на iPhone
- [ ] ZIP успешно импортирован на iPhone
- [ ] Сессия создана и воспроизведена
- [ ] Lock screen интеграция работает
- [ ] Статистика обновляется

### Каждую неделю

- [ ] Проверить расходы ElevenLabs
- [ ] Создать резервную копию ~/lessons/
- [ ] Проверить логи на ошибки

### Каждый месяц

- [ ] Анализ использования (сессии, прогресс)
- [ ] Очистка дисков iOS (если много мусора)
- [ ] Проверка на обновления iOS / Xcode

---

**Конец документа "ElevenLabs API & Развёртывание"**
