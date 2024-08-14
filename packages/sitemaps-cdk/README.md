# Overview

- AWS CDK construct to create set of AWS Lambda functions:
  - Sitemap Writer - Generate XML sitemaps from a stream of sitemap JSON items delivered via an AWS Kinesis stream
  - Index Writer - Maintain an XML sitemap index that is updated when new sitemap XML files are created
  - Freshener - Rebuild the sitemap index and sitemap XML files on demand (this applies changes to older items that were saved to the DB but not written to the XML files immediately)
- Saves record of each item in a DynamoDB table, for deduplication, marking deletes, and to enable the Freshener to rebuild the sitemap index and sitemap XML files on demand

# Usage

[Construct API Documentation](API.md)