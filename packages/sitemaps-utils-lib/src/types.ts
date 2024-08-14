/* eslint-disable @typescript-eslint/ban-types */
export interface ILogger {
  readonly info: (msg: string, meta?: object | undefined) => void;
  readonly warn: (msg: string, meta?: object | undefined) => void;
  readonly error: (msg: string | Error, meta?: object | undefined) => void;
}
