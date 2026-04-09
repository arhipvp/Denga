import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const targets = [
  'apps/web/.next',
  'packages/shared/dist',
  'coverage',
  'tmp',
];

for (const target of targets) {
  rmSync(resolve(process.cwd(), target), {
    force: true,
    recursive: true,
  });
}
