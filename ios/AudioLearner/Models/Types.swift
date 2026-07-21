import Foundation

// MARK: - Phrase learning state

/// Состояние изучения фразы (см. спека §9.1).
enum PhraseState: String, CaseIterable, Codable, Identifiable {
    case learning
    case inProgress
    case mastered

    var id: String { rawValue }

    /// Русское название статуса для UI.
    var titleRu: String {
        switch self {
        case .learning: return "Учу"
        case .inProgress: return "В процессе"
        case .mastered: return "Выучено"
        }
    }

    /// SF Symbol для индикатора статуса.
    var systemImage: String {
        switch self {
        case .learning: return "circle.dashed"
        case .inProgress: return "circle.lefthalf.filled"
        case .mastered: return "checkmark.circle.fill"
        }
    }
}

// MARK: - Block types (mirror lesson.schema.json block.type)

enum LessonBlockType: String, Codable {
    case verbGroup = "verb_group"
    case phraseGroup = "phrase_group"
    case vocabulary
    case story

    /// Блоки, содержащие группы фраз.
    var hasGroups: Bool {
        self == .verbGroup || self == .phraseGroup
    }
}

// MARK: - Playback

/// Режим воспроизведения сессии (спека §5).
enum PlaybackMode: String, CaseIterable, Codable, Identifiable {
    case once      // Один раз
    case loopPhrase // Цикл фразы
    case cycleSession // Цикл сессии N раз

    var id: String { rawValue }

    var titleRu: String {
        switch self {
        case .once: return "Один раз"
        case .loopPhrase: return "Цикл фраз"
        case .cycleSession: return "Цикл сессии"
        }
    }
}

/// Режим показа текста на lock screen (спека §6.1).
enum LockScreenTextMode: String, CaseIterable, Codable, Identifiable {
    case both        // Оригинал + перевод
    case original    // Только оригинал
    case translation // Только перевод
    case hidden      // Скрыть

    var id: String { rawValue }

    var titleRu: String {
        switch self {
        case .both: return "Оригинал + перевод"
        case .original: return "Только оригинал"
        case .translation: return "Только перевод"
        case .hidden: return "Скрыть"
        }
    }
}

/// Язык фразы для одного элемента очереди.
enum PhraseLanguage: String, Codable {
    case es
    case ru
}

// MARK: - Appearance

enum ThemeStyle: String, CaseIterable, Codable, Identifiable {
    case light
    case dark
    case system

    var id: String { rawValue }

    var titleRu: String {
        switch self {
        case .light: return "Светлая"
        case .dark: return "Тёмная"
        case .system: return "По системе"
        }
    }
}

// MARK: - Import

/// Ошибки импорта ZIP-урока (спека §15.1).
enum ImportError: LocalizedError, Equatable {
    case cannotOpenArchive
    case missingJSON
    case invalidJSON(String)
    case unsupportedSchemaVersion(String)
    case missingAudioFile(String)
    case copyFailed(String)

    var errorDescription: String? {
        switch self {
        case .cannotOpenArchive:
            return "Не удалось открыть ZIP-архив."
        case .missingJSON:
            return "В архиве отсутствует файл lesson.json."
        case .invalidJSON(let detail):
            return "Не удалось разобрать lesson.json: \(detail)"
        case .unsupportedSchemaVersion(let version):
            return "Несовместимая версия формата урока: \(version)."
        case .missingAudioFile(let path):
            return "Отсутствует аудио-файл: \(path)"
        case .copyFailed(let detail):
            return "Ошибка копирования файлов: \(detail)"
        }
    }
}

/// Как разрешить конфликт при импорте существующего урока (спека §11.2).
enum ImportConflictResolution {
    case update   // Обновить: заменить аудио+тексты, сохранить прогресс фраз
    case replace  // Заменить: снести всё
    case cancel   // Отмена
}
