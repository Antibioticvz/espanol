import XCTest
@testable import AudioLearner

/// Выбор фраз: инициализация из урока, раскрытие групп, диапазоны, поиск.
@MainActor
final class PhraseSelectionViewModelTests: AudioLearnerTestCase {

    func testInitFromLessonExpandsGroupsAndSelection() throws {
        let lesson = try importFixture()
        let vm = PhraseSelectionViewModel(
            lesson: lesson,
            initialSelection: lesson.allLearnablePhrases.map(\.phraseId)
        )

        XCTAssertEqual(vm.totalCount, 13)
        XCTAssertEqual(vm.selectedCount, 13)

        // Блоки и группы раскрыты по умолчанию.
        XCTAssertFalse(vm.expandedGroupKeys.isEmpty)
        let firstGroup = try XCTUnwrap(
            lesson.orderedBlocks.first { $0.blockTypeEnum == .verbGroup }?.orderedGroups.first
        )
        XCTAssertTrue(vm.isGroupExpanded(firstGroup))
    }

    /// Прокси для CRITICAL 2: VM всегда отражает дерево ИМЕННО переданного урока.
    func testTreeMatchesGivenLesson() throws {
        let lesson = try importFixture()
        let vm = PhraseSelectionViewModel(lesson: lesson, initialSelection: [])
        XCTAssertEqual(Set(vm.allVisiblePhrases.map(\.phraseId)).count, 13)
        XCTAssertEqual(vm.learnableBlocks.map(\.type), ["verb_group", "phrase_group", "vocabulary"])
    }

    func testSearchUsesLowercasedCache() throws {
        let lesson = try importFixture()
        let vm = PhraseSelectionViewModel(lesson: lesson, initialSelection: [])
        vm.searchText = "VICTOR" // регистронезависимо
        XCTAssertTrue(vm.allVisiblePhrases.contains { $0.phraseId == "04-b1-llamarse-01" })

        vm.searchText = "нет-такого-текста"
        XCTAssertTrue(vm.allVisiblePhrases.isEmpty)
    }

    func testStatusFilter() throws {
        let lesson = try importFixture()
        let vm = PhraseSelectionViewModel(lesson: lesson, initialSelection: [])
        vm.statusFilter = .mastered
        XCTAssertTrue(vm.allVisiblePhrases.isEmpty, "изначально ничего не выучено")
        vm.statusFilter = .learning
        XCTAssertEqual(vm.allVisiblePhrases.count, 13)
    }

    func testGroupRangeFilter() throws {
        // Фикстура: 4 группы (llamarse, tener, conocer, trabajo) → один диапазон 1-4.
        let lesson = try importFixture()
        let vm = PhraseSelectionViewModel(lesson: lesson, initialSelection: [])
        XCTAssertEqual(vm.groupRanges, [1...4])

        // Диапазон 1...2 (llamarse+tener из b1) → только фразы b1 (5 штук), без словаря.
        vm.groupRangeFilter = 1...2
        let ids = Set(vm.allVisiblePhrases.map(\.phraseId))
        XCTAssertTrue(ids.allSatisfy { $0.hasPrefix("04-b1-") })
        XCTAssertEqual(ids.count, 5)
    }

    func testInvertAndClear() throws {
        let lesson = try importFixture()
        let vm = PhraseSelectionViewModel(lesson: lesson, initialSelection: [])
        vm.selectAllVisible()
        XCTAssertEqual(vm.selectedCount, 13)
        vm.invert()
        XCTAssertEqual(vm.selectedCount, 0)
        vm.invert()
        XCTAssertEqual(vm.selectedCount, 13)
        vm.clearAll()
        XCTAssertEqual(vm.selectedCount, 0)
    }
}
