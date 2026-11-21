import { resolve } from 'node:path';
import type { StorybookConfig } from '@storybook/react-vite';
import { normalizePath } from 'vite';

const generatedPaths = ['data', 'dist', 'public/item-catalog', 'storybook-static'].flatMap(directory => {
  const path = normalizePath(resolve(import.meta.dirname, '..', directory));
  return [path, `${path}/**`];
});

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  staticDirs: [
    { from: '../public/favicon.png', to: '/favicon.png' },
    { from: '../public/licenses', to: '/licenses' },
  ],
  viteFinal: config => ({
    ...config,
    publicDir: false,
    server: {
      ...config.server,
      watch: {
        ...config.server?.watch,
        ignored: [...[config.server?.watch?.ignored ?? []].flat(), ...generatedPaths],
      },
    },
  }),
};

export default config;
