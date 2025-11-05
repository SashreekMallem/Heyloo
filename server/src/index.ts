import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { createApp } from './app.js';
import { startAllCronJobs } from './jobs/cron.js';

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV },
    'Heyloo voice API server is running'
  );
  
  // Start automated cron jobs
  startAllCronJobs();
  logger.info('Automated cron jobs initialized');
});
