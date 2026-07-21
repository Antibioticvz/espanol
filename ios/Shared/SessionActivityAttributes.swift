import ActivityKit
import Foundation

/// Атрибуты Live Activity активной аудио-сессии (v1.2, D-23).
/// Обновляется только на смене фразы (не по секундному прогрессу — батарея).
struct SessionActivityAttributes: ActivityAttributes {
    /// Динамическое состояние — текущая фраза и прогресс.
    struct ContentState: Codable, Hashable {
        /// Заголовок (первая сторона по режиму текста lock screen).
        var title: String
        /// Подзаголовок (вторая сторона либо пусто).
        var subtitle: String
        /// 1-based номер текущей фразы.
        var index: Int
        var total: Int
        var isPlaying: Bool
    }

    /// Статические атрибуты сессии.
    var lessonTitle: String
}
