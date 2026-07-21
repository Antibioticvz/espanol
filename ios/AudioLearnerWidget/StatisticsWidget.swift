import WidgetKit
import SwiftUI
import AppIntents

/// Виджет статистики дня (спека §7.2): минуты, сессии, streak.
/// Поддерживает Home Screen (small/medium) и lock-screen accessory (D-18).
struct StatisticsWidget: Widget {
    let kind = "AudioLearnerStatisticsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StatsProvider()) { entry in
            StatsWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Audio Learner")
        .description("Статистика обучения за сегодня")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
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
        let now = Date()
        let stats = WidgetSharedStore.read()
        var entries = [StatsEntry(date: now, stats: stats)]

        // Вторая запись на начало следующего дня с нулями: после полуночи «Сегодня»
        // не должно показывать вчерашние минуты, пока приложение не обновит данные.
        let calendar = Calendar.current
        if let nextMidnight = calendar.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0),
                                                matchingPolicy: .nextTime) {
            entries.append(StatsEntry(
                date: nextMidnight,
                stats: .init(date: nextMidnight, minutes: 0, sessions: 0, streak: stats.streak)
            ))
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct StatsWidgetView: View {
    var entry: StatsEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .systemSmall: smallView
        case .accessoryCircular: circularView
        case .accessoryRectangular: rectangularView
        case .accessoryInline: inlineView
        default: mediumView
        }
    }

    private var s: WidgetSharedStore.DailyStats { entry.stats }

    private var smallView: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Audio Learner", systemImage: "headphones")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer()
            metric(value: "\(s.minutes)", label: Format.pluralRu(s.minutes, one: "минута", few: "минуты", many: "минут"))
            metric(value: "\(s.sessions)", label: Format.pluralRu(s.sessions, one: "сессия", few: "сессии", many: "сессий"))
            HStack(spacing: 4) {
                Text("🔥").font(.caption)
                Text(Format.dayCount(s.streak)).font(.caption.weight(.semibold))
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
                Text("\(Format.minuteCount(s.minutes)) · \(Format.sessionCount(s.sessions))")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button(intent: StartDailySessionIntent()) {
                    Label("Сессия дня", systemImage: "play.fill").font(.caption.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(.accentColor)
            }
            Spacer()
            VStack(spacing: 4) {
                Text("🔥").font(.title)
                Text("\(s.streak)").font(.title.weight(.bold))
                Text("подряд").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var circularView: some View {
        VStack(spacing: 0) {
            Text("🔥").font(.caption2)
            Text("\(s.streak)").font(.headline)
            Text("дн").font(.system(size: 9))
        }
    }

    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Audio Learner").font(.caption2.weight(.semibold))
            Text("\(Format.minuteCount(s.minutes)) · \(Format.sessionCount(s.sessions))").font(.caption2)
            Text("🔥 \(Format.dayCount(s.streak))").font(.caption2)
        }
    }

    private var inlineView: some View {
        Text("🔥 \(Format.dayCount(s.streak)) · \(Format.minuteCount(s.minutes))")
    }

    private func metric(value: String, label: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(value).font(.title3.weight(.bold))
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}
