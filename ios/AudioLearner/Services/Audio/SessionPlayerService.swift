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

    /// Слоты повторения: первая сторона + пауза, вторая сторона + пауза (порядок из sideOrder).
    enum Leg: Int { case firstAudio, firstPause, secondAudio, secondPause }

    // MARK: - Inputs
    private(set) var phrases: [PlayablePhrase] = []
    private(set) var repetitions: Int = 5
    private(set) var pauseSeconds: Double = 3
    private(set) var pauseMode: PauseMode = .fixed
    private(set) var pauseCoefficient: Double = 1.5
    private(set) var sideOrder: SideOrder = .esRu
    private(set) var playbackMode: PlaybackMode = .once
    private(set) var sessionCycles: Int = 2

    // MARK: - Observable state
    private(set) var isPlaying = false
    private(set) var isFinished = false
    private(set) var currentPhraseIndex = 0
    private(set) var currentRepetition = 1
    private(set) var currentCycle = 1
    private(set) var currentLeg: Leg = .firstAudio
    private(set) var currentLanguage: PhraseLanguage = .es
    private(set) var isInPause = false
    private(set) var currentTime: TimeInterval = 0
    private(set) var currentDuration: TimeInterval = 0
    private(set) var completedPhraseIds: Set<String> = []

    // Sleep-таймер (v1.2): 0 = выкл. Остаток тикает каждую секунду для отображения.
    private(set) var sleepTotalSeconds: Int = 0
    private(set) var sleepRemainingSeconds: Int = 0
    var sleepMinutes: Int { sleepTotalSeconds / 60 }
    var isSleepActive: Bool { sleepTotalSeconds > 0 }

    @ObservationIgnored var onSleepTimerFired: (@MainActor () -> Void)?
    @ObservationIgnored private var sleepTimer: Timer?
    @ObservationIgnored private var sleepDeadline: Date?
    @ObservationIgnored private var sleepPending = false
    var isStopPending: Bool { sleepPending }

    /// Автоскорость текущей фразы (множитель по статусу); применяется поверх speed.
    @ObservationIgnored private var currentSpeedMultiplier: Double = 1.0

    /// Эффективная скорость с учётом множителя автоскорости.
    var effectiveRate: Float { Float(speed * currentSpeedMultiplier) }

    /// Скорость для Now Playing: во время паузы «трек» идёт в реальном времени (1.0), при остановке 0.
    var nowPlayingRate: Double {
        guard isPlaying else { return 0 }
        return isInPause ? 1.0 : Double(effectiveRate)
    }

    var speed: Double = 1.0 {
        didSet { player?.rate = effectiveRate }
    }

    /// Громкость воспроизведения речи (0…1), применяется на лету.
    var volume: Double = 1.0 {
        didSet { player?.volume = Float(volume) }
    }

    // MARK: - Callbacks (не наблюдаются; вызываются на main)
    @ObservationIgnored var onPhraseCompleted: (@MainActor (String) -> Void)?
    @ObservationIgnored var onSessionFinished: (@MainActor () -> Void)?
    @ObservationIgnored var onItemChanged: (@MainActor () -> Void)?
    /// Вызывается при смене play↔pause (для синхронизации Now Playing/Live Activity из интентов).
    @ObservationIgnored var onPlaybackStateChanged: (@MainActor () -> Void)?

    /// Фразы, зарегистрированные в SRS за сессию (одна регистрация на фразу; НЕ сбрасывается
    /// на границе цикла, в отличие от completedPhraseIds для отображения X/N — D-23 fix).
    @ObservationIgnored private var srsCompletedPhraseIds: Set<String> = []
    /// Поколение «ноги»: отсекает устаревшие срабатывания pause-таймера.
    @ObservationIgnored private var legGeneration = 0

    // MARK: - Private
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var pauseTimer: Timer?
    @ObservationIgnored private var progressTimer: Timer?
    @ObservationIgnored private var pauseRemaining: TimeInterval = 0
    @ObservationIgnored private var pauseStartedAt: Date?

    /// Отдельный плеер одиночных клипов для флеш-карт (без очереди повторов, D-19).
    @ObservationIgnored private var clipPlayer: AVAudioPlayer?

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
        self.pauseMode = config.pauseMode
        self.pauseCoefficient = config.pauseCoefficient
        self.sideOrder = config.sideOrder
        self.playbackMode = config.playbackMode
        self.sessionCycles = max(1, config.sessionCycles)
        self.speed = config.speed
        reset()
    }

    func reset() {
        stopTimers()
        clearSleepTimer()
        player?.stop()
        player = nil
        stopSilence()
        stopClip()
        isPlaying = false
        isFinished = false
        currentPhraseIndex = 0
        currentRepetition = 1
        currentCycle = 1
        currentLeg = .firstAudio
        currentLanguage = .es
        isInPause = false
        currentTime = 0
        currentDuration = 0
        completedPhraseIds = []
        srsCompletedPhraseIds = []
        legGeneration += 1
    }

    /// Полностью сбрасывает sleep-таймер (общее для reset/finishSession).
    private func clearSleepTimer() {
        sleepTimer?.invalidate()
        sleepTimer = nil
        sleepDeadline = nil
        sleepPending = false
        sleepTotalSeconds = 0
        sleepRemainingSeconds = 0
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
        onPlaybackStateChanged?()
    }

    func pause() {
        isPlaying = false
        player?.pause()
        if isInPause {
            holdPause()
            silencePlayer?.pause()
        }
        stopProgressTimer()
        onPlaybackStateChanged?()
    }

    func togglePlayPause() {
        isPlaying ? pause() : play()
    }

    func stop() {
        reset()
    }

    // MARK: - Sleep timer (v1.2)

    /// Устанавливает sleep-таймер (0 = выкл). По истечении доигрывает текущий повтор
    /// и мягко ставит на паузу (не завершает сессию).
    func setSleepTimer(minutes: Int) {
        sleepTimer?.invalidate()
        sleepTimer = nil
        sleepPending = false
        sleepTotalSeconds = max(0, minutes) * 60
        sleepRemainingSeconds = sleepTotalSeconds
        guard sleepTotalSeconds > 0 else { sleepDeadline = nil; return }
        sleepDeadline = Date().addingTimeInterval(Double(sleepTotalSeconds))
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tickSleep() }
        }
        RunLoop.main.add(timer, forMode: .common)
        sleepTimer = timer
    }

    private func tickSleep() {
        guard let deadline = sleepDeadline else { return }
        let remaining = Int(ceil(deadline.timeIntervalSinceNow))
        sleepRemainingSeconds = max(0, remaining)
        if remaining <= 0 {
            sleepTimer?.invalidate()
            sleepTimer = nil
            sleepDeadline = nil
            sleepPending = true // остановимся по завершении текущего повтора
        }
    }

    /// Помечает остановку по завершении текущего повтора (для тестов/внутреннего использования).
    func requestStopAtRepetitionEnd() { sleepPending = true }

    /// Если запрошена остановка по sleep-таймеру — мягко ставим на паузу (не finish).
    @discardableResult
    func consumeSleepStopIfNeeded() -> Bool {
        guard sleepPending else { return false }
        sleepPending = false
        sleepTotalSeconds = 0
        sleepRemainingSeconds = 0
        sleepDeadline = nil
        sleepTimer?.invalidate()
        sleepTimer = nil
        pause()
        onSleepTimerFired?()
        return true
    }

    // MARK: - Single clip (флеш-карты)

    /// Проигрывает одиночный аудио-клип (одна фраза), не затрагивая очередь повторов.
    func playClip(_ url: URL, speed: Double, volume: Double) {
        clipPlayer?.stop()
        guard let player = try? AVAudioPlayer(contentsOf: url) else { return }
        player.enableRate = true
        player.rate = Float(speed)
        player.volume = Float(volume)
        player.prepareToPlay()
        player.play()
        clipPlayer = player
    }

    func stopClip() {
        clipPlayer?.stop()
        clipPlayer = nil
    }

    // MARK: - Navigation

    func skipToNextPhrase() {
        // Симметрично помечаем текущую фразу завершённой в любом случае (m13).
        markCurrentPhraseCompletedIfNeeded()
        if currentPhraseIndex + 1 < phrases.count {
            currentPhraseIndex += 1
            restartPhraseLegs()
        } else {
            advancePhraseBoundary()
        }
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
        currentLeg = .firstAudio
        loadCurrentLeg(autoplay: isPlaying)
    }

    // MARK: - Leg machine

    private func loadCurrentLeg(autoplay: Bool) {
        stopPauseTimer()
        guard let phrase = currentPhrase else { finishSession(); return }
        currentSpeedMultiplier = phrase.speedMultiplier
        let sides = sideOrder.sides

        switch currentLeg {
        case .firstAudio:
            currentLanguage = sides[0]
            playAudio(url: phrase.url(sides[0]), autoplay: autoplay)
        case .secondAudio:
            currentLanguage = sides[1]
            playAudio(url: phrase.url(sides[1]), autoplay: autoplay)
        case .firstPause:
            beginPause(seconds: pauseDuration(for: sides[0], phrase: phrase), autoplay: autoplay)
        case .secondPause:
            beginPause(seconds: pauseDuration(for: sides[1], phrase: phrase), autoplay: autoplay)
        }
        onItemChanged?()
    }

    /// Длительность паузы после стороны: фиксированная или пропорциональная длине стороны.
    private func pauseDuration(for side: PhraseLanguage, phrase: PlayablePhrase) -> TimeInterval {
        switch pauseMode {
        case .fixed: return pauseSeconds
        case .proportional: return phrase.durationSeconds(side) * pauseCoefficient
        }
    }

    private func playAudio(url: URL, autoplay: Bool) {
        isInPause = false
        stopSilence()
        player?.stop()
        do {
            let newPlayer = try AVAudioPlayer(contentsOf: url)
            newPlayer.enableRate = true
            newPlayer.rate = effectiveRate
            newPlayer.volume = Float(volume)
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
            // Файл недоступен — считаем «ногу» завершённой, идём дальше (асинхронно, m12).
            player = nil
            currentDuration = 0
            scheduleAdvance()
        }
    }

    private func beginPause(seconds: TimeInterval, autoplay: Bool) {
        player = nil
        isInPause = true
        currentDuration = seconds
        currentTime = 0
        pauseRemaining = seconds
        if seconds <= 0 {
            isInPause = false
            scheduleAdvance()
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
        let gen = legGeneration
        // .common — иначе таймер молчит во время трекинга ScrollView (m16).
        let timer = Timer(timeInterval: pauseRemaining, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.pauseFinished(generation: gen) }
        }
        RunLoop.main.add(timer, forMode: .common)
        pauseTimer = timer
    }

    private func holdPause() {
        if let started = pauseStartedAt {
            pauseRemaining = max(0, pauseRemaining - Date().timeIntervalSince(started))
        }
        pauseTimer?.invalidate()
        pauseTimer = nil
        pauseStartedAt = nil
    }

    private func pauseFinished(generation: Int) {
        // Отсекаем устаревшее срабатывание (nextPhrase/новая нога уже сдвинули машину, m10).
        guard generation == legGeneration, isInPause else { return }
        isInPause = false
        pauseTimer = nil
        pauseStartedAt = nil
        stopSilence()
        advanceLeg()
    }

    private func scheduleAdvance() {
        // Асинхронно, чтобы не раскручивать глубокую синхронную рекурсию при битых файлах/нулевой паузе (m12).
        Task { @MainActor [weak self] in self?.advanceLeg() }
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
        // Sleep-таймер: доиграли повтор — мягко останавливаемся.
        if consumeSleepStopIfNeeded() { return }
        if currentRepetition < repetitions {
            currentRepetition += 1
            currentLeg = .firstAudio
            loadCurrentLeg(autoplay: isPlaying)
        } else {
            // Все повторения фразы выполнены.
            markCurrentPhraseCompletedIfNeeded()
            switch playbackMode {
            case .loopPhrase:
                // Зацикливаем текущую фразу до нажатия «Далее».
                currentRepetition = 1
                currentLeg = .firstAudio
                loadCurrentLeg(autoplay: isPlaying)
            case .once, .cycleSession, .flashcards:
                advancePhraseBoundary()
            }
        }
    }

    private func advancePhraseBoundary() {
        if currentPhraseIndex + 1 < phrases.count {
            currentPhraseIndex += 1
            currentRepetition = 1
            currentLeg = .firstAudio
            loadCurrentLeg(autoplay: isPlaying)
        } else {
            // Конец прохода.
            if playbackMode == .cycleSession && currentCycle < sessionCycles {
                currentCycle += 1
                currentPhraseIndex = 0
                currentRepetition = 1
                currentLeg = .firstAudio
                completedPhraseIds = [] // новый проход
                loadCurrentLeg(autoplay: isPlaying)
            } else {
                finishSession()
            }
        }
    }

    private func markCurrentPhraseCompletedIfNeeded() {
        guard let phrase = currentPhrase else { return }
        // Отображение X/N: сбрасывается на границе цикла.
        completedPhraseIds.insert(phrase.phraseId)
        // SRS: ровно одна регистрация на фразу за сессию (cycleSession не задваивает, C17/D-23).
        if !srsCompletedPhraseIds.contains(phrase.phraseId) {
            srsCompletedPhraseIds.insert(phrase.phraseId)
            onPhraseCompleted?(phrase.phraseId)
        }
    }

    private func finishSession() {
        stopTimers()
        clearSleepTimer() // m15: секундный sleep-таймер не должен пережить завершение
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
        let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tickProgress() }
        }
        RunLoop.main.add(timer, forMode: .common)
        progressTimer = timer
    }

    private func stopProgressTimer() {
        progressTimer?.invalidate()
        progressTimer = nil
    }

    private func stopPauseTimer() {
        pauseTimer?.invalidate()
        pauseTimer = nil
        pauseStartedAt = nil
        legGeneration += 1 // любое устаревшее срабатывание паузы теперь игнорируется
    }

    private func stopTimers() {
        stopProgressTimer()
        stopPauseTimer()
    }

    private func tickProgress() {
        if isInPause {
            // currentDuration хранит фактическую длину текущей паузы (фикс. или пропорц.).
            let elapsed = (currentDuration - pauseRemaining) + (pauseStartedAt.map { Date().timeIntervalSince($0) } ?? 0)
            currentTime = min(currentDuration, elapsed)
        } else if let player {
            currentTime = player.currentTime
        }
    }

    // MARK: - AVAudioPlayerDelegate

    /// Может вызываться не с главного потока — возвращаемся на main перед мутациями.
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            // Игнорируем колбэк тихого плеера и устаревший колбэк не-текущего плеера (C15).
            guard player !== self.silencePlayer, player === self.player else { return }
            self.currentTime = self.currentDuration
            self.advanceLeg()
        }
    }
}
