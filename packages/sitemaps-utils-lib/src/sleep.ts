// https://stackoverflow.com/a/22707551
// Imported 2021-08-12

export class sleep<T> {
  private _timer: number | undefined; // ReturnType<typeof setTimeout>;
  private _reject: ((reason?: unknown) => void) | undefined;
  private _promise: Promise<void>;

  constructor(delay: number, value?: T) {
    this._promise = new Promise((resolve, reject) => {
      this._reject = reject;
      this._timer = setTimeout(resolve, delay, value);
    });
  }

  public get done(): Promise<void> {
    return this._promise;
  }

  public cancel(): void {
    if (this._timer !== undefined) {
      clearTimeout(this._timer);
      delete this._timer;
      if (this._reject !== undefined) this._reject();
      delete this._reject;
    }
  }
}
