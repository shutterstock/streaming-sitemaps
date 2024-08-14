export class LagStats {
  private _min: number | undefined = undefined;
  private _max: number | undefined = undefined;
  private _count = 0;
  private _sum = 0;

  /**
   * Date must either be local timezone or have timezone specified (e.g. '2020-01-01T00:00:00.000Z')
   * @param value
   */
  public addDateString(value: string): void {
    const time = new Date(value);
    const delta = Math.max(new Date().getTime() - time.getTime(), 0);

    this.addMilliseconds(delta);
  }

  /**
   * Add integer value to stats.
   * @param value time in milliseconds
   */
  public addMilliseconds(value: number): void {
    if (value < 0) {
      throw new Error('LagStats.add value must be >= 0');
    }

    if (this._min === undefined || value < this._min) {
      this._min = value;
    }
    if (this._max === undefined || value > this._max) {
      this._max = value;
    }
    this._count++;
    this._sum += value;
  }

  public get min(): number | undefined {
    return this._min;
  }

  public get max(): number | undefined {
    return this._max;
  }

  public get count(): number {
    return this._count;
  }

  public get sum(): number {
    return this._sum;
  }

  public get avg(): number {
    return this._sum / this._count;
  }
}
