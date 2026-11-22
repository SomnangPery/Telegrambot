// Loads the repo-root .env no matter which package a script is started from.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

function findRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export const ROOT_DIR = findRoot(process.cwd());
config({ path: join(ROOT_DIR, '.env') });
process.env.TZ ??= 'Asia/Phnom_Penh';
