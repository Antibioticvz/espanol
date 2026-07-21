#!/usr/bin/env node
import { parseArgs } from './args'
import { runParse } from './commands/parse'
import { runGenerate } from './commands/generate'
import { runExport } from './commands/export'
import { runExportAnki } from './commands/export-anki'

function printUsage(): void {
  console.error('Использование: cli <parse|generate|export|export-anki> [опции]')
  console.error('  parse       --input <файл>')
  console.error('  generate    --input <файл-или-папка> --provider mock_say|elevenlabs --out <папка> [--export-zip]')
  console.error('              (папка: все *.txt по алфавиту, последовательно, ошибка одной темы не прерывает остальные)')
  console.error('              [--voice-es <id>] [--voice-ru <id>] [--model <id>] [--api-key <ключ>]')
  console.error('              [--concurrency N] [--max-retries N] [--delay-ms N] [--timeout-ms N]')
  console.error('              [--stability N] [--similarity-boost N] [--seed N] [--no-id3]')
  console.error('  export      --lesson <папка_урока> [--out <файл.zip>]')
  console.error('  export-anki --lesson <папка_урока> [--out <файл.apkg>]')
}

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv.slice(2))
  switch (command) {
    case 'parse':
      return runParse(flags)
    case 'generate':
      return runGenerate(flags)
    case 'export':
      return runExport(flags)
    case 'export-anki':
      return runExportAnki(flags)
    default:
      printUsage()
      return 1
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((e: unknown) => {
    console.error('Необработанная ошибка CLI:', e instanceof Error ? (e.stack ?? e.message) : String(e))
    process.exitCode = 1
  })
