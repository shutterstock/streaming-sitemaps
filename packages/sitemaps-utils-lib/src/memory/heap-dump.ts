import path from 'path';
import v8 from 'v8';
import fs from 'fs-extra';
import { ILogger } from '../types';
import { sleep } from '../sleep';

export interface heapdumpOptions {
  readonly dumpAtBytes?: number;
  readonly intervalMS?: number;
  readonly path?: string;
  readonly logger?: ILogger;
}

export class heapdump {
  protected _dumpAtBytes: number;
  protected _monitorPromise: Promise<void> | undefined;
  protected _shuttingDownPromise: Promise<void>;
  protected _shuttingDown: boolean;
  protected _shuttingDownResolve: (() => void) | undefined = undefined;
  protected _intervalMS: number;
  protected _path: string;
  protected _writtenDumpFilenameAndPath: string | undefined;
  protected _writtenDumpFilename: string | undefined;
  protected _wroteDump = false;
  protected _logger: ILogger | undefined;

  /**
   * Monitor memory usage periodically.
   * Write a heap snapshot file when dumpAtBytes is exceeded.
   */
  constructor(options: heapdumpOptions) {
    const { dumpAtBytes = 800 * 1024 * 1024, intervalMS = 2000, path = '/tmp', logger } = options;
    this._dumpAtBytes = dumpAtBytes;
    this._shuttingDown = false;
    this._intervalMS = intervalMS;
    this._path = path;
    this._logger = logger;

    this._shuttingDownPromise = new Promise((resolve) => {
      this._shuttingDownResolve = resolve;
    });

    // Start the monitoring
    this.monitor();
  }

  private monitor() {
    // We create this promise but don't wait for it since it's monitoring memory
    // in the background
    this._monitorPromise = (async (): Promise<void> => {
      // Loop around periodically
      while (!this._shuttingDown) {
        try {
          const timer = new sleep(this._intervalMS);
          await Promise.race([this._shuttingDownPromise, timer.done]);

          if (this._shuttingDown) {
            // We're shutting down, cancel the timer
            timer.cancel();
            return;
          }

          // Check if we need to take a memory dump
          const heapStats = v8.getHeapStatistics();
          if (heapStats.used_heap_size > this._dumpAtBytes) {
            // Log if there is one
            if (this._logger !== undefined) {
              this._logger.error('generating heapdump', { heapStats });
            }

            this.createDump();

            // Bail out - we only do this once
            return;
          }
        } catch {
          // Discard and continue
        }
      }
    })();
  }

  /**
   * Create a memory dump and write it to a file
   * @returns { filename - path to the written file }
   */
  protected createDump(): { filename: string; filenameWithPath: string } {
    const filename = `${new Date().toISOString()}.heapsnapshot`;
    const filenameWithPath = path.join(this._path, filename);

    // Create the memory snapshot
    // https://dev.to/bengl/node-js-heap-dumps-in-2021-5akm
    // https://microsoft.github.io/PowerBI-JavaScript/modules/_node_modules__types_node_v8_d_._v8_.html#getheapsnapshot
    //await fsp.writeFile(filename, v8.getHeapSnapshot());
    v8.writeHeapSnapshot(filenameWithPath);

    // Save the path so we can cleanup later
    this._writtenDumpFilename = filename;
    this._writtenDumpFilenameAndPath = filenameWithPath;
    this._wroteDump = true;

    return { filename, filenameWithPath };
  }

  protected async cleanup(): Promise<void> {
    if (this._writtenDumpFilenameAndPath !== undefined) {
      if (await fs.pathExists(this._writtenDumpFilenameAndPath)) {
        try {
          await fs.unlink(this._writtenDumpFilenameAndPath);
        } catch {
          // nothing
        }
      }
      delete this._writtenDumpFilenameAndPath;
    }
  }

  /**
   * Signal the background loop to exit, return when it's exited
   */
  public async shutdownAndFlush(): Promise<boolean> {
    this._shuttingDown = true;

    if (this._shuttingDownResolve === undefined) {
      throw new Error('this is stupid... this will never happen');
    }

    // Call resolve on the shutdown promise to break out of the sleep
    this._shuttingDownResolve();

    // Wait for the monitor to exit
    await this._monitorPromise;

    // Cleanup after ourselves
    await this.cleanup();

    return this._wroteDump;
  }
}
