import ActivityKit
import Foundation

/// Управляет Live Activity аудио-сессии (v1.2, D-23). Обновляется только на смене фразы.
@MainActor
final class LiveActivityService {
    private var activity: Activity<SessionActivityAttributes>?

    var isEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    func start(lessonTitle: String, state: SessionActivityAttributes.ContentState) {
        guard isEnabled, activity == nil else { return }
        let attributes = SessionActivityAttributes(lessonTitle: lessonTitle)
        activity = try? Activity.request(
            attributes: attributes,
            content: .init(state: state, staleDate: nil)
        )
    }

    func update(_ state: SessionActivityAttributes.ContentState) {
        guard let activity else { return }
        Task { await activity.update(.init(state: state, staleDate: nil)) }
    }

    func end() {
        guard let current = activity else { return }
        let finalState = current.content.state
        Task { await current.end(.init(state: finalState, staleDate: nil), dismissalPolicy: .immediate) }
        activity = nil
    }

    /// Завершает все Live Activity этого типа (при старте — подметаем осиротевшие после kill, C13).
    func endAllOrphans() {
        activity = nil
        for activity in Activity<SessionActivityAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
