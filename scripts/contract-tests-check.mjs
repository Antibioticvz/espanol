#!/usr/bin/env node
/**
 * Прогоняет ajv по shared/contract-tests/manifest.json: для каждого вектора сверяет фактический
 * результат ajv-валидации против shared/lesson.schema.json с заявленным полем `valid`. Падает
 * (exit 1) при любом расхождении — как в самих векторах, так и в целостности манифеста/каталога.
 *
 * Это общий conformance-набор контракта lesson.json — подключается и Combine (этот скрипт,
 * npm test), и позже iOS-стороной (Codable-тесты на те же shared/contract-tests/vectors/*.json).
 *
 * Запуск (пути внутри анкерятся на расположение САМОГО скрипта через import.meta.url, поэтому
 * работает из любой cwd):
 *   node scripts/contract-tests-check.mjs        (cwd = корень репозитория)
 *   node ../scripts/contract-tests-check.mjs     (cwd = combine/)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const WORKTREE_ROOT = resolve(SCRIPT_DIR, '..')
const SCHEMA_PATH = join(WORKTREE_ROOT, 'shared', 'lesson.schema.json')
const CONTRACT_DIR = join(WORKTREE_ROOT, 'shared', 'contract-tests')
const VECTORS_DIR = join(CONTRACT_DIR, 'vectors')
const MANIFEST_PATH = join(CONTRACT_DIR, 'manifest.json')

let failed = 0
const fail = (msg) => {
  console.error(`❌ ${msg}`)
  failed++
}

let schema
try {
  schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
} catch (e) {
  console.error(`❌ Не удалось прочитать/распарсить схему ${SCHEMA_PATH}: ${e.message}`)
  process.exit(1)
}

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)

let manifest
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
} catch (e) {
  console.error(`❌ Не удалось прочитать/распарсить манифест ${MANIFEST_PATH}: ${e.message}`)
  process.exit(1)
}

if (!Array.isArray(manifest)) {
  console.error(`❌ manifest.json должен быть массивом [{file, valid, note}], получено: ${typeof manifest}`)
  process.exit(1)
}
if (manifest.length === 0) {
  console.error('❌ manifest.json пуст — нечего проверять.')
  process.exit(1)
}

console.log(`▶ Контрактные векторы lesson.json: ${manifest.length} шт.`)
console.log(`  схема:   ${SCHEMA_PATH}`)
console.log(`  манифест: ${MANIFEST_PATH}\n`)

// 1. Каждая запись манифеста: файл существует, парсится, ajv-результат совпадает с заявленным.
const manifestFiles = new Set()
for (const entry of manifest) {
  const { file, valid: expectedValid, note, appRejects } = entry
  if (typeof file !== 'string' || typeof expectedValid !== 'boolean') {
    fail(`некорректная запись манифеста (нужны file:string и valid:boolean): ${JSON.stringify(entry)}`)
    continue
  }
  manifestFiles.add(file)

  const vectorPath = join(CONTRACT_DIR, file)
  let data
  try {
    data = JSON.parse(readFileSync(vectorPath, 'utf8'))
  } catch (e) {
    fail(`${file}: не удалось прочитать/распарсить (${e.message})`)
    continue
  }

  const actualValid = validate(data)
  const tag = appRejects ? ' [appRejects]' : ''
  if (actualValid === expectedValid) {
    console.log(`✅ ${file}${tag} — valid=${actualValid} (ожидалось ${expectedValid})${note ? ` — ${note}` : ''}`)
  } else {
    fail(`${file}${tag} — valid=${actualValid}, ОЖИДАЛОСЬ ${expectedValid}${note ? ` — ${note}` : ''}`)
    if (!actualValid) console.error('   ajv errors:', JSON.stringify(validate.errors, null, 2))
  }
}

// 2. Целостность: каждый *.json в vectors/ должен быть перечислен в манифесте (иначе он молча
//    не проверяется вообще — это не менее опасное расхождение, чем неверный valid).
let diskFiles
try {
  diskFiles = readdirSync(VECTORS_DIR).filter((f) => f.endsWith('.json'))
} catch (e) {
  fail(`не удалось прочитать каталог векторов ${VECTORS_DIR}: ${e.message}`)
  diskFiles = []
}
for (const f of diskFiles) {
  const relPath = `vectors/${f}`
  if (!manifestFiles.has(relPath)) {
    fail(`vectors/${f} лежит на диске, но не упомянут в manifest.json — не проверяется вообще.`)
  }
}

console.log(`\n${manifest.length - failed >= 0 ? manifest.length - failed : 0} совпало / ${failed} расхождений (векторов: ${manifest.length}, файлов на диске: ${diskFiles.length}).`)

if (failed > 0) {
  console.error('\n❌ contract-tests-check: расхождения найдены (см. выше).')
  process.exit(1)
}
console.log('\n✅ contract-tests-check: все векторы соответствуют заявленному valid, манифест и каталог согласованы.')
