import { LagStats } from './lag-stats';

describe('lag stats', () => {
  it('init works', () => {
    const lagStats = new LagStats();
    expect(lagStats.count).toBe(0);
    expect(lagStats.sum).toBe(0);
    expect(lagStats.min).toBeUndefined();
    expect(lagStats.max).toBeUndefined();
    expect(lagStats.avg).toBeNaN();
  });

  describe('addMilliseconds', () => {
    it('adding a min and a max works', () => {
      const lagStats = new LagStats();

      lagStats.addMilliseconds(1);
      lagStats.addMilliseconds(2);

      expect(lagStats.count).toBe(2);
      expect(lagStats.sum).toBe(3);
      expect(lagStats.min).toBe(1);
      expect(lagStats.max).toBe(2);
      expect(lagStats.avg).toBe(1.5);
    });

    it('throws on negative', () => {
      const lagStats = new LagStats();

      expect(() => lagStats.addMilliseconds(-1)).toThrow('LagStats.add value must be >= 0');
    });
  });

  describe('addDateString', () => {
    it('adding a min and a max works', () => {
      const lagStats = new LagStats();
      const base = new Date();
      const baseMinus10Minutes = new Date(base.getTime() - 10 * 60 * 1000);
      const baseMinus1Day = new Date(base.getTime() - 24 * 60 * 60 * 1000);

      lagStats.addDateString(baseMinus10Minutes.toISOString());
      lagStats.addDateString(baseMinus1Day.toISOString());

      expect(lagStats.count).toBe(2);
      expect(lagStats.sum).toBeGreaterThanOrEqual(10 * 60 * 1000 + 24 * 60 * 60 * 1000);
      expect(lagStats.sum).toBeLessThanOrEqual(10 * 60 * 1000 + 24 * 60 * 60 * 1000 + 200);
      expect(lagStats.min).toBeGreaterThanOrEqual(10 * 60 * 1000);
      expect(lagStats.min).toBeLessThanOrEqual(10 * 60 * 1000 + 200);
      expect(lagStats.max).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
      expect(lagStats.max).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 200);
      expect(lagStats.avg).toBeGreaterThanOrEqual((10 * 60 * 1000 + 24 * 60 * 60 * 1000) / 2);
      expect(lagStats.avg).toBeLessThanOrEqual((10 * 60 * 1000 + 24 * 60 * 60 * 1000) / 2 + 100);
    });
  });
});
