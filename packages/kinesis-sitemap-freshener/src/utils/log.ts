// reflect-metadata wants to be imported first so we have to import
// it before the Config since we're importing the Config before the
// handler
import 'reflect-metadata';
import { LambdaLog, LogMessage } from 'lambda-log';
import { Config } from '../config/config';

const config = Config.instance;

const localTesting = process.env.DEBUG ? true : false;

const log = new LambdaLog({
  dev: localTesting,
  debug: localTesting,
  silent: config?.logSilent ?? false,
});

if (localTesting) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  log.options.dynamicMeta = (_message: LogMessage) => {
    return {
      timestamp: new Date().toISOString(),
    };
  };
}

export { log, localTesting };
