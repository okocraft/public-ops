import { build } from 'esbuild';
for (const action of ['prepare', 'publish']) {
  await build({
    entryPoints: ['src/actions/' + action + '.ts'],
    outfile: 'actions/' + action + '/dist/index.js',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    legalComments: 'none',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
}
