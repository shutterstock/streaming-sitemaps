import { shuffle } from 'lodash';

export class chance {
  private readonly _valueCount = 100;
  private _percent: number;
  private _values: boolean[];
  private _index: number;

  /**
   * Shuffle an array of [percent] count of true values.
   * Maintain an index of call counts.
   * Return true or false depending on array value at index.
   * Reshuffle when the end of the array is reached.
   */
  constructor(options: { percent: number }) {
    const { percent } = options;

    if (percent === undefined) {
      throw new TypeError('percent is required');
    }
    if (percent < 0 || percent > 100) {
      throw new RangeError('precent must be between 0 and 100, inclusive');
    }

    this._percent = percent;
    this._index = 0;

    // Set the exact number of true returns we'll have per 100
    this._values = [];
    for (let i = 0; i < this._valueCount; i++) {
      if (i < this._percent) {
        this._values.push(true);
      } else {
        this._values.push(false);
      }
    }

    // Shuffle the order in which the true's return
    this._values = shuffle(this._values);
  }

  /**
   * Take our chances.
   */
  public get takeAChance(): boolean {
    if (this._percent === 0) {
      return false;
    } else if (this._percent === 100) {
      return true;
    }
    if (this._index === this._valueCount) {
      this._index = 0;
      this._values = shuffle(this._values);
    }
    return this._values[this._index++];
  }
}
