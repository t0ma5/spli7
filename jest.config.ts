import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Date-only values (expenseDate) are carried at UTC midnight. A host at UTC
// takes the passing side of the west-of-UTC grouping defect, so the suite is
// pinned to America/Los_Angeles (see jest.environment.ts).
const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: '<rootDir>/jest.environment.ts',
  testEnvironmentOptions: { tz: 'America/Los_Angeles' },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  modulePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.open-next/'],
  transformIgnorePatterns: ['/node_modules/(?!(nanoid)/)'],
}

export default createJestConfig(config)
