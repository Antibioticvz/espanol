import SwiftUI

/// Экран 6: статистика (спека §4.8).
struct StatisticsView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var vm: StatisticsViewModel?
    @State private var exportURL: URL?
    @State private var showShare = false

    var body: some View {
        NavigationStack {
            Group {
                if let vm {
                    content(vm)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Статистика")
        }
        .task { if vm == nil { vm = StatisticsViewModel(env: env) } }
    }

    private func content(_ vm: StatisticsViewModel) -> some View {
        @Bindable var vm = vm
        return List {
            Section {
                Picker("Период", selection: $vm.period) {
                    ForEach(StatsPeriod.allCases) { Text($0.titleRu).tag($0) }
                }
                .pickerStyle(.segmented)
            }

            summarySection(vm)
            streakSection(vm)
            heatmapSection(vm)
            lessonsSection(vm)
            dueWordsSection(vm)

            Section {
                Button {
                    exportURL = vm.exportCSV()
                    if exportURL != nil { showShare = true }
                } label: {
                    Label("Экспортировать CSV", systemImage: "square.and.arrow.up")
                }
            }
        }
        .sheet(isPresented: $showShare) {
            if let exportURL {
                ShareLink(item: exportURL) { Text("Поделиться CSV") }
                    .presentationDetents([.medium])
            }
        }
    }

    private func summarySection(_ vm: StatisticsViewModel) -> some View {
        let s = vm.summary
        return Section("Общие показатели") {
            statRow("Сессий завершено", String(s.completedSessions))
            statRow("Всего минут", String(s.totalMinutes))
            statRow("Средняя сессия", "\(s.averageSessionMinutes) мин")
        }
    }

    private func streakSection(_ vm: StatisticsViewModel) -> some View {
        let s = vm.summary
        return Section("Полоса активности") {
            statRow("🔥 Текущая полоса", Format.dayCount(s.currentStreak))
            statRow("🏆 Лучшая полоса", Format.dayCount(s.bestStreak))
        }
    }

    private func heatmapSection(_ vm: StatisticsViewModel) -> some View {
        Section("Календарь активности") {
            CalendarHeatmapView(activities: vm.heatmap)
                .padding(.vertical, 4)
        }
    }

    private func lessonsSection(_ vm: StatisticsViewModel) -> some View {
        Section("По урокам") {
            if vm.lessonRows.isEmpty {
                Text("Нет данных").foregroundStyle(.secondary)
            }
            ForEach(vm.lessonRows) { row in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(row.title).font(.subheadline.weight(.medium))
                        Spacer()
                        Text(Format.percent(row.percent)).font(.caption).foregroundStyle(.secondary)
                    }
                    ProgressBarView(value: row.percent, height: 6)
                    Text("Выучено: \(row.mastered) / \(row.total) · Сессий: \(row.sessions)")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func dueWordsSection(_ vm: StatisticsViewModel) -> some View {
        let words = vm.dueWords()
        return Section("Слова к повтору") {
            if words.isEmpty {
                Text("Всё повторено — отлично!").foregroundStyle(.secondary)
            }
            ForEach(words.prefix(20)) { word in
                HStack(alignment: .top) {
                    Text(word.urgency.emoji)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(word.textEs).font(.subheadline)
                        Text(word.textRu).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if word.daysSince >= 0 {
                        Text("\(word.daysSince) дн").font(.caption2).foregroundStyle(.secondary)
                    } else {
                        Text("новое").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func statRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).fontWeight(.semibold)
        }
    }
}

/// Календарь-heatmap: недели по столбцам, дни недели по строкам.
struct CalendarHeatmapView: View {
    var activities: [DayActivity]
    private let weeks = 12

    private var intensityByDay: [Date: Int] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 2
        var map: [Date: Int] = [:]
        for activity in activities {
            map[calendar.startOfDay(for: activity.day)] = activity.intensity
        }
        return map
    }

    var body: some View {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 2
        let today = calendar.startOfDay(for: Date())
        let map = intensityByDay

        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 3) {
                ForEach(0..<weeks, id: \.self) { weekOffset in
                    VStack(spacing: 3) {
                        ForEach(0..<7, id: \.self) { weekday in
                            let daysBack = (weeks - 1 - weekOffset) * 7 + (6 - weekday)
                            let day = calendar.date(byAdding: .day, value: -daysBack, to: today)!
                            let intensity = map[calendar.startOfDay(for: day)] ?? 0
                            RoundedRectangle(cornerRadius: 2)
                                .fill(HeatmapPalette.color(for: intensity))
                                .frame(width: 14, height: 14)
                        }
                    }
                }
            }
            HStack(spacing: 4) {
                Text("Меньше").font(.caption2).foregroundStyle(.secondary)
                ForEach(0..<4, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(HeatmapPalette.color(for: i))
                        .frame(width: 10, height: 10)
                }
                Text("Больше").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}
