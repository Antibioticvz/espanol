import Foundation

/// Общие данные между приложением и виджетом через App Group (спека §7.2).
enum WidgetSharedStore {
    static let appGroupId = "group.com.victor.audiolearner"
    static let key = "todayStats"

    struct DailyStats: Codable {
        var date: Date
        var minutes: Int
        var sessions: Int
        var streak: Int

        static let empty = DailyStats(date: Date(), minutes: 0, sessions: 0, streak: 0)
    }

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    static func write(_ stats: DailyStats) {
        guard let defaults, let data = try? JSONEncoder().encode(stats) else { return }
        defaults.set(data, forKey: key)
    }

    static func read() -> DailyStats {
        guard let defaults,
              let data = defaults.data(forKey: key),
              let stats = try? JSONDecoder().decode(DailyStats.self, from: data) else {
            return .empty
        }
        return stats
    }
}
