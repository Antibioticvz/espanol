import CoreData
import Foundation

/// Порядок подбора фраз в «Сессии дня» (v1.2, D-23).
enum DailySessionOrder: String, CaseIterable, Identifiable, Codable {
    case weakestFirst // сначала слабые (по срочности SRS), дефолт
    case shuffle      // случайный порядок

    var id: String { rawValue }
    var titleRu: String {
        switch self {
        case .weakestFirst: return "Сначала слабые"
        case .shuffle: return "Вперемешку"
        }
    }
}

/// Автосборка кросс-урочной «Сессии дня» из SRS-рекомендаций по всем урокам (спека v1.1 roadmap).
enum DailySession {
    static let defaultLimit = 30

    /// Кандидат на повтор с рангом срочности (чистые данные для сортировки/тестов).
    struct Candidate: Equatable {
        let phraseId: String
        let urgencyRank: Int
        let daysSince: Int
    }

    /// Чистый подбор: упорядочивает и обрезает по лимиту. «Сначала слабые» — по срочности,
    /// затем по давности; «вперемешку» — случайно.
    static func select(_ candidates: [Candidate], limit: Int, order: DailySessionOrder) -> [String] {
        let ordered: [Candidate]
        switch order {
        case .weakestFirst:
            ordered = candidates.sorted { a, b in
                if a.urgencyRank != b.urgencyRank { return a.urgencyRank < b.urgencyRank }
                return a.daysSince > b.daysSince
            }
        case .shuffle:
            ordered = candidates.shuffled()
        }
        return Array(ordered.prefix(max(0, limit)).map(\.phraseId))
    }

    /// Собирает фразы к повтору по всем урокам, приоритезирует и обрезает.
    @MainActor
    static func build(
        lessons: [Lesson],
        srs: SpacedRepeatService,
        limit: Int = defaultLimit,
        order: DailySessionOrder = .weakestFirst,
        now: Date = Date()
    ) -> [Phrase] {
        var candidates: [Candidate] = []
        var byId: [String: Phrase] = [:]
        let calendar = Calendar.current
        for lesson in lessons {
            for phrase in srs.recommendedPhrases(in: lesson, now: now) {
                let urgency = srs.urgency(for: phrase, now: now)
                let days = phrase.lastReviewDate
                    .map { calendar.dateComponents([.day], from: $0, to: now).day ?? 0 } ?? Int.max
                candidates.append(Candidate(phraseId: phrase.phraseId, urgencyRank: urgency.rank, daysSince: days))
                byId[phrase.phraseId] = phrase
            }
        }
        return select(candidates, limit: limit, order: order).compactMap { byId[$0] }
    }
}
