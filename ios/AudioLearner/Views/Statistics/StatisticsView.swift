import CoreData
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
            .onReceive(NotificationCenter.default.publisher(for: .NSManagedObjectContextDidSave)) { _ in
                vm?.reload()
            }
        }
        .task {
            if vm == nil { vm = StatisticsViewModel(env: env) }
            vm?.reload()
        }
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
            if let exportURL { ShareSheet(items: [exportURL]) }
        }
    }

    private func summarySection(_ vm: StatisticsViewModel) -> some View {
        let s = vm.summary
        return Section("Общие показатели") {
            statRow("Сессий завершено", String(s.completedSessions))
            statRow("Всего часов обучения", Format.hoursLearned(seconds: vm.totalSeconds))
            statRow("Средняя сессия", Format.minuteCount(s.averageSessionMinutes))
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
                    Text("Выучено: \(row.mastered) / \(row.total) · \(Format.sessionCount(row.sessions))")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func dueWordsSection(_ vm: StatisticsViewModel) -> some View {
        Section("Слова к повтору") {
            if vm.dueWords.isEmpty {
                Text("Всё повторено — отлично!").foregroundStyle(.secondary)
            }
            ForEach(vm.dueWords.prefix(20)) { word in
                HStack(alignment: .top) {
                    Text(word.urgency.emoji)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(word.textEs).font(.subheadline)
                        Text(word.textRu).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(word.daysSince >= 0 ? Format.dayCount(word.daysSince) : "новое")
                        .font(.caption2).foregroundStyle(.secondary)
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

/// Календарь-heatmap: строки = дни недели Пн–Вс с подписями, столбцы = недели (спека §4.8).
struct CalendarHeatmapView: View {
    var activities: [DayActivity]
    private let weeks = 12
    private let dayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    private let cellSize: CGFloat = 14
    private let spacing: CGFloat = 3

    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.firstWeekday = 2 // понедельник
        return c
    }

    private var intensityByDay: [Date: Int] {
        var map: [Date: Int] = [:]
        for activity in activities {
            map[calendar.startOfDay(for: activity.day)] = activity.intensity
        }
        return map
    }

    var body: some View {
        let cal = calendar
        let today = cal.startOfDay(for: Date())
        let thisWeekStart = cal.dateInterval(of: .weekOfYear, for: today)?.start ?? today
        let startMonday = cal.date(byAdding: .day, value: -(weeks - 1) * 7, to: thisWeekStart) ?? today
        let map = intensityByDay

        return VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: spacing) {
                    // Подписи дней недели слева.
                    VStack(spacing: spacing) {
                        ForEach(0..<7, id: \.self) { r in
                            Text(dayLabels[r])
                                .font(.system(size: 9))
                                .foregroundStyle(.secondary)
                                .frame(width: 22, height: cellSize, alignment: .leading)
                        }
                    }
                    // Столбцы-недели.
                    ForEach(0..<weeks, id: \.self) { c in
                        VStack(spacing: spacing) {
                            ForEach(0..<7, id: \.self) { r in
                                cell(startMonday: startMonday, week: c, weekday: r, today: today, map: map, cal: cal)
                            }
                        }
                    }
                }
            }
            // Легенда.
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

    @ViewBuilder
    private func cell(startMonday: Date, week: Int, weekday: Int, today: Date, map: [Date: Int], cal: Calendar) -> some View {
        let date = cal.date(byAdding: .day, value: week * 7 + weekday, to: startMonday) ?? startMonday
        if date > today {
            Color.clear.frame(width: cellSize, height: cellSize) // будущие дни — пусто
        } else {
            RoundedRectangle(cornerRadius: 2)
                .fill(HeatmapPalette.color(for: map[cal.startOfDay(for: date)] ?? 0))
                .frame(width: cellSize, height: cellSize)
        }
    }
}
