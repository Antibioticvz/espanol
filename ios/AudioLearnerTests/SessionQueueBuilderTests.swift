import XCTest
@testable import AudioLearner

/// Построение очереди сессии (спека §5, контракт ES→пауза→RU→пауза).
final class SessionQueueBuilderTests: XCTestCase {

    private func makePhrase(_ id: String) -> PlayablePhrase {
        PlayablePhrase(
            phraseId: id,
            textEs: "es-\(id)",
            textRu: "ru-\(id)",
            audioEsURL: URL(fileURLWithPath: "/tmp/\(id)-es.mp3"),
            audioRuURL: URL(fileURLWithPath: "/tmp/\(id)-ru.mp3"),
            durationEsMs: 1000,
            durationRuMs: 1200
        )
    }

    func testSinglePhraseRepetitionsProduceFourItemsEach() {
        let phrase = makePhrase("p1")
        let items = SessionQueueBuilder.buildPhraseQueue(phrase, repetitions: 3, pauseSeconds: 5)

        // 3 повторения × (ES, пауза, RU, пауза) = 12 элементов.
        XCTAssertEqual(items.count, 12)

        // Проверяем точный порядок паттерна для одного повторения.
        guard case .audio(let es0) = items[0] else { return XCTFail() }
        XCTAssertEqual(es0.language, .es)
        XCTAssertEqual(es0.text, "es-p1")
        XCTAssertTrue(items[1].isPause)
        guard case .audio(let ru0) = items[2] else { return XCTFail() }
        XCTAssertEqual(ru0.language, .ru)
        XCTAssertEqual(ru0.text, "ru-p1")
        XCTAssertTrue(items[3].isPause)

        // Паузы имеют настроенную длительность.
        if case .pause(let seconds) = items[1] {
            XCTAssertEqual(seconds, 5, accuracy: 0.001)
        } else { XCTFail() }

        // Паттерн повторяется идентично.
        guard case .audio(let es1) = items[4] else { return XCTFail() }
        XCTAssertEqual(es1.language, .es)
    }

    func testFullPassMultiplePhrases() {
        let phrases = [makePhrase("p1"), makePhrase("p2")]
        let items = SessionQueueBuilder.buildPass(phrases: phrases, repetitions: 2, pauseSeconds: 3)

        // 2 фразы × 2 повторения × 4 = 16 элементов.
        XCTAssertEqual(items.count, 16)

        // Первые 8 элементов — фраза p1, следующие 8 — p2 (аудио на чётных позициях).
        XCTAssertEqual(items[0].phraseId, "p1")  // es p1
        XCTAssertEqual(items[6].phraseId, "p1")  // ru p1 (2-е повторение)
        XCTAssertTrue(items[7].isPause)          // хвостовая пауза p1
        XCTAssertEqual(items[8].phraseId, "p2")  // es p2
        XCTAssertEqual(items[14].phraseId, "p2") // ru p2 (2-е повторение)
        XCTAssertTrue(items[15].isPause)         // хвостовая пауза p2

        // Порядок аудио/пауза чередуется по всему проходу.
        for (index, item) in items.enumerated() {
            if index % 2 == 0 {
                XCTAssertFalse(item.isPause, "Элемент \(index) должен быть аудио")
            } else {
                XCTAssertTrue(item.isPause, "Элемент \(index) должен быть паузой")
            }
        }
    }

    func testOnceModeSinglePass() {
        let phrases = [makePhrase("p1")]
        var config = SessionConfig.default
        config.repetitions = 2
        config.pauseSeconds = 4
        config.playbackMode = .once
        let items = SessionQueueBuilder.buildSession(phrases: phrases, config: config)
        XCTAssertEqual(items.count, 8) // 1 × 2 × 4
    }

    func testCycleSessionRepeatsPass() {
        let phrases = [makePhrase("p1"), makePhrase("p2")]
        var config = SessionConfig.default
        config.repetitions = 1
        config.pauseSeconds = 2
        config.playbackMode = .cycleSession
        config.sessionCycles = 3
        let items = SessionQueueBuilder.buildSession(phrases: phrases, config: config)

        // Проход = 2 фразы × 1 повтор × 4 = 8; × 3 цикла = 24.
        XCTAssertEqual(items.count, 24)
    }

    func testRepetitionsClampToAtLeastOne() {
        let phrase = makePhrase("p1")
        let items = SessionQueueBuilder.buildPhraseQueue(phrase, repetitions: 0, pauseSeconds: 1)
        XCTAssertEqual(items.count, 4, "0 повторений трактуется как 1")
    }

    func testEstimatedDuration() {
        var config = SessionConfig.default
        config.repetitions = 2
        config.pauseMode = .fixed
        config.pauseSeconds = 5
        config.speed = 1.0
        config.playbackMode = .once
        // Одна фраза: es=1s, ru=1s.
        let duration = config.estimatedDuration(phraseDurations: [(es: 1.0, ru: 1.0)])
        // На повтор: аудио 2с + 2 паузы по 5с = 12с; × 2 повтора = 24с.
        XCTAssertEqual(duration, 24, accuracy: 0.001)
    }

    func testEstimatedDurationProportional() {
        var config = SessionConfig.default
        config.repetitions = 1
        config.pauseMode = .proportional
        config.pauseCoefficient = 1.5
        config.speed = 1.0
        config.playbackMode = .once
        config.sideOrder = .esRu
        // es=2s, ru=1s. Пауза после es=3s, после ru=1.5s. Аудио 3s + паузы 4.5s = 7.5s.
        let duration = config.estimatedDuration(phraseDurations: [(es: 2.0, ru: 1.0)])
        XCTAssertEqual(duration, 7.5, accuracy: 0.001)
    }
}
