import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getDataDir } from './streamManager.js';
import { logger } from './logger.js';

const POLICY_FILE = join(getDataDir(), 'resume_policy.json');
const DEFAULTS = { resumeOnStart: true };

function readPolicy() {
  try {
    const raw = JSON.parse(readFileSync(POLICY_FILE, 'utf8'));
    return { resumeOnStart: typeof raw.resumeOnStart === 'boolean' ? raw.resumeOnStart : DEFAULTS.resumeOnStart };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getResumePolicy() {
  return readPolicy();
}

export function setResumePolicy(resumeOnStart) {
  const clean = { resumeOnStart: Boolean(resumeOnStart) };
  mkdirSync(getDataDir(), { recursive: true });
  const tmp = `${POLICY_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(clean));
  renameSync(tmp, POLICY_FILE);
  logger.info(`Resume policy saved: resumeOnStart=${clean.resumeOnStart}`);
  return clean;
}

export function logResumePolicyPath() {
  logger.info(`Resume policy file: ${POLICY_FILE}`);
}
