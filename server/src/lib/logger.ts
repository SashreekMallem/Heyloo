import fs from 'node:fs';
import path from 'node:path';

import pino from 'pino';

import { env } from '../config/env.js';

const logDir = path.resolve(process.cwd(), 'server/logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const fileDestination = pino.destination({
  dest: path.join(logDir, 'server.log'),
  sync: false,
  mkdir: true
});

const consoleDestination =
  env.NODE_ENV === 'development'
    ? await pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      })
    : pino.destination(1);

export const logger = pino(
  {
    name: 'heyloo-server',
    level: env.LOG_LEVEL,
    base: undefined
  },
  pino.multistream([
    { stream: consoleDestination },
    { stream: fileDestination }
  ])
);
