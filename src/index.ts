import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import { createRequire } from 'module';
import { expressiumRoute, loggerUtil, startServer, createServer } from '../expressium/index.js';
import { appRoute } from './routes/index.js';
import { createSigmaCloudEventsService } from './services/index.js';

const require = createRequire(import.meta.url);

const helmet = require('helmet');

const MONITORING_INTERVAL = 60_000;

const createSequentialInterval = async (
  handler: () => Promise<void>, 
  interval: number
): Promise<void> => {
  const executeWithDelay = async (): Promise<void> => {
    await handler();
    setTimeout(executeWithDelay, interval).unref();
  };

  executeWithDelay();
};

const buildServer = async (): Promise<void> => {
  try {
    const app = express();

    app.use(cors());
    app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
    app.use(express.json());
    appRoute.buildRoutes();
    app.use('/api', expressiumRoute.router);

    app.use(
      (
        _req: Request, 
        res: Response
      ): void => {
        res
          .status(404)
          .json(
            {
              message: 'Route not found.',
              suggestion: 'Please check the URL and HTTP method to ensure they are correct.'
            }
          );
      }
    );

    const serverInstance = await createServer(app);
    
    await startServer(serverInstance as Express);

    createSequentialInterval(
      async (): Promise<void> => createSigmaCloudEventsService.createSigmaCloudEvents(new Set<string>(['ALI', 'ALR', 'BEM', 'CER', 'IVA', 'PAB', 'PIN'])), 
      MONITORING_INTERVAL
    );
  } catch (error: unknown) {
    loggerUtil.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

buildServer();
