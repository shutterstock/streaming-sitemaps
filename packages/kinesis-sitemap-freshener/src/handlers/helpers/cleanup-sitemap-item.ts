import { Unit as metricUnit } from 'aws-embedded-metrics';
import { FlatCountMetrics } from '@shutterstock/aws-embedded-metrics-flatten';
import { SitemapFreshenerTypedMetrics } from '@shutterstock/sitemaps-metrics-lib';
import { escapeProhibitedPathChars, invisibleCharsRegex } from '@shutterstock/sitemaps-utils-lib';
import traverse from 'traverse';
import { SitemapItemLoose } from 'sitemap';

export function cleanupSitemapItem(opts: {
  item: SitemapItemLoose;
  flatMetricsTyped: FlatCountMetrics;
}) {
  const { item, flatMetricsTyped } = opts;
  const url = escapeProhibitedPathChars(new URL(item.url));
  item.url = url.toString();

  // Scrub all invisible chars
  traverse(item).forEach(function (x) {
    if (x !== null && x !== undefined && typeof x === 'string') {
      if (x.match(invisibleCharsRegex) !== null) {
        this.update(x.replace(invisibleCharsRegex, ''));
        flatMetricsTyped.putMetric(
          SitemapFreshenerTypedMetrics.InvisibleCharsScrubbed,
          1,
          metricUnit.Count,
        );
      }
    }
  });

  // Truncate the durations to the nearest second
  if (item.video !== undefined) {
    if (!Array.isArray(item.video) && item.video.duration !== undefined) {
      item.video.duration = Math.floor(item.video.duration);
    } else if (Array.isArray(item.video)) {
      item.video.forEach((video) => {
        if (video.duration !== undefined) {
          video.duration = Math.floor(video.duration);
        }
      });
    }
  }
}
