import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// Live Activity + Dynamic Island активной аудио-сессии (v1.2, D-23).
struct SessionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SessionActivityAttributes.self) { context in
            lockScreenView(context)
                .padding()
                .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "headphones").foregroundStyle(.tint)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.index)/\(context.state.total)")
                        .font(.caption).monospacedDigit()
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(context.state.title).font(.headline).lineLimit(1)
                        if !context.state.subtitle.isEmpty {
                            Text(context.state.subtitle).font(.caption)
                                .foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        ProgressView(value: progress(context))
                        Button(intent: PauseSessionIntent()) {
                            Image(systemName: "pause.fill")
                        }
                        .buttonStyle(.bordered)
                    }
                }
            } compactLeading: {
                Image(systemName: "headphones")
            } compactTrailing: {
                Text("\(context.state.index)/\(context.state.total)")
                    .font(.caption2).monospacedDigit()
            } minimal: {
                Image(systemName: "headphones")
            }
        }
    }

    private func progress(_ context: ActivityViewContext<SessionActivityAttributes>) -> Double {
        context.state.total > 0 ? Double(context.state.index) / Double(context.state.total) : 0
    }

    @ViewBuilder
    private func lockScreenView(_ context: ActivityViewContext<SessionActivityAttributes>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(context.attributes.lessonTitle, systemImage: "headphones")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text("\(context.state.index)/\(context.state.total)")
                    .font(.caption).monospacedDigit()
            }
            Text(context.state.title).font(.headline).lineLimit(2)
            if !context.state.subtitle.isEmpty {
                Text(context.state.subtitle).font(.subheadline)
                    .foregroundStyle(.secondary).lineLimit(2)
            }
            HStack {
                ProgressView(value: progress(context))
                Button(intent: PauseSessionIntent()) {
                    Image(systemName: "pause.fill")
                }
                .buttonStyle(.bordered)
            }
        }
    }
}
