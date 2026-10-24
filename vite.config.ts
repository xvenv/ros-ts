import { defineConfig } from 'vite-plus';

const integration = Boolean(process.env.ROS_HOST);

const layer = (files: string[], group: string[], message: string) => ({
  files,
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group, message }] }] as [
      'error',
      { patterns: { group: string[]; message: string }[] },
    ],
  },
});

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  pack: {
    dts: { generator: 'tsgo' },
    exports: true,
  },
  lint: {
    ignorePatterns: ['draft/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      layer(
        ['src/shared/**/*.ts'],
        ['../protocol/*', '../transport/*', '../client/*'],
        'shared is the bottom layer; it must not import upward',
      ),
      layer(
        ['src/protocol/**/*.ts'],
        ['../transport/*', '../client/*', '../shared/*', '!../shared/index.js'],
        'protocol may import shared only through src/shared/index.ts',
      ),
      layer(
        ['src/transport/**/*.ts'],
        [
          '../client/*',
          '../protocol/*',
          '!../protocol/index.js',
          '../shared/*',
          '!../shared/index.js',
        ],
        'transport may import protocol and shared only through their index.ts',
      ),
      layer(
        ['src/client/**/*.ts'],
        [
          '../protocol/*',
          '../shared/*',
          '!../shared/index.js',
          '../transport/*',
          '!../transport/index.js',
        ],
        'client may import shared and transport only through their index.ts',
      ),
    ],
  },
  fmt: {
    singleQuote: true,
    semi: true,
    printWidth: 88,
  },
  test: {
    include: [
      'test/unit/**/*.test.ts',
      'test/docs/**/*.test.ts',
      ...(integration ? ['test/integration/**/*.test.ts'] : []),
    ],
  },
});
