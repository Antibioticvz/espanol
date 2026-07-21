import Foundation
import Observation

/// Выбор фраз для сессии: дерево, фильтры, поиск, массовые операции (спека §4.4).
@MainActor
@Observable
final class PhraseSelectionViewModel {
    @ObservationIgnored let lesson: Lesson

    var selectedIds: Set<String>
    var searchText = ""
    var statusFilter: PhraseState?
    /// Фильтр по диапазону групп (1-10, 11-20, …); nil = все группы.
    var groupRangeFilter: ClosedRange<Int>?
    var expandedBlockIds: Set<String> = []
    var expandedGroupKeys: Set<String> = []

    /// Предвычисленные нижние регистры текста для быстрого поиска.
    @ObservationIgnored private var textCache: [String: (es: String, ru: String)] = [:]
    /// Глобальный 1-based индекс группы по ключу «blockId-key».
    @ObservationIgnored private var groupIndexByKey: [String: Int] = [:]

    init(lesson: Lesson, initialSelection: [String]) {
        self.lesson = lesson
        self.selectedIds = Set(initialSelection)
        // По умолчанию раскрываем все блоки и группы.
        self.expandedBlockIds = Set(lesson.orderedBlocks.map(\.blockId))
        var groupKeys: Set<String> = []
        var groupIndex = 0
        for block in lesson.orderedBlocks where block.blockTypeEnum?.hasGroups == true {
            for group in block.orderedGroups {
                groupIndex += 1
                let key = "\(block.blockId)-\(group.key)"
                groupKeys.insert(key)
                groupIndexByKey[key] = groupIndex
            }
        }
        self.expandedGroupKeys = groupKeys
        // Кэш нижнего регистра.
        for phrase in lesson.allLearnablePhrases {
            textCache[phrase.phraseId] = (phrase.textEs.lowercased(), phrase.textRu.lowercased())
        }
    }

    /// Доступные диапазоны групп для фильтра.
    var groupRanges: [ClosedRange<Int>] {
        let count = groupIndexByKey.count
        guard count > 1 else { return [] }
        var ranges: [ClosedRange<Int>] = []
        var start = 1
        while start <= count {
            ranges.append(start...min(start + 9, count))
            start += 10
        }
        return ranges
    }

    // MARK: - Filtering

    func matches(_ phrase: Phrase) -> Bool {
        if let statusFilter, phrase.stateEnum != statusFilter { return false }
        if let range = groupRangeFilter {
            guard let group = phrase.group,
                  let idx = groupIndexByKey["\(group.block.blockId)-\(group.key)"],
                  range.contains(idx) else { return false }
        }
        if !searchText.isEmpty {
            let q = searchText.lowercased()
            let cached = textCache[phrase.phraseId]
            let es = cached?.es ?? phrase.textEs.lowercased()
            let ru = cached?.ru ?? phrase.textRu.lowercased()
            if !es.contains(q) && !ru.contains(q) { return false }
        }
        return true
    }

    /// Блоки, содержащие обучаемые элементы (без story), для отображения.
    var learnableBlocks: [LessonBlock] {
        lesson.orderedBlocks.filter { $0.blockTypeEnum?.hasGroups == true || $0.blockTypeEnum == .vocabulary }
    }

    func visiblePhrases(in group: PhraseGroup) -> [Phrase] {
        group.orderedPhrases.filter(matches)
    }

    func visiblePhrases(in block: LessonBlock) -> [Phrase] {
        block.orderedPhrases.filter(matches)
    }

    /// Все видимые (после фильтра) фразы урока.
    var allVisiblePhrases: [Phrase] {
        lesson.allLearnablePhrases.filter(matches)
    }

    // MARK: - Selection

    var selectedCount: Int { selectedIds.count }
    var totalCount: Int { lesson.allLearnablePhrases.count }

    func isSelected(_ phrase: Phrase) -> Bool { selectedIds.contains(phrase.phraseId) }

    func toggle(_ phrase: Phrase) {
        if selectedIds.contains(phrase.phraseId) {
            selectedIds.remove(phrase.phraseId)
        } else {
            selectedIds.insert(phrase.phraseId)
        }
    }

    func selectAllVisible() {
        for phrase in allVisiblePhrases { selectedIds.insert(phrase.phraseId) }
    }

    func clearAll() {
        selectedIds.removeAll()
    }

    func invert() {
        let all = Set(lesson.allLearnablePhrases.map(\.phraseId))
        selectedIds = all.subtracting(selectedIds)
    }

    // MARK: - Expansion

    func toggleBlock(_ block: LessonBlock) {
        if expandedBlockIds.contains(block.blockId) { expandedBlockIds.remove(block.blockId) }
        else { expandedBlockIds.insert(block.blockId) }
    }

    func toggleGroup(_ group: PhraseGroup) {
        let key = "\(group.block.blockId)-\(group.key)"
        if expandedGroupKeys.contains(key) { expandedGroupKeys.remove(key) }
        else { expandedGroupKeys.insert(key) }
    }

    func isGroupExpanded(_ group: PhraseGroup) -> Bool {
        expandedGroupKeys.contains("\(group.block.blockId)-\(group.key)")
    }
}
