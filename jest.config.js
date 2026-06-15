/** Tests cover DECIDE (pure state machine), INGEST parsing, and cue selection — all node-safe. */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // node_modules is a symlink to node_modules.nosync (iCloud eviction guard);
  // ignore the real .nosync path so jest's haste map doesn't see packages twice.
  modulePathIgnorePatterns: ['<rootDir>/node_modules.nosync'],
  haste: { retainAllFiles: false },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          strict: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
