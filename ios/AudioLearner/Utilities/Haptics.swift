import UIKit

/// Тактильная отдача и системные звуки (спека §4.9 «Аудио»).
enum Haptics {
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium, enabled: Bool = true) {
        guard enabled else { return }
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.prepare()
        generator.impactOccurred()
    }

    static func success(enabled: Bool = true) {
        guard enabled else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func selection(enabled: Bool = true) {
        guard enabled else { return }
        UISelectionFeedbackGenerator().selectionChanged()
    }
}
