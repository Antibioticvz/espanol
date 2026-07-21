import CoreData
import Foundation

/// Срочность повтора слова/фразы для раздела статистики (спека §4.8).
enum ReviewUrgency: String {
    case urgent   // 🔴 срочно
    case soon     // 🟡 скоро
    case normal   // 🟢 в норме
    case notDue   // не требует повтора

    var titleRu: String {
        switch self {
        case .urgent: return "Срочно"
        case .soon: return "Скоро"
        case .normal: return "В норме"
        case .notDue: return "Не требует повтора"
        }
    }

    /// Ранг для сортировки «сначала слабые» (меньше = приоритетнее).
    var rank: Int {
        switch self {
        case .urgent: return 0
        case .soon: return 1
        case .normal: return 2
        case .notDue: return 3
        }
    }
}

/// Простая модель интервального повторения без SM-2 (спека §9).
struct SpacedRepeatService {

    struct StateTransition: Equatable {
        let phraseId: String
        let oldState: PhraseState
        let newState: PhraseState
    }

    // Пороговые значения переходов состояний.
    static let inProgressThreshold = 3
    static let masteredThreshold = 8

    /// Чистое правило перехода состояния по числу повторений (границы 3/8).
    static func evaluateState(current: PhraseState, reviewCount: Int) -> PhraseState {
        switch current {
        case .learning:
            return reviewCount >= inProgressThreshold ? .inProgress : .learning
        case .inProgress:
            return reviewCount >= masteredThreshold ? .mastered : .inProgress
        case .mastered:
            return .mastered
        }
    }

    /// Регистрирует повтор фразы: увеличивает счётчик, ставит дату, при необходимости меняет state.
    /// - Parameter wasCorrect: правильный ли ответ (флеш-карты «Знал»/«Не знал»). При `false`
    ///   счётчик повторов растёт, но `correctCount` не увеличивается и state НЕ повышается.
    ///   Аудио-режимы вызывают со значением по умолчанию `true` (завершённый повтор = корректный).
    /// - Returns: переход состояния, если он произошёл (только при `wasCorrect == true`).
    @discardableResult
    func registerReview(_ phrase: Phrase, at date: Date = Date(), wasCorrect: Bool = true) -> StateTransition? {
        phrase.reviewCount += 1
        phrase.lastReviewDate = date

        // Статистика фразы.
        let stats = phrase.statistics ?? PhraseStatistics(context: phrase.managedObjectContext!)
        stats.phrase = phrase
        stats.totalReviewCount += 1
        stats.lastReviewedAt = date
        if wasCorrect { stats.correctCount += 1 }

        let old = phrase.stateEnum
        // Повышение state только при корректном ответе.
        let new = wasCorrect ? Self.evaluateState(current: old, reviewCount: Int(phrase.reviewCount)) : old
        // Следующая дата повтора (интервальная рекомендация).
        phrase.nextReviewDate = Self.nextReviewDate(for: new, from: date)
        guard new != old else { return nil }
        phrase.stateEnum = new
        return StateTransition(phraseId: phrase.phraseId, oldState: old, newState: new)
    }

    /// Рекомендованная дата следующего повтора по состоянию.
    static func nextReviewDate(for state: PhraseState, from date: Date) -> Date? {
        let calendar = Calendar.current
        switch state {
        case .learning: return calendar.date(byAdding: .day, value: 3, to: date)
        case .inProgress: return calendar.date(byAdding: .day, value: 7, to: date)
        case .mastered: return nil
        }
    }

    /// Требует ли фраза повтора по дате последнего повтора (спека §9.2).
    func isDue(_ phrase: Phrase, now: Date = Date()) -> Bool {
        guard let last = phrase.lastReviewDate else { return true } // новые
        let calendar = Calendar.current
        switch phrase.stateEnum {
        case .learning:
            let threshold = calendar.date(byAdding: .day, value: -3, to: now)!
            return last < threshold
        case .inProgress:
            let threshold = calendar.date(byAdding: .day, value: -7, to: now)!
            return last < threshold
        case .mastered:
            return false
        }
    }

    /// Фразы урока, требующие повтора.
    func recommendedPhrases(in lesson: Lesson, now: Date = Date()) -> [Phrase] {
        lesson.allLearnablePhrases.filter { isDue($0, now: now) }
    }

    /// Срочность повтора: по тому, насколько просрочена рекомендованная дата.
    func urgency(for phrase: Phrase, now: Date = Date()) -> ReviewUrgency {
        if phrase.stateEnum == .mastered { return .notDue }
        guard let last = phrase.lastReviewDate else { return .urgent } // новые — срочно
        let days = Calendar.current.dateComponents([.day], from: last, to: now).day ?? 0
        let dueInterval = phrase.stateEnum == .learning ? 3 : 7
        let overdue = days - dueInterval
        if overdue >= 5 { return .urgent }
        if overdue >= 0 { return .soon }
        return .normal
    }
}
