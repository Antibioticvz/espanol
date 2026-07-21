import CoreData
import Foundation

/// Общая логика завершения сессии (достижения, рекомендации, streak) для аудио- и
/// флеш-карт-режимов. Работает на главном акторе (использует @MainActor-окружение).
@MainActor
enum SessionCompletion {

    /// Проверяет и разблокирует достижения по всей истории сессий (спека §10.2).
    static func evaluateAchievements(env: AppEnvironment, now: Date) -> [Achievement] {
        let sessions = (try? env.viewContext.fetch(LearningSession.fetchRequest())) ?? []
        let completed = sessions.filter { $0.completedAt != nil }
        let atMaxSpeed = completed.filter { $0.speed >= 2.0 }.count
        let nightCount = completed.filter { session in
            guard let done = session.completedAt else { return false }
            let hour = Calendar.current.component(.hour, from: done)
            return hour >= 22 || hour < 4
        }.count
        let lessons = (try? env.repository.allLessons()) ?? []
        let anyMastered = lessons.contains { lesson in
            let total = lesson.allLearnablePhrases.count
            return total > 0 && lesson.allLearnablePhrases.allSatisfy { $0.stateEnum == .mastered }
        }
        let context = AchievementContext(
            completedSessions: completed.count,
            currentStreak: env.statistics.currentStreak(sessions: sessions, now: now),
            sessionsAtMaxSpeed: atMaxSpeed,
            nightSessions: nightCount,
            anyLessonFullyMastered: anyMastered
        )
        return env.achievements.evaluate(context: context)
    }

    /// Топ-3 рекомендации по повтору других уроков.
    static func buildRecommendations(env: AppEnvironment) -> [String] {
        let lessons = (try? env.repository.allLessons()) ?? []
        var result: [String] = []
        for lesson in lessons {
            let due = env.srs.recommendedPhrases(in: lesson).count
            if due > 0 {
                result.append("Повторите «\(lesson.titleRu)» — \(Format.phraseCount(due)) к повтору")
            }
        }
        return Array(result.prefix(3))
    }

    /// Обновляет агрегаты прогресса урока и streak после завершённой сессии.
    static func applyLessonProgress(
        env: AppEnvironment,
        lesson: Lesson,
        durationSeconds: Int,
        phrasesReviewed: Int,
        completedAt: Date
    ) {
        let progress = lesson.progress ?? LessonProgress(context: env.viewContext)
        progress.lesson = lesson
        env.repository.recomputeProgressCounters(progress, lesson: lesson)
        progress.totalSessionsCompleted += 1
        progress.totalMinutesLearned += Int64(durationSeconds / 60)
        progress.totalPhrasesReviewed += Int64(phrasesReviewed)
        progress.lastCompletedSessionAt = completedAt
        progress.lastAccessedAt = completedAt
        try? env.viewContext.save()

        let allSessions = (try? env.viewContext.fetch(LearningSession.fetchRequest())) ?? []
        let currentStreak = env.statistics.currentStreak(sessions: allSessions, now: completedAt)
        progress.streakDays = Int64(currentStreak)
        progress.bestStreakDays = max(progress.bestStreakDays, Int64(currentStreak))
        try? env.viewContext.save()
    }
}
