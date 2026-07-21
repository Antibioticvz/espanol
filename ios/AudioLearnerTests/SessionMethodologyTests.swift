import XCTest
@testable import AudioLearner

/// Пакет A (v1.2, D-23): пропорциональные паузы, порядок сторон, автоскорость.
final class SessionMethodologyTests: AudioLearnerTestCase {

    private func playable(esMs: Int = 2000, ruMs: Int = 1000) -> PlayablePhrase {
        PlayablePhrase(
            phraseId: "p",
            textEs: "es-text",
            textRu: "ru-text",
            audioEsURL: URL(fileURLWithPath: "/tmp/es.mp3"),
            audioRuURL: URL(fileURLWithPath: "/tmp/ru.mp3"),
            durationEsMs: esMs,
            durationRuMs: ruMs
        )
    }

    private func ref(_ item: SessionQueueItem) -> SessionAudioRef? {
        if case .audio(let r) = item { return r }
        return nil
    }

    // MARK: - Proportional pauses

    func testProportionalPausesExactDurations() throws {
        var config = SessionConfig.default
        config.repetitions = 1
        config.pauseMode = .proportional
        config.pauseCoefficient = 1.5
        config.sideOrder = .esRu
        let items = SessionQueueBuilder.buildPhraseQueue(playable(esMs: 2000, ruMs: 1000), config: config)

        XCTAssertEqual(items.count, 4)
        // Пауза после ES (2.0с) = 3.0с; после RU (1.0с) = 1.5с.
        XCTAssertEqual(try XCTUnwrap(items[1].pauseSeconds), 3.0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(items[3].pauseSeconds), 1.5, accuracy: 0.0001)
    }

    func testFixedPausesIgnoreDuration() throws {
        var config = SessionConfig.default
        config.repetitions = 1
        config.pauseMode = .fixed
        config.pauseSeconds = 4
        config.sideOrder = .esRu
        let items = SessionQueueBuilder.buildPhraseQueue(playable(esMs: 2000, ruMs: 1000), config: config)
        XCTAssertEqual(try XCTUnwrap(items[1].pauseSeconds), 4.0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(items[3].pauseSeconds), 4.0, accuracy: 0.0001)
    }

    // MARK: - Side order

    func testSideOrderEsRu() {
        var config = SessionConfig.default
        config.repetitions = 1
        config.sideOrder = .esRu
        let items = SessionQueueBuilder.buildPhraseQueue(playable(), config: config)
        XCTAssertEqual(ref(items[0])?.language, .es)
        XCTAssertEqual(ref(items[2])?.language, .ru)
        XCTAssertEqual(ref(items[0])?.text, "es-text")
    }

    func testSideOrderRuEs() {
        var config = SessionConfig.default
        config.repetitions = 1
        config.sideOrder = .ruEs
        let items = SessionQueueBuilder.buildPhraseQueue(playable(), config: config)
        XCTAssertEqual(ref(items[0])?.language, .ru)
        XCTAssertEqual(ref(items[2])?.language, .es)
        XCTAssertEqual(ref(items[0])?.text, "ru-text")
    }

    func testSideOrderEsEsShadowing() throws {
        var config = SessionConfig.default
        config.repetitions = 1
        config.sideOrder = .esEs
        let items = SessionQueueBuilder.buildPhraseQueue(playable(esMs: 2000, ruMs: 1000), config: config)
        XCTAssertEqual(ref(items[0])?.language, .es)
        XCTAssertEqual(ref(items[2])?.language, .es, "shadowing: обе стороны — оригинал")
        // Пропорциональная пауза после обеих сторон считается по ES-длительности.
        config.pauseMode = .proportional
        config.pauseCoefficient = 2.0
        let prop = SessionQueueBuilder.buildPhraseQueue(playable(esMs: 2000, ruMs: 1000), config: config)
        XCTAssertEqual(try XCTUnwrap(prop[1].pauseSeconds), 4.0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(prop[3].pauseSeconds), 4.0, accuracy: 0.0001)
    }

    func testSideOrderFirstIsEs() {
        XCTAssertTrue(SideOrder.esRu.firstIsEs)
        XCTAssertFalse(SideOrder.ruEs.firstIsEs)
        XCTAssertTrue(SideOrder.esEs.firstIsEs)
    }

    // MARK: - Auto-speed by status

    func testAutoSpeedMultiplierByState() {
        XCTAssertEqual(PhraseState.learning.autoSpeedMultiplier, 0.75, accuracy: 0.0001)
        XCTAssertEqual(PhraseState.inProgress.autoSpeedMultiplier, 0.9, accuracy: 0.0001)
        XCTAssertEqual(PhraseState.mastered.autoSpeedMultiplier, 1.0, accuracy: 0.0001)
    }

    func testPlayablePhraseAutoSpeedFromCoreData() throws {
        let lesson = try importFixture()
        let phrase = try XCTUnwrap(lesson.allLearnablePhrases.first)

        phrase.stateEnum = .inProgress
        let on = try XCTUnwrap(PlayablePhrase(phrase: phrase, autoSpeedByStatus: true))
        XCTAssertEqual(on.speedMultiplier, 0.9, accuracy: 0.0001)

        let off = try XCTUnwrap(PlayablePhrase(phrase: phrase, autoSpeedByStatus: false))
        XCTAssertEqual(off.speedMultiplier, 1.0, accuracy: 0.0001)

        phrase.stateEnum = .learning
        let learning = try XCTUnwrap(PlayablePhrase(phrase: phrase, autoSpeedByStatus: true))
        XCTAssertEqual(learning.speedMultiplier, 0.75, accuracy: 0.0001)
    }
}
