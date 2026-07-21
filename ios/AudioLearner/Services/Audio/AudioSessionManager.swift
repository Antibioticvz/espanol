import AVFoundation
import Foundation

/// Управление AVAudioSession: фоновое воспроизведение, прерывания, смена маршрута (спека §8).
final class AudioSessionManager {
    static let shared = AudioSessionManager()

    /// Вызывается при начале прерывания (например, звонок).
    var onInterruptionBegan: (() -> Void)?
    /// Вызывается при завершении прерывания; параметр — стоит ли возобновлять.
    var onInterruptionEnded: ((_ shouldResume: Bool) -> Void)?
    /// Вызывается при отключении маршрута (наушники выдернули).
    var onRouteChangeShouldPause: (() -> Void)?

    private var observersInstalled = false

    private init() {}

    func activate() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [])
        try? session.setActive(true, options: .notifyOthersOnDeactivation)
        installObservers()
    }

    func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func installObservers() {
        guard !observersInstalled else { return }
        observersInstalled = true
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(handleInterruption(_:)),
                           name: AVAudioSession.interruptionNotification,
                           object: AVAudioSession.sharedInstance())
        center.addObserver(self, selector: #selector(handleRouteChange(_:)),
                           name: AVAudioSession.routeChangeNotification,
                           object: AVAudioSession.sharedInstance())
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        switch type {
        case .began:
            onInterruptionBegan?()
        case .ended:
            var shouldResume = false
            if let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt {
                shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsValue).contains(.shouldResume)
            }
            onInterruptionEnded?(shouldResume)
        @unknown default:
            break
        }
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let reasonValue = userInfo[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else { return }
        // Старое аудио-устройство недоступно (вынули наушники) — ставим на паузу.
        if reason == .oldDeviceUnavailable {
            onRouteChangeShouldPause?()
        }
    }
}
