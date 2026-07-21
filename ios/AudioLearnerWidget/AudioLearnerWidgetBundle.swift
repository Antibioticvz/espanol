import WidgetKit
import SwiftUI

@main
struct AudioLearnerWidgetBundle: WidgetBundle {
    var body: some Widget {
        EmptyWidgetPlaceholder()
    }
}

struct EmptyWidgetPlaceholder: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "placeholder", provider: PlaceholderProvider()) { _ in
            Text("Audio Learner")
        }
    }
}

struct PlaceholderProvider: TimelineProvider {
    func placeholder(in context: Context) -> PlaceholderEntry { PlaceholderEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (PlaceholderEntry) -> Void) { completion(PlaceholderEntry(date: Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<PlaceholderEntry>) -> Void) {
        completion(Timeline(entries: [PlaceholderEntry(date: Date())], policy: .never))
    }
}

struct PlaceholderEntry: TimelineEntry { let date: Date }
