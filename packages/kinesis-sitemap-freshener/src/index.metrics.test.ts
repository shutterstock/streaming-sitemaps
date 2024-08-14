import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import { getFlatCountMetricsForType, flushTypedMetrics } from '.';
import { MetricsLogger, Unit } from 'aws-embedded-metrics';

describe('getFlatCountMetricsForType', () => {
  let flatMetricsTypedMap: Map<string, FlatCountMetrics>;
  let metrics: MetricsLogger;
  let newMetrics: MetricsLogger;

  beforeEach(() => {
    flatMetricsTypedMap = new Map();
    // @ts-expect-error incomplete for tests
    newMetrics = {
      flush: jest.fn().mockResolvedValue(undefined),
      putDimensions: jest.fn(),
      putMetric: jest.fn(),
    };
    // @ts-expect-error incomplete for tests
    metrics = {
      new: jest.fn().mockReturnValue(newMetrics),
      flush: jest.fn().mockResolvedValue(undefined),
      putDimensions: jest.fn(),
      putMetric: jest.fn(),
    };
  });

  it('should return existing FlatCountMetrics for a type', () => {
    const existingMetrics = new FlatCountMetrics();
    flatMetricsTypedMap.set('existingType', existingMetrics);

    const result = getFlatCountMetricsForType('existingType', flatMetricsTypedMap);

    expect(result).toBe(existingMetrics);
  });

  it('should create and return new FlatCountMetrics for a type if it does not exist', () => {
    const result = getFlatCountMetricsForType('newType', flatMetricsTypedMap);

    expect(result).toBeInstanceOf(FlatCountMetrics);
    expect(flatMetricsTypedMap.get('newType')).toBe(result);
  });

  it('should output single value metrics', async () => {
    const flatMetricsTyped = {
      putMetric: jest.fn(),
      flush: jest.fn(),
    } as unknown as FlatCountMetrics;
    flatMetricsTyped.putMetric('SomeMetric', 1, Unit.Count);
    flatMetricsTypedMap.set('type', flatMetricsTyped);

    await flushTypedMetrics(flatMetricsTypedMap, metrics);

    expect(metrics.new).toHaveBeenCalled();
    expect(newMetrics.putDimensions).toHaveBeenCalled();
    expect(newMetrics.flush).toHaveBeenCalled();
    expect(flatMetricsTyped.flush).toHaveBeenCalled();
  });
});
