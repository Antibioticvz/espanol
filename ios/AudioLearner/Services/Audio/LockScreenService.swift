import Foundation
import MediaPlayer

/// Интеграция с экраном блокировки: Now Playing + Remote Command Center (спека §6).
final class LockScreenService {

    var onPlay: (() -> Void)?
    var onPause: (() -> Void)?
    var onNext: (() -> Void)?
    var onPrevious: (() -> Void)?

    private var commandsInstalled = false

    // MARK: - Remote commands

    func setupRemoteCommands() {
        guard !commandsInstalled else { return }
        commandsInstalled = true
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            self?.onPlay?(); return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.onPause?(); return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.onPlay?(); return .success
        }
        center.nextTrackCommand.isEnabled = true
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.onNext?(); return .success
        }
        center.previousTrackCommand.isEnabled = true
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.onPrevious?(); return .success
        }
    }

    // MARK: - Now Playing

    /// Обновляет Now Playing с учётом режима показа текста (спека §6.1).
    func update(
        textEs: String,
        textRu: String,
        lessonTitle: String,
        duration: TimeInterval,
        elapsed: TimeInterval,
        rate: Double,
        trackNumber: Int,
        trackCount: Int,
        textMode: LockScreenTextMode
    ) {
        let (title, artist) = displayText(textEs: textEs, textRu: textRu, mode: textMode)
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPMediaItemPropertyAlbumTitle: lessonTitle,
            MPMediaItemPropertyPlaybackDuration: max(0, duration),
            MPNowPlayingInfoPropertyElapsedPlaybackTime: max(0, elapsed),
            MPNowPlayingInfoPropertyPlaybackRate: rate,
            MPMediaItemPropertyAlbumTrackNumber: trackNumber,
            MPMediaItemPropertyAlbumTrackCount: trackCount
        ]
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = rate
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func displayText(textEs: String, textRu: String, mode: LockScreenTextMode) -> (String, String) {
        switch mode {
        case .both: return (textEs, textRu)
        case .original: return (textEs, "")
        case .translation: return (textRu, "")
        case .hidden: return ("Фраза", "")
        }
    }

    func clear() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
}
