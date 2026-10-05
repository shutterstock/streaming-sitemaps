module.exports = {
  preset: 'ts-jest',
  roots: ['<rootDir>/packages/'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/coverage/'],
  testEnvironment: 'node',
  testTimeout: 61000,
  moduleFileExtensions: ['ts', 'js'],
  setupFiles: ['./setupBeforeEnv.js'],
  setupFilesAfterEnv: ['./setupAfterEnv.cjs'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  collectCoverage: true,
  // Include unimported source so missing tests remain visible. V8 uses source
  // maps for CLI integration tests that load unbundled commands.
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    '!packages/**/*.test.ts',
    '!packages/**/src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageProvider: 'v8',
  coverageReporters: ['lcov', 'html', 'text', 'json-summary'],
};
