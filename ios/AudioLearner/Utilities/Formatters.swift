import Foundation

/// Утилиты форматирования для UI (русская локаль).
enum Format {
    static let russianLocale = Locale(identifier: "ru_RU")

    /// «8 мин 45 сек» / «45 сек».
    static func duration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded())
        let minutes = total / 60
        let secs = total % 60
        if minutes > 0 {
            return "\(minutes) мин \(secs) сек"
        }
        return "\(secs) сек"
    }

    /// «2.1 / 3.2 сек».
    static func timePair(_ elapsed: TimeInterval, _ duration: TimeInterval) -> String {
        String(format: "%.1f / %.1f сек", elapsed, duration)
    }

    /// «21 июля 2026».
    static func date(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = russianLocale
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    /// «21 июля 2026, 15:34».
    static func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = russianLocale
        formatter.dateStyle = .long
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// «50%».
    static func percent(_ value: Double) -> String {
        "\(Int((value * 100).rounded()))%"
    }

    /// Русское склонение: «1 фраза / 2 фразы / 5 фраз».
    static func phraseCount(_ count: Int) -> String {
        "\(count) \(pluralRu(count, one: "фраза", few: "фразы", many: "фраз"))"
    }

    static func dayCount(_ count: Int) -> String {
        "\(count) \(pluralRu(count, one: "день", few: "дня", many: "дней"))"
    }

    static func sessionCount(_ count: Int) -> String {
        "\(count) \(pluralRu(count, one: "сессия", few: "сессии", many: "сессий"))"
    }

    /// Выбор формы русского множественного числа.
    static func pluralRu(_ count: Int, one: String, few: String, many: String) -> String {
        let mod100 = abs(count) % 100
        let mod10 = abs(count) % 10
        if mod100 >= 11 && mod100 <= 14 { return many }
        switch mod10 {
        case 1: return one
        case 2, 3, 4: return few
        default: return many
        }
    }
}
