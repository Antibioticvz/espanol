import SwiftUI

/// Цветовая палитра приложения.
extension Color {
    static let stateLearning = Color.orange
    static let stateInProgress = Color.blue
    static let stateMastered = Color.green
}

extension PhraseState {
    var color: Color {
        switch self {
        case .learning: return .stateLearning
        case .inProgress: return .stateInProgress
        case .mastered: return .stateMastered
        }
    }
}

extension ReviewUrgency {
    var color: Color {
        switch self {
        case .urgent: return .red
        case .soon: return .yellow
        case .normal: return .green
        case .notDue: return .secondary
        }
    }

    var emoji: String {
        switch self {
        case .urgent: return "🔴"
        case .soon: return "🟡"
        case .normal: return "🟢"
        case .notDue: return "⚪️"
        }
    }
}

extension ThemeStyle {
    var colorScheme: ColorScheme? {
        switch self {
        case .light: return .light
        case .dark: return .dark
        case .system: return nil
        }
    }
}

/// Уровни интенсивности heatmap → цвет.
enum HeatmapPalette {
    static func color(for intensity: Int) -> Color {
        switch intensity {
        case 0: return Color.gray.opacity(0.15)
        case 1: return Color.green.opacity(0.35)
        case 2: return Color.green.opacity(0.6)
        default: return Color.green
        }
    }
}
