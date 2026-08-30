import nextVitals from 'eslint-config-next/core-web-vitals'
import { defineConfig, globalIgnores } from 'eslint/config'

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '.open-next/**',
    'tmp396/**',
    'tmp-pages-bind/**',
    'prisma.legacy/**',
    'migrations/**',
  ]),
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])

export default eslintConfig
