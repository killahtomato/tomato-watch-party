import { createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = process.env.LOG_FILE || join(__dirname, '..', 'server.log');

const stream = createWriteStream(LOG_FILE, { flags: 'a' });

function timestamp() {
  return new Date().toISOString();
}

function format(level, ...args) {
  const msg = args
    .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
  return `[${timestamp()}] [${level}] ${msg}`;
}

export const logger = {
  info(...args) {
    stream.write(format('INFO', ...args) + '\n');
  },
  warn(...args) {
    stream.write(format('WARN', ...args) + '\n');
  },
  error(...args) {
    stream.write(format('ERROR', ...args) + '\n');
  },
  debug(...args) {
    if (process.env.DEBUG) {
      stream.write(format('DEBUG', ...args) + '\n');
    }
  },
};
