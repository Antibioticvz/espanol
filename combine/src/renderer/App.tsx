import { useState } from 'react'
import type { ParsedLesson, ParserStats } from '../core/types/parsed-lesson'
import type { StartGenerationResult } from '../shared/ipc'
import { ImportScreen } from './components/import/ImportScreen'
import { SettingsScreen } from './components/settings/SettingsScreen'
import { GenerationScreen } from './components/generation/GenerationScreen'
import { LibraryScreen } from './components/library/LibraryScreen'
import { StepNav, type ScreenKey } from './components/layout/StepNav'
import { useGeneration } from './hooks/useGeneration'
import { useSettingsQuery } from './hooks/useSettings'

/** Корневой компонент — простая навигация-стейт между 4 экранами (см. docs/DECISIONS.md D-09). */
export function App(): JSX.Element {
  const [screen, setScreen] = useState<ScreenKey>('import')
  const [parsedLesson, setParsedLesson] = useState<ParsedLesson | null>(null)
  const [parseStats, setParseStats] = useState<ParserStats | null>(null)
  const [apiKey, setApiKey] = useState<string | null>(null)

  const generation = useGeneration()
  const settingsQuery = useSettingsQuery()

  const handleImportNext = (lesson: ParsedLesson, stats: ParserStats): void => {
    setParsedLesson(lesson)
    setParseStats(stats)
    setScreen('settings')
  }

  const handleGenerateClick = (): void => {
    if (!parsedLesson || !settingsQuery.data) return
    generation.start({ lesson: parsedLesson, settings: settingsQuery.data, apiKey })
    setScreen('generation')
  }

  const handleGenerationStartedElsewhere = (result: StartGenerationResult): void => {
    generation.attach(result)
    setScreen('generation')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <StepNav
        current={screen}
        onNavigate={setScreen}
        canGoSettings={parsedLesson !== null}
        canGoGeneration={generation.topicId !== null}
      />

      {screen === 'import' && <ImportScreen onNext={handleImportNext} />}

      {screen === 'settings' && (
        <SettingsScreen
          parseStats={parseStats}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          onBack={() => setScreen('import')}
          onNext={handleGenerateClick}
        />
      )}

      {screen === 'generation' && (
        <GenerationScreen generation={generation} onBack={() => setScreen('settings')} onOpenLibrary={() => setScreen('library')} />
      )}

      {screen === 'library' && (
        <LibraryScreen onBack={() => setScreen('generation')} onGenerationStarted={handleGenerationStartedElsewhere} />
      )}
    </div>
  )
}
