import { existsSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';
import { STREAM_DIR, getDataDir } from './streamManager.js';
import { logger } from './logger.js';

const LEGACY_FILES = ['order.json', 'skip_profiles.json'];

export function migrateLegacyStateFiles() {
  const target = getDataDir();
  if (target === STREAM_DIR) return;

  for (const file of LEGACY_FILES) {
    const from = join(STREAM_DIR, file);
    const to = join(target, file);
    try {
      if (!existsSync(from) || existsSync(to)) continue;
      mkdirSync(target, { recursive: true });
      renameSync(from, to);
      logger.info(`Migrated ${file} to ${target}`);
    } catch (err) {
      logger.warn(`Could not migrate ${file}: ${err.message}`);
    }
  }
}
