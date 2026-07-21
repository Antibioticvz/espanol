import AVFoundation
import Foundation
import Observation

/// Воспроизведение сессии как конечный автомат по «ногам» повторения:
/// `ES → пауза → RU → пауза`, N повторений на фразу (спека §5).
/// Скорость 0.5–2.0 без изменения питча через `AVAudioPlayer.enableRate` — меняется на лету.
///
/// Класс изолирован на @MainActor: всё состояние и мутации происходят на главном потоке,
/// а делегатский колбэк (может прийти не с main) заворачивается обратно на main.
@MainActor
@Observable
final class SessionPlayerService: NSObject, AVAudioPlayerDelegate {

    enum Leg: Int { case esAudio, esPause, ruAudio, ruPause }

    // MARK: - Inputs
    private(set) var phrases: [PlayablePhrase] = []
    private(set) var repetitions: Int = 5
    private(set) var pauseSeconds: Double = 3
    private(set) var playbackMode: PlaybackMode = .once
    private(set) var sessionCycles: Int = 2

    // MARK: - Observable state
    private(set) var isPlaying = false
    private(set) var isFinished = false
    private(set) var currentPhraseIndex = 0
    private(set) var currentRepetition = 1
    private(set) var currentCycle = 1
    private(set) var currentLeg: Leg = .esAudio
    private(set) var currentLanguage: PhraseLanguage = .es
    private(set) var isInPause = false
    private(set) var currentTime: TimeInterval = 0
    private(set) var currentDuration: TimeInterval = 0
    private(set) var completedPhraseIds: Set<String> = []

    var speed: Double = 1.0 {
        didSet { player?.rate = Float(speed) }
    }

    // MARK: - Callbacks (не наблюдаются; вызываются на main)
    @ObservationIgnored var onPhraseCompleted: (@MainActor (String) -> Void)?
    @ObservationIgnored var onSessionFinished: (@MainActor () -> Void)?
    @ObservationIgnored var onItemChanged: (@MainActor () -> Void)?

    // MARK: - Private
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var pauseTimer: Timer?
    @ObservationIgnored private var progressTimer: Timer?
    @ObservationIgnored private var pauseRemaining: TimeInterval = 0
    @ObservationIgnored private var pauseStartedAt: Date?

    /// Тихий зациклённый плеер: звучит во время пауз, чтобы iOS не убил фоновую сессию.
    @ObservationIgnored private lazy var silencePlayer: AVAudioPlayer? = {
        guard let p = try? AVAudioPlayer(data: SilenceAudio.wavData) else { return nil }
        p.numberOfLoops = -1
        p.volume = 0
        p.prepareToPlay()
        return p
    }()

    // MARK: - Derived
    var currentPhrase: PlayablePhrase? {
        phrases.indices.contains(currentPhraseIndex) ? phrases[currentPhraseIndex] : nil
    }

    var nextPhrase: PlayablePhrase? {
        let idx = currentPhraseIndex + 1
        return phrases.indices.contains(idx) ? phrases[idx] : nil
    }

    var totalPhrases: Int { phrases.count }

    /// Прогресс сессии 0…1 по числу завершённых фраз.
    var sessionProgress: Double {
        phrases.isEmpty ? 0 : Double(completedPhraseIds.count) / Double(phrases.count)
    }

    /// Прогресс текущего аудио/паузы 0…1.
    var itemProgress: Double {
        currentDuration > 0 ? min(1, currentTime / currentDuration) : 0
    }

    // MARK: - Lifecycle

    func configure(phrases: [PlayablePhrase], config: SessionConfig) {
        self.phrases = phrases
        self.repetitions = max(1, config.repetitions)
        self.pauseSeconds = max(0, config.pauseSeconds)
        self.playbackMode = config.playbackMode
        self.sessionCycles = max(1, config.sessionCycles)
        self.speed = config.speed
        reset()
    }

    func reset() {
        stopTimers()
        player?.stop()
        player = nil
        stopSilence()
        isPlaying = false
        isFinished = false
        currentPhraseIndex = 0
        currentRepetition = 1
        currentCycle = 1
        currentLeg = .esAudio
        currentLanguage = .es
        isInPause = false
        currentTime = 0
        currentDuration = 0
        completedPhraseIds = []
    }

    func start() {
        guard !phrases.isEmpty else { return }
        isPlaying = true
        isFinished = false
        loadCurrentLeg(autoplay: true)
    }

    func play() {
        guard !isFinished else { return }
        isPlaying = true
        if isInPause {
            resumePause()
            startSilence()
        } else if let player {
            player.play()
        } else {
            loadCurrentLeg(autoplay: true)
        }
        startProgressTimer()
    }

    func pause() {
        isPlaying = false
        player?.pause()
        if isInPause {
            holdPause()
            silencePlayer?.pause()
        }
        stopProgressTimer()
    }

    func togglePlayPause() {
        isPlaying ? pause() : play()
    }

    func stop() {
        reset()
    }

    // MARK: - Navigation

    func nextPhrase(userInitiated: Bool = true) {
        guard currentPhraseIndex + 1 < phrases.count else {
            // Последняя фраза — завершаем или зацикливаем.
            advancePhraseBoundary()
            return
        }
        markCurrentPhraseCompletedIfNeeded()
        currentPhraseIndex += 1
        restartPhraseLegs()
    }

    func previousPhrase() {
        guard currentPhraseIndex > 0 else {
            restartPhraseLegs()
            return
        }
        currentPhraseIndex -= 1
        restartPhraseLegs()
    }

    /// Повторить текущую фразу заново (не увеличивает счётчик повторений сверх N).
    func repeatCurrentPhrase() {
        restartPhraseLegs()
    }

    private func restartPhraseLegs() {
        currentRepetition = 1
        currentLeg = .esAudio
        loadCurrentLeg(autoplay: isPlaying)
    }

    // MARK: - Leg machine

    private func loadCurrentLeg(autoplay: Bool) {
        stopPauseTimer()
        guard let phrase = currentPhrase else { finishSession(); return }

        switch currentLeg {
        case .esAudio:
            currentLanguage = .es
            playAudio(url: phrase.audioEsURL, autoplay: autoplay)
        case .ruAudio:
            currentLanguage = .ru
            playAudio(url: phrase.audioRuURL, autoplay: autoplay)
        case .esPause, .ruPause:
            beginPause(autoplay: autoplay)
        }
        onItemChanged?()
    }

    private func playAudio(url: URL, autoplay: Bool) {
        isInPause = false
        stopSilence()
        player?.stop()
        do {
            let newPlayer = try AVAudioPlayer(contentsOf: url)
            newPlayer.enableRate = true
            newPlayer.rate = Float(speed)
            newPlayer.delegate = self
            newPlayer.prepareToPlay()
            player = newPlayer
            currentDuration = newPlayer.duration
            currentTime = 0
            if autoplay && isPlaying {
                newPlayer.play()
                startProgressTimer()
            }
        } catch {
            // Файл недоступен — считаем «ногу» завершённой, идём дальше.
            player = nil
            currentDuration = 0
            advanceLeg()
        }
    }

    private func beginPause(autoplay: Bool) {
        player = nil
        isInPause = true
        currentDuration = pauseSeconds
        currentTime = 0
        pauseRemaining = pauseSeconds
        if pauseSeconds <= 0 {
            isInPause = false
            advanceLeg()
            return
        }
        if autoplay && isPlaying {
            resumePause()
            startSilence()
            startProgressTimer()
        }
    }

    private func resumePause() {
        pauseStartedAt = Date()
        pauseTimer?.invalidate()
        pauseTimer = Timer.scheduledTimer(withTimeInterval: pauseRemaining, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.pauseFinished() }
        }
    }

    private func holdPause() {
        if let started = pauseStartedAt {
            pauseRemaining = max(0, pauseRemaining - Date().timeIntervalSince(started))
        }
        pauseTimer?.invalidate()
        pauseTimer = nil
        pauseStartedAt = nil
    }

    private func pauseFinished() {
        isInPause = false
        pauseTimer = nil
        pauseStartedAt = nil
        stopSilence()
        advanceLeg()
    }

    // MARK: - Silence during pauses

    private func startSilence() {
        silencePlayer?.play()
    }

    private func stopSilence() {
        silencePlayer?.pause()
        silencePlayer?.currentTime = 0
    }

    /// Переход к следующей «ноге»; по завершении ruPause — новое повторение/фраза.
    private func advanceLeg() {
        guard let next = Leg(rawValue: currentLeg.rawValue + 1) else {
            // Завершилось повторение (после ruPause).
            finishRepetition()
            return
        }
        currentLeg = next
        loadCurrentLeg(autoplay: isPlaying)
    }

    private func finishRepetition() {
        if currentRepetition < repetitions {
            currentRepetition += 1
            currentLeg = .esAudio
            loadCurrentLeg(autoplay: isPlaying)
        } else {
            // Все повторения фразы выполнены.
            markCurrentPhraseCompletedIfNeeded()
            switch playbackMode {
            case .loopPhrase:
                // Зацикливаем текущую фразу до нажатия «Далее».
                currentRepetition = 1
                currentLeg = .esAudio
                loadCurrentLeg(autoplay: isPlaying)
            case .once, .cycleSession:
                advancePhraseBoundary()
            }
        }
    }

    private func advancePhraseBoundary() {
        if currentPhraseIndex + 1 < phrases.count {
            currentPhraseIndex += 1
            currentRepetition = 1
            currentLeg = .esAudio
            loadCurrentLeg(autoplay: isPlaying)
        } else {
            // Конец прохода.
            if playbackMode == .cycleSession && currentCycle < sessionCycles {
                currentCycle += 1
                currentPhraseIndex = 0
                currentRepetition = 1
                currentLeg = .esAudio
                completedPhraseIds = [] // новый проход
                loadCurrentLeg(autoplay: isPlaying)
            } else {
                finishSession()
            }
        }
    }

    private func markCurrentPhraseCompletedIfNeeded() {
        guard let phrase = currentPhrase else { return }
        if !completedPhraseIds.contains(phrase.phraseId) {
            completedPhraseIds.insert(phrase.phraseId)
            onPhraseCompleted?(phrase.phraseId)
        }
    }

    private func finishSession() {
        stopTimers()
        player?.stop()
        player = nil
        stopSilence()
        isPlaying = false
        isFinished = true
        isInPause = false
        onItemChanged?()
        onSessionFinished?()
    }

    // MARK: - Timers

    private func startProgressTimer() {
        stopProgressTimer()
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tickProgress() }
        }
    }

    private func stopProgressTimer() {
        progressTimer?.invalidate()
        progressTimer = nil
    }

    private func stopPauseTimer() {
        pauseTimer?.invalidate()
        pauseTimer = nil
        pauseStartedAt = nil
    }

    private func stopTimers() {
        stopProgressTimer()
        stopPauseTimer()
    }

    private func tickProgress() {
        if isInPause {
            let elapsed = (pauseSeconds - pauseRemaining) + (pauseStartedAt.map { Date().timeIntervalSince($0) } ?? 0)
            currentTime = min(pauseSeconds, elapsed)
        } else if let player {
            currentTime = player.currentTime
        }
    }

    // MARK: - AVAudioPlayerDelegate

    /// Может вызываться не с главного потока — возвращаемся на main перед мутациями.
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            // Игнорируем колбэк тихого плеера (он зациклён и завершиться не должен).
            guard player !== self.silencePlayer else { return }
            self.currentTime = self.currentDuration
            self.advanceLeg()
        }
    }
}
