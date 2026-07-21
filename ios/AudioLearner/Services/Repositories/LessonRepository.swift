import CoreData
import Foundation

/// CRUD поверх CoreData и индексация импортированных уроков (спека §3, §11).
final class LessonRepository {
    let context: NSManagedObjectContext

    init(context: NSManagedObjectContext) {
        self.context = context
    }

    // MARK: - Fetch

    func allLessons() throws -> [Lesson] {
        let request = Lesson.fetchRequest()
        request.sortDescriptors = [NSSortDescriptor(key: "topicNumber", ascending: true)]
        return try context.fetch(request)
    }

    func lesson(topicId: String) throws -> Lesson? {
        let request = Lesson.fetchRequest()
        request.predicate = NSPredicate(format: "topicId == %@", topicId)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }

    func phrase(phraseId: String) throws -> Phrase? {
        let request = Phrase.fetchRequest()
        request.predicate = NSPredicate(format: "phraseId == %@", phraseId)
        request.fetchLimit = 1
        return try context.fetch(request).first
    }

    // MARK: - Mutations

    func rename(_ lesson: Lesson, to newTitle: String) throws {
        lesson.titleRu = newTitle
        try context.save()
    }

    /// Полностью удаляет урок из CoreData и его файлы с диска.
    func delete(_ lesson: Lesson) throws {
        let topicId = lesson.topicId
        context.delete(lesson)
        try context.save()
        let dir = AppPaths.lessonsDirectory.appendingPathComponent(topicId, isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
    }

    // MARK: - Indexing

    /// Снимок прогресса фразы для сохранения при обновлении урока.
    private struct PhraseProgressSnapshot {
        let state: String
        let reviewCount: Int64
        let lastReviewDate: Date?
        let nextReviewDate: Date?
        let easeFactor: Double
        let interval: Int64
        let isFavorite: Bool
    }

    /// Индексирует урок из манифеста, беря аудио из `sourceRoot`.
    /// Файлы уже должны быть скопированы в Documents/AudioLearner/lessons/<topicId>.
    /// - Parameters:
    ///   - preservingStates: если true и урок существует, состояние фраз сохраняется по phraseId (режим «Обновить»).
    @discardableResult
    func index(
        manifest: LessonManifest,
        existing: Lesson?,
        preservingStates: Bool
    ) throws -> Lesson {
        var snapshots: [String: PhraseProgressSnapshot] = [:]
        let lesson: Lesson

        if let existing {
            if preservingStates {
                for phrase in existing.phrasesRel {
                    snapshots[phrase.phraseId] = PhraseProgressSnapshot(
                        state: phrase.state,
                        reviewCount: phrase.reviewCount,
                        lastReviewDate: phrase.lastReviewDate,
                        nextReviewDate: phrase.nextReviewDate,
                        easeFactor: phrase.easeFactor,
                        interval: phrase.interval,
                        isFavorite: phrase.isFavorite
                    )
                }
                clearContent(of: existing)
                lesson = existing
            } else {
                // Замена: сносим всё и создаём заново.
                context.delete(existing)
                lesson = Lesson(context: context)
            }
        } else {
            lesson = Lesson(context: context)
        }

        // Скалярные поля урока.
        lesson.topicId = manifest.topicId
        lesson.topicNumber = Int64(manifest.topicNumber)
        lesson.titleRu = manifest.titleRu
        lesson.titleEs = manifest.titleEs
        lesson.createdAt = manifest.createdAt
        lesson.importedAt = Date()
        lesson.generatorVersion = manifest.generatorVersion
        lesson.schemaVersion = manifest.schemaVersion
        lesson.phraseCount = Int64(manifest.stats.phraseCount)
        lesson.vocabCount = Int64(manifest.stats.vocabCount)
        lesson.storyCount = Int64(manifest.stats.storyCount)
        lesson.characterCountEs = Int64(manifest.stats.charactersEs)
        lesson.characterCountRu = Int64(manifest.stats.charactersRu)

        var globalPhraseIndex: Int64 = 0

        for (blockIdx, mBlock) in manifest.blocks.enumerated() {
            let block = LessonBlock(context: context)
            block.blockId = mBlock.blockId
            block.type = mBlock.type
            block.titleRu = mBlock.titleRu
            block.titleEs = mBlock.titleEs
            block.orderIndex = Int64(mBlock.orderIndex)
            block.lesson = lesson
            block.textEs = mBlock.textEs
            block.textRu = mBlock.textRu
            block.splitByPhrase = mBlock.splitByPhrase ?? false

            switch mBlock.blockType {
            case .verbGroup, .phraseGroup:
                for (groupIdx, mGroup) in (mBlock.groups ?? []).enumerated() {
                    let group = PhraseGroup(context: context)
                    group.key = mGroup.key
                    group.titleRu = mGroup.titleRu
                    group.translationRu = mGroup.translationRu
                    group.orderIndex = Int64(mGroup.orderIndex == 0 ? groupIdx : mGroup.orderIndex)
                    group.block = block
                    for mPhrase in mGroup.phrases {
                        let phrase = makePhrase(mPhrase, lesson: lesson, orderIndex: globalPhraseIndex, snapshots: snapshots)
                        phrase.group = group
                        phrase.block = block
                        globalPhraseIndex += 1
                        attachAudio(mPhrase, to: phrase, lesson: lesson)
                    }
                }
            case .vocabulary:
                for mWord in mBlock.words ?? [] {
                    let phrase = makePhrase(mWord, lesson: lesson, orderIndex: globalPhraseIndex, snapshots: snapshots)
                    phrase.block = block
                    globalPhraseIndex += 1
                    attachAudio(mWord, to: phrase, lesson: lesson)
                }
            case .story:
                attachStoryAudio(mBlock, to: block, lesson: lesson)
            case .none:
                break
            }

            // Батчинг: периодически сбрасываем в стор (спека §16).
            if blockIdx % 5 == 4 {
                try context.save()
            }
        }

        // Прогресс урока. Сначала обрабатываем отложенные удаления, иначе счётчики
        // увидят старые (удалённые, но ещё не выгруженные) фразы при обновлении.
        context.processPendingChanges()
        let progress = existing?.progress ?? LessonProgress(context: context)
        progress.lesson = lesson
        recomputeProgressCounters(progress, lesson: lesson)

        try context.save()
        return lesson
    }

    // MARK: - Helpers

    private func makePhrase(
        _ m: ManifestPhrase,
        lesson: Lesson,
        orderIndex: Int64,
        snapshots: [String: PhraseProgressSnapshot]
    ) -> Phrase {
        let phrase = Phrase(context: context)
        phrase.phraseId = m.id
        phrase.textEs = m.es
        phrase.textRu = m.ru
        phrase.orderIndex = orderIndex
        phrase.lesson = lesson

        if let snap = snapshots[m.id] {
            phrase.state = snap.state
            phrase.reviewCount = snap.reviewCount
            phrase.lastReviewDate = snap.lastReviewDate
            phrase.nextReviewDate = snap.nextReviewDate
            phrase.easeFactor = snap.easeFactor
            phrase.interval = snap.interval
            phrase.isFavorite = snap.isFavorite
        } else {
            phrase.state = PhraseState.learning.rawValue
            phrase.reviewCount = 0
            phrase.easeFactor = 2.5
            phrase.interval = 1
            phrase.isFavorite = false
        }
        return phrase
    }

    private func attachAudio(_ m: ManifestPhrase, to phrase: Phrase, lesson: Lesson) {
        let es = makeAudio(fileId: "\(m.id)-es", language: .es, relativeSubPath: m.audio.es,
                           durationMs: m.durationMs.es, lesson: lesson)
        es.phrase = phrase
        let ru = makeAudio(fileId: "\(m.id)-ru", language: .ru, relativeSubPath: m.audio.ru,
                           durationMs: m.durationMs.ru, lesson: lesson)
        ru.phrase = phrase
    }

    private func attachStoryAudio(_ m: ManifestBlock, to block: LessonBlock, lesson: Lesson) {
        guard let audio = m.audio, let duration = m.durationMs else { return }
        let es = makeAudio(fileId: "\(m.blockId)-story-es", language: .es, relativeSubPath: audio.es,
                           durationMs: duration.es, lesson: lesson)
        es.block = block
        let ru = makeAudio(fileId: "\(m.blockId)-story-ru", language: .ru, relativeSubPath: audio.ru,
                           durationMs: duration.ru, lesson: lesson)
        ru.block = block
    }

    private func makeAudio(
        fileId: String,
        language: PhraseLanguage,
        relativeSubPath: String,
        durationMs: Int,
        lesson: Lesson
    ) -> AudioFile {
        let audio = AudioFile(context: context)
        audio.fileId = fileId
        audio.language = language.rawValue
        audio.relativePath = "AudioLearner/lessons/\(lesson.topicId)/\(relativeSubPath)"
        audio.durationMs = Int64(durationMs)
        audio.isDownloaded = true
        audio.lesson = lesson
        let attrs = try? FileManager.default.attributesOfItem(atPath: audio.fileURL.path)
        audio.fileSize = Int64((attrs?[.size] as? Int) ?? 0)
        return audio
    }

    /// Удаляет содержимое урока (блоки/группы/фразы/аудио), сохраняя сам Lesson, прогресс и сессии.
    private func clearContent(of lesson: Lesson) {
        for audio in lesson.audioFiles { context.delete(audio) }
        for phrase in lesson.phrasesRel { context.delete(phrase) }
        for block in lesson.blocks { context.delete(block) }
    }

    /// Пересчитывает счётчики прогресса по состояниям фраз.
    func recomputeProgressCounters(_ progress: LessonProgress, lesson: Lesson) {
        var learning: Int64 = 0, inProgress: Int64 = 0, mastered: Int64 = 0
        for phrase in lesson.allLearnablePhrases {
            switch phrase.stateEnum {
            case .learning: learning += 1
            case .inProgress: inProgress += 1
            case .mastered: mastered += 1
            }
        }
        progress.phrasesLearning = learning
        progress.phrasesInProgress = inProgress
        progress.phrasesMastered = mastered
    }
}
