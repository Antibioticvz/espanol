import Foundation

/// Чистая логика колоды флеш-карт (v1.1, D-19) — без CoreData/UI, легко тестируется.
///
/// Правила: «Не знал» возвращает карту в конец колоды (повтор до «Знал»);
/// прогресс/счёт фраз не задваиваются на повторах; точность считается «с первого раза».
struct FlashcardSession {
    /// Оставшиеся карты (phraseId) по порядку; первая — текущая.
    private(set) var deck: [String]
    /// Всего уникальных карт (N).
    let totalCards: Int
    /// Сколько уникальных карт закрыто на «Знал» (X из N).
    private(set) var completedCount = 0
    /// Карты, по которым уже был ответ хотя бы раз (для «с первого раза»).
    private(set) var attempted: Set<String> = []
    /// Сколько карт угадано с первого показа.
    private(set) var knownFirstTry = 0

    init(phraseIds: [String]) {
        var seen = Set<String>()
        var ordered: [String] = []
        for id in phraseIds where !seen.contains(id) {
            seen.insert(id)
            ordered.append(id)
        }
        deck = ordered
        totalCards = ordered.count
    }

    var currentId: String? { deck.first }
    var isFinished: Bool { deck.isEmpty }
    var remainingCount: Int { deck.count }

    /// Точность «с первого раза»: угадано с первого показа / всего карт.
    var accuracy: Double {
        totalCards > 0 ? Double(knownFirstTry) / Double(totalCards) : 0
    }

    /// «Знал»: карта закрывается. Возвращает, был ли это первый показ карты.
    @discardableResult
    mutating func markKnown() -> Bool {
        guard let id = deck.first else { return false }
        let firstAttempt = !attempted.contains(id)
        if firstAttempt { knownFirstTry += 1 }
        attempted.insert(id)
        deck.removeFirst()
        completedCount += 1
        return firstAttempt
    }

    /// «Не знал»: карта уходит в конец колоды. Возвращает, был ли это первый показ.
    @discardableResult
    mutating func markUnknown() -> Bool {
        guard let id = deck.first else { return false }
        let firstAttempt = !attempted.contains(id)
        attempted.insert(id)
        deck.removeFirst()
        deck.append(id)
        return firstAttempt
    }
}
