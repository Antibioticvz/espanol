import SwiftUI

/// Экран 2: выбор фраз для сессии (спека §4.4).
struct PhraseSelectionView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var vm: PhraseSelectionViewModel?

    var body: some View {
        Group {
            if let vm {
                content(vm)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Выбор фраз")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Назад") { env.sessionFlow.step = .pickLesson }
            }
        }
        .task {
            if vm == nil, let lesson = env.sessionFlow.lesson {
                vm = PhraseSelectionViewModel(lesson: lesson, initialSelection: env.sessionFlow.selectedPhraseIds)
            }
        }
    }

    private func content(_ vm: PhraseSelectionViewModel) -> some View {
        @Bindable var vm = vm
        return VStack(spacing: 0) {
            filterBar(vm)
            List {
                ForEach(vm.learnableBlocks, id: \.objectID) { block in
                    blockSection(block, vm: vm)
                }
            }
            .listStyle(.plain)
            .searchable(text: $vm.searchText, prompt: "Поиск фраз (ES или RU)")

            footer(vm)
        }
    }

    private func filterBar(_ vm: PhraseSelectionViewModel) -> some View {
        @Bindable var vm = vm
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                filterChip("Все", isOn: vm.statusFilter == nil) { vm.statusFilter = nil }
                ForEach(PhraseState.allCases) { state in
                    filterChip(state.titleRu, isOn: vm.statusFilter == state) { vm.statusFilter = state }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }

    private func filterChip(_ title: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.caption)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(isOn ? Color.accentColor : Color.gray.opacity(0.15))
                .foregroundStyle(isOn ? .white : .primary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func blockSection(_ block: LessonBlock, vm: PhraseSelectionViewModel) -> some View {
        let phrasesDirect = vm.visiblePhrases(in: block)
        Section {
            if vm.expandedBlockIds.contains(block.blockId) {
                if block.blockTypeEnum?.hasGroups == true {
                    ForEach(block.orderedGroups, id: \.objectID) { group in
                        groupRows(group, vm: vm)
                    }
                } else {
                    ForEach(phrasesDirect, id: \.objectID) { phrase in
                        phraseRow(phrase, vm: vm)
                    }
                }
            }
        } header: {
            Button { vm.toggleBlock(block) } label: {
                HStack {
                    Image(systemName: vm.expandedBlockIds.contains(block.blockId) ? "chevron.down" : "chevron.right")
                    Text(block.titleRu).font(.subheadline.weight(.semibold))
                    Spacer()
                }
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private func groupRows(_ group: PhraseGroup, vm: PhraseSelectionViewModel) -> some View {
        let phrases = vm.visiblePhrases(in: group)
        if !phrases.isEmpty {
            Button { vm.toggleGroup(group) } label: {
                HStack {
                    Image(systemName: vm.isGroupExpanded(group) ? "chevron.down" : "chevron.right")
                        .font(.caption)
                    Text(group.displayTitle).font(.caption.weight(.medium))
                    Spacer()
                    Text("\(phrases.count)").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            if vm.isGroupExpanded(group) {
                ForEach(phrases, id: \.objectID) { phrase in
                    phraseRow(phrase, vm: vm).padding(.leading, 12)
                }
            }
        }
    }

    private func phraseRow(_ phrase: Phrase, vm: PhraseSelectionViewModel) -> some View {
        Button { vm.toggle(phrase) } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: vm.isSelected(phrase) ? "checkmark.square.fill" : "square")
                    .foregroundStyle(vm.isSelected(phrase) ? Color.accentColor : Color.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(phrase.textEs).font(.subheadline)
                    Text(phrase.textRu).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                StateIndicator(state: phrase.stateEnum)
            }
        }
        .buttonStyle(.plain)
    }

    private func footer(_ vm: PhraseSelectionViewModel) -> some View {
        VStack(spacing: 8) {
            HStack {
                Button("Выбрать все") { vm.selectAllVisible() }.font(.caption)
                Spacer()
                Button("Очистить") { vm.clearAll() }.font(.caption)
                Spacer()
                Button("Инвертировать") { vm.invert() }.font(.caption)
            }
            ProgressBarView(value: Double(vm.selectedCount) / Double(max(1, vm.totalCount)))
            HStack {
                Text("Выбрано: \(vm.selectedCount) из \(vm.totalCount)")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button {
                    env.sessionFlow.selectedPhraseIds = vm.lesson.allLearnablePhrases
                        .map(\.phraseId)
                        .filter { vm.selectedIds.contains($0) }
                    env.sessionFlow.config.phraseIds = env.sessionFlow.selectedPhraseIds
                    env.sessionFlow.step = .config
                } label: {
                    Label("Далее", systemImage: "arrow.right")
                }
                .buttonStyle(.borderedProminent)
                .disabled(vm.selectedCount == 0)
            }
        }
        .padding()
        .background(.bar)
    }
}
