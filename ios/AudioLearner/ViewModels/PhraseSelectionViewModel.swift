import Foundation
import Observation

/// Выбор фраз для сессии: дерево, фильтры, поиск, массовые операции (спека §4.4).
@Observable
final class PhraseSelectionViewModel {
    @ObservationIgnored let lesson: Lesson

    var selectedIds: Set<String>
    var searchText = ""
    var statusFilter: PhraseState?
    var expandedBlockIds: Set<String> = []
    var expandedGroupKeys: Set<String> = []

    init(lesson: Lesson, initialSelection: [String]) {
        self.lesson = lesson
        self.selectedIds = Set(initialSelection)
        // По умолчанию раскрываем все блоки.
        self.expandedBlockIds = Set(lesson.orderedBlocks.map(\.blockId))
    }

    // MARK: - Filtering

    func matches(_ phrase: Phrase) -> Bool {
        if let statusFilter, phrase.stateEnum != statusFilter { return false }
        if !searchText.isEmpty {
            let q = searchText.lowercased()
            if !phrase.textEs.lowercased().contains(q) && !phrase.textRu.lowercased().contains(q) {
                return false
            }
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
