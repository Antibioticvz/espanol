import Foundation
import Observation

/// Ключи UserDefaults (спека §13.1).
enum SettingsKeys {
    static let themeStyle = "themeStyle"
    static let fontScale = "fontScale"
    static let vibrationEnabled = "vibrationEnabled"
    static let soundEnabled = "soundEnabled"
    static let sessionCompleteVibration = "sessionCompleteVibration"
    static let defaultVolume = "defaultVolume"
    static let defaultPlaybackMode = "defaultPlaybackMode"
    static let autoNextPhrase = "autoNextPhrase"
    static let autoNextDelay = "autoNextDelay"
    static let lockScreenDisplay = "lockScreenDisplay"
    static let lastBackupDate = "lastBackupDate"
    // Дефолты сессии.
    static let defaultRepetitions = "defaultRepetitions"
    static let defaultSpeed = "defaultSpeed"
    static let defaultPauseSeconds = "defaultPauseSeconds"
    static let defaultTrackProgress = "defaultTrackProgress"
}

/// Наблюдаемое хранилище пользовательских предпочтений поверх UserDefaults.
@Observable
final class AppSettings {
    @ObservationIgnored private let defaults: UserDefaults

    var theme: ThemeStyle { didSet { defaults.set(theme.rawValue, forKey: SettingsKeys.themeStyle) } }
    var fontScale: Double { didSet { defaults.set(fontScale, forKey: SettingsKeys.fontScale) } }
    var vibrationEnabled: Bool { didSet { defaults.set(vibrationEnabled, forKey: SettingsKeys.vibrationEnabled) } }
    var soundEnabled: Bool { didSet { defaults.set(soundEnabled, forKey: SettingsKeys.soundEnabled) } }
    var sessionCompleteVibration: Bool { didSet { defaults.set(sessionCompleteVibration, forKey: SettingsKeys.sessionCompleteVibration) } }
    var defaultVolume: Double { didSet { defaults.set(defaultVolume, forKey: SettingsKeys.defaultVolume) } }
    var defaultPlaybackMode: PlaybackMode { didSet { defaults.set(defaultPlaybackMode.rawValue, forKey: SettingsKeys.defaultPlaybackMode) } }
    var autoNextPhrase: Bool { didSet { defaults.set(autoNextPhrase, forKey: SettingsKeys.autoNextPhrase) } }
    var autoNextDelay: Double { didSet { defaults.set(autoNextDelay, forKey: SettingsKeys.autoNextDelay) } }
    var lockScreenDisplay: LockScreenTextMode { didSet { defaults.set(lockScreenDisplay.rawValue, forKey: SettingsKeys.lockScreenDisplay) } }

    var defaultRepetitions: Int { didSet { defaults.set(defaultRepetitions, forKey: SettingsKeys.defaultRepetitions) } }
    var defaultSpeed: Double { didSet { defaults.set(defaultSpeed, forKey: SettingsKeys.defaultSpeed) } }
    var defaultPauseSeconds: Double { didSet { defaults.set(defaultPauseSeconds, forKey: SettingsKeys.defaultPauseSeconds) } }
    var defaultTrackProgress: Bool { didSet { defaults.set(defaultTrackProgress, forKey: SettingsKeys.defaultTrackProgress) } }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        theme = ThemeStyle(rawValue: defaults.string(forKey: SettingsKeys.themeStyle) ?? "") ?? .system
        fontScale = defaults.object(forKey: SettingsKeys.fontScale) as? Double ?? 1.0
        vibrationEnabled = defaults.object(forKey: SettingsKeys.vibrationEnabled) as? Bool ?? true
        soundEnabled = defaults.object(forKey: SettingsKeys.soundEnabled) as? Bool ?? true
        sessionCompleteVibration = defaults.object(forKey: SettingsKeys.sessionCompleteVibration) as? Bool ?? true
        defaultVolume = defaults.object(forKey: SettingsKeys.defaultVolume) as? Double ?? 0.8
        defaultPlaybackMode = PlaybackMode(rawValue: defaults.string(forKey: SettingsKeys.defaultPlaybackMode) ?? "") ?? .once
        autoNextPhrase = defaults.object(forKey: SettingsKeys.autoNextPhrase) as? Bool ?? true
        autoNextDelay = defaults.object(forKey: SettingsKeys.autoNextDelay) as? Double ?? 3
        lockScreenDisplay = LockScreenTextMode(rawValue: defaults.string(forKey: SettingsKeys.lockScreenDisplay) ?? "") ?? .both
        defaultRepetitions = defaults.object(forKey: SettingsKeys.defaultRepetitions) as? Int ?? 5
        defaultSpeed = defaults.object(forKey: SettingsKeys.defaultSpeed) as? Double ?? 1.0
        defaultPauseSeconds = defaults.object(forKey: SettingsKeys.defaultPauseSeconds) as? Double ?? 3
        defaultTrackProgress = defaults.object(forKey: SettingsKeys.defaultTrackProgress) as? Bool ?? true
    }

    /// Снимок настроек в виде словаря строк (для бэкапа).
    func snapshot() -> [String: String] {
        [
            SettingsKeys.themeStyle: theme.rawValue,
            SettingsKeys.fontScale: String(fontScale),
            SettingsKeys.defaultPlaybackMode: defaultPlaybackMode.rawValue,
            SettingsKeys.lockScreenDisplay: lockScreenDisplay.rawValue,
            SettingsKeys.defaultRepetitions: String(defaultRepetitions),
            SettingsKeys.defaultSpeed: String(defaultSpeed),
            SettingsKeys.defaultPauseSeconds: String(defaultPauseSeconds)
        ]
    }

    /// Конфиг сессии по умолчанию из настроек.
    func makeDefaultSessionConfig(phraseIds: [String]) -> SessionConfig {
        SessionConfig(
            phraseIds: phraseIds,
            repetitions: defaultRepetitions,
            speed: defaultSpeed,
            pauseSeconds: defaultPauseSeconds,
            playbackMode: defaultPlaybackMode,
            sessionCycles: 2,
            lockScreenTextMode: lockScreenDisplay,
            trackProgress: defaultTrackProgress
        )
    }
}
