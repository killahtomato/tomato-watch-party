import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeFixtures } from './harness.mjs';

const workspace = process.env.TWP_E2E_WORKSPACE || join(tmpdir(), 'twp-e2e-workspace');

export default async function globalSetup() {
  const dirs = {
    workspace,
    movies: join(workspace, 'movies'),
    music: join(workspace, 'music'),
    streams: join(workspace, 'streams'),
    data: join(workspace, 'data'),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  await makeFixtures(dirs);
  console.log(`E2E workspace: ${workspace}`);
}
