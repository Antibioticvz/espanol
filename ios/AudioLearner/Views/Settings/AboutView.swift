import SwiftUI

/// «О приложении» (спека §4.9).
struct AboutView: View {
    var body: some View {
        List {
            Section {
                VStack(spacing: 8) {
                    Image(systemName: "headphones")
                        .font(.system(size: 48))
                        .foregroundStyle(.tint)
                    Text("Audio Learner").font(.title2.weight(.bold))
                    Text("Плеер аудио-уроков испанского")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical)
            }
            Section("Версия") {
                LabeledContent("Версия", value: appVersion)
                LabeledContent("Сборка", value: buildNumber)
                LabeledContent("Минимальная iOS", value: "17.0")
            }
            Section("О системе") {
                Text("Полностью локальное приложение: без аккаунтов, аналитики и синхронизации. Уроки импортируются ZIP-архивом из генератора Combine.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("О приложении")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }
    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }
}
