/**
 * @testing-library/react полагается на ГЛОБАЛЬНЫЙ `afterEach` для авто-очистки DOM между тестами.
 * Корневой vitest.config.ts НЕ включает `test.globals: true` (сознательно — чтобы не менять поведение
 * существующих node-тестов ядра, не в моей зоне), поэтому авто-очистка не регистрируется сама.
 * Каждый renderer-тест явно импортирует этот файл (побочный эффект) вместо правки глобального конфига.
 */
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
