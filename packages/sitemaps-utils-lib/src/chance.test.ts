//chance.test.ts
/// <reference types="jest" />
import { chance } from './chance';

describe('chance', () => {
  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('first round is correct - 0%', () => {
    const chancePercent = 0;
    const chances = new chance({ percent: chancePercent });

    let trueCount = 0;
    for (let i = 0; i < 100; i++) {
      if (chances.takeAChance) {
        trueCount++;
      }
    }

    expect(trueCount).toBe(chancePercent);
  });

  it('first round is correct - 5%', () => {
    const chancePercent = 5;
    const chances = new chance({ percent: chancePercent });

    let trueCount = 0;
    for (let i = 0; i < 100; i++) {
      if (chances.takeAChance) {
        trueCount++;
      }
    }

    expect(trueCount).toBe(chancePercent);
  });

  it('first round is correct - 100%', () => {
    const chancePercent = 100;
    const chances = new chance({ percent: chancePercent });

    let trueCount = 0;
    for (let i = 0; i < 100; i++) {
      if (chances.takeAChance) {
        trueCount++;
      }
    }

    expect(trueCount).toBe(chancePercent);
  });

  it('second round is correct', () => {
    const chancePercent = 5;
    const chances = new chance({ percent: chancePercent });

    let trueCount = 0;
    const firstChances: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      const result = chances.takeAChance;
      firstChances.push(result);
      if (result) {
        trueCount++;
      }
    }
    expect(trueCount).toBe(chancePercent);

    trueCount = 0;
    const secondChances: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      const result = chances.takeAChance;
      secondChances.push(result);
      if (result) {
        trueCount++;
      }
    }
    expect(trueCount).toBe(chancePercent);

    // Make sure the two sets of truth are not in the same order
    expect(firstChances).not.toEqual(secondChances);
  });
});
