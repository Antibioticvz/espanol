import WidgetKit
import SwiftUI

/// Home Screen виджет статистики дня (спека §7.2): минуты, сессии, streak.
struct StatisticsWidget: Widget {
    let kind = "AudioLearnerStatisticsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StatsProvider()) { entry in
            StatsWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Audio Learner")
        .description("Статистика обучения за сегодня")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct StatsEntry: TimelineEntry {
    let date: Date
    let stats: WidgetSharedStore.DailyStats
}

struct StatsProvider: TimelineProvider {
    func placeholder(in context: Context) -> StatsEntry {
        StatsEntry(date: Date(), stats: .init(date: Date(), minutes: 30, sessions: 2, streak: 5))
    }

    func getSnapshot(in context: Context, completion: @escaping (StatsEntry) -> Void) {
        completion(StatsEntry(date: Date(), stats: WidgetSharedStore.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StatsEntry>) -> Void) {
        let entry = StatsEntry(date: Date(), stats: WidgetSharedStore.read())
        // Обновляем через час (или по reloadAllTimelines из приложения).
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct StatsWidgetView: View {
    var entry: StatsEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family == .systemSmall {
            smallView
        } else {
            mediumView
        }
    }

    private var smallView: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Audio Learner", systemImage: "headphones")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer()
            metric(value: "\(entry.stats.minutes)", label: "минут сегодня")
            metric(value: "\(entry.stats.sessions)", label: "сессий")
            HStack(spacing: 4) {
                Text("🔥").font(.caption)
                Text("\(entry.stats.streak) дн").font(.caption.weight(.semibold))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var mediumView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                Label("Audio Learner", systemImage: "headphones")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("Сегодня").font(.headline)
                Text("\(entry.stats.minutes) минут · \(entry.stats.sessions) сессий")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(spacing: 4) {
                Text("🔥").font(.title)
                Text("\(entry.stats.streak)").font(.title.weight(.bold))
                Text("дней подряд").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private func metric(value: String, label: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(value).font(.title3.weight(.bold))
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}
