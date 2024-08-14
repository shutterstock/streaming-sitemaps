import http from 'http';
import https from 'https';
import wtfnode from 'wtfnode';
import { ILogger } from '../types';
import { getSocketStats, ISocketStats } from './socket-stats';
import { sleep } from '../sleep';

export interface fdMonitorOptions {
  readonly intervalMS?: number;
  readonly logger: ILogger;
  readonly thresholdCount?: number;
}

export class fdMonitor {
  protected _monitorPromise: Promise<void> | undefined;
  protected _shuttingDownPromise: Promise<void>;
  protected _shuttingDown: boolean;
  protected _shuttingDownResolve: (() => void) | undefined = undefined;
  protected _intervalMS: number;
  protected _logger: ILogger;
  protected _thresholdCount: number;
  protected _httpAgent: http.Agent;
  protected _httpsAgent: https.Agent;

  /**
   * Monitor file descriptors and socket handles periodically.
   * Write a snapshot to the log on close or on interval.
   */
  constructor(options: fdMonitorOptions) {
    const { intervalMS = 1000, logger, thresholdCount = 250 } = options;

    if (logger === undefined) {
      throw new TypeError('logger must be defined');
    }

    this._shuttingDown = false;
    this._intervalMS = intervalMS;
    this._logger = logger;
    this._thresholdCount = thresholdCount;
    this._httpAgent = http.globalAgent;
    this._httpsAgent = https.globalAgent;

    this._shuttingDownPromise = new Promise((resolve) => {
      this._shuttingDownResolve = resolve;
    });

    // Configure logger for wtfnode
    wtfnode.setLogger('info', logger.info);
    wtfnode.setLogger('warn', logger.warn);
    wtfnode.setLogger('error', logger.error);

    // Start the monitoring
    this.monitor();
  }

  private monitor() {
    // We create this promise but don't wait for it since it's monitoring in the background
    this._monitorPromise = (async (): Promise<void> => {
      try {
        // Loop around periodically
        while (!this._shuttingDown) {
          const timer = new sleep(this._intervalMS);

          await Promise.race([this._shuttingDownPromise, timer.done]);

          if (this._shuttingDown) {
            // We're shutting down, cancel the timer
            timer.cancel();
            return;
          }

          // Get socket stats per protocol and host
          const socketStatsHttp = getSocketStats(this._httpAgent);
          const socketStatsHttps = getSocketStats(this._httpsAgent);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const activeHandleCount = ((process as any)._getActiveHandles() as never[]).length;

          // Check if we need to log stats
          if (
            activeHandleCount > this._thresholdCount ||
            socketStatsHttp.all.total > this._thresholdCount ||
            socketStatsHttps.all.total > this._thresholdCount
          ) {
            // Dump socket stats
            this._logger.error('fd threshold exceeded', {
              socketStatsHttp,
              socketStatsHttps,
            });

            // Dump file handle stats
            wtfnode.dump();
          }
        }
      } catch {
        // discard
      }
    })();
  }

  /**
   * Manually dump socket and file descriptor stats
   */
  public manual(): {
    socketStatsHttp: ISocketStats;
    socketStatsHttps: ISocketStats;
  } {
    // Get socket stats per protocol and host
    const socketStatsHttp = getSocketStats(this._httpAgent);
    const socketStatsHttps = getSocketStats(this._httpsAgent);

    // Dump socket stats
    this._logger.error('fd manual log', {
      socketStatsHttp,
      socketStatsHttps,
    });

    // Dump file handle stats
    wtfnode.dump();

    return {
      socketStatsHttp,
      socketStatsHttps,
    };
  }

  /**
   * Manually return socket and handle counts
   */
  public manualSimple(): {
    socketStatsHttp: ISocketStats;
    socketStatsHttps: ISocketStats;
    handleCount: number;
  } {
    // Get socket stats per protocol and host
    const socketStatsHttp = getSocketStats(this._httpAgent);
    const socketStatsHttps = getSocketStats(this._httpsAgent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleCount = ((process as any)._getActiveHandles() as never[]).length;

    return {
      socketStatsHttp,
      socketStatsHttps,
      handleCount,
    };
  }

  /**
   * Signal the background loop to exit, return when it's exited
   */
  public async shutdownAndFlush(): Promise<void> {
    this._shuttingDown = true;

    if (this._shuttingDownResolve === undefined) {
      throw new Error('this is stupid... this will never happen');
    }

    // Call resolve on the shutdown promise to break out of the sleep
    this._shuttingDownResolve();

    // Wait for the monitor to exit
    await this._monitorPromise;
  }
}
