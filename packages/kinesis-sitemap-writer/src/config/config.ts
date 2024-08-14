import * as convict from 'ts-convict';
import * as yaml from 'js-yaml';
import { url, ipaddress } from 'convict-format-with-validator';
import { files } from '@shutterstock/sitemaps-utils-lib';
const { configFiles } = files;

export type SitemapFileNamingSchemes = 'uuidv4' | 'date+index' | 'index';

export interface IConfig {
  /**
   * AWS Account ID for app Lambda function
   *
   * Environment variable: AWS_ACCOUNT_ID
   */
  readonly awsAccountID: number;

  /**
   * AWS Region for app Lambda function
   *
   * Environment variable: AWS_REGION
   */
  readonly awsRegion: string;

  /**
   * Base URL of the website
   *
   * Environment variable: SITE_BASE_URL
   *
   * @default 'https://www.example.com'
   */
  readonly siteBaseURL: string;

  /**
   * Base path of the sitemaps on the website (for sitemap index links)
   *
   * Environment variable: SITE_BASE_SITEMAP_PATH
   *
   * @default 'sitemaps'
   */
  readonly siteBaseSitemapPath: string;

  /**
   * S3 sitemap files bucket name
   *
   * Environment variable: S3_SITEMAPS_BUCKET_NAME
   *
   * @default 'doc-example-bucket'
   */
  readonly s3SitemapsBucketName: string;

  readonly compressSitemapFiles: boolean;

  /**
   * Local directory to write files into
   *
   * Environment variable: LOCAL_DIRECTORY
   *
   * @default '/tmp/sitemaps'
   */
  readonly localDirectory: string;

  /**
   * S3 directory to write files into
   *
   * Environment variable: S3_DIRECTORY
   *
   * @default 'sitemaps/'
   */
  readonly s3Directory: string;

  /**
   * CloudWatch metrics namespace
   *
   * Environment variable: METRICS_NAMESPACE
   *
   * @default 'SSTK/Sitemaps'
   */
  readonly metricsNamespace: string;

  /**
   * Emit CloudWatch metrics to logs
   *
   * Environment variable: EMIT_METRICS
   *
   * @default false
   */
  readonly emitMetrics: boolean;

  /**
   * Silence the logs
   *
   * Environment variable: LOG_SILENT
   *
   * @default false
   */
  readonly logSilent: boolean;

  /**
   * Naming scheme for sitemap files
   *
   * Environment variable: SITEMAP_FILE_NAMING_SCHEME
   *
   * @default 'date+index'
   */
  readonly sitemapFileNamingScheme: SitemapFileNamingSchemes;

  /**
   * DynamoDB table name
   *
   * Environment variable: TABLE_NAME
   *
   * @default 'sitemaps'
   */
  readonly tableName: string;

  /**
   * Store item state in DynamoDB
   *
   * ⚠️ CAUTION: NOT storing item state in DynamoDB will disable
   * de-duplication of incoming items - if there are duplicates, they
   * will get written to a new sitemap file each time they are received.
   *
   * Environment variable: ITEM_STATE_IN_DYNAMODB
   *
   * @default true
   */
  readonly storeItemStateInDynamoDB: boolean;

  /**
   * Max number of items per sitemap
   *
   * Environment variable: ITEMS_PER_SITEMAP_LIMIT
   *
   * @default 50000
   */
  readonly itemsPerSitemapLimit: number;

  /**
   * Kinesis sitemap index writer stream name (stream we are writing to)
   *
   * Environment variable: KINESIS_INDEX_WRITER_NAME
   *
   * @default 'sitemap-index-writer'
   */
  readonly kinesisIndexWriterStreamName: string;

  /**
   * Max number of concurrent writes to DynamoDB
   *
   * Environment variable: DYNAMODB_CONCURRENT_WRITES
   *
   * @default 5
   */
  readonly dynamoDBConcurrentWrites: number;

  /**
   * Max number of concurrent reads from DynamoDB
   *
   * Environment variable: DYNAMODB_CONCURRENT_READS
   *
   * @default 2
   */
  readonly dynamoDBConcurrentReads: number;

  /**
   * Max number of unread items to prefetch from DynamoDB
   * Applies back pressure to ensure that we don't read too far ahead
   *
   * Environment variable: DYNAMODB_PREFETCH_MAX_UNREAD
   *
   * @default 4
   */
  readonly dynamoDBPrefetchMaxUnread: number;

  /**
   * Max number of concurrent writes to S3
   *
   * Environment variable: S3_CONCURRENT_WRITES
   *
   * @default 4
   */
  readonly s3ConcurrentWrites: number;

  /**
   * Throw if incoming record with compaction version is encounted in Kinesis messages
   *
   * Environment variable: THROW_ON_COMPACT_VERSION
   *
   * @default 0
   */
  readonly throwOnCompactVersion: number;

  /**
   * Incoming compaction version expected in the Kinesis messages
   *
   * Environment variable: INCOMING_COMPACT_VERSION
   *
   * @default 0
   */
  readonly incomingCompactVersion: number;

  /**
   * Self Kinesis stream name for compaction writes
   *
   * Environment variable: KINESIS_SELF_STREAM_NAME
   *
   * @default 'sitemaps'
   */
  readonly kinesisSelfStreamName: string;

  /**
   * List of infixes to write as additional sitemap indices / sitemap sets.
   *
   * The infix is written between the host and root path on the `url.loc` field in the sitemap items.
   * Url: `https://www.example.com/sitemaps/target.html`
   *      --> `https://www.example.com/{infix}/sitemaps/target.html`
   *
   * The infix is also written to the end of the root folder path for the sitemap index and sitemaps.
   * Index: `s3://{bucket}/sitemaps/index.xml`
   *        --> `s3://{bucket}/sitemaps/index-{infix}.xml`
   * Sitemap: `s3://{bucket}/sitemaps/files/sitemap-00001.xml`
   *          --> `s3://{bucket}/sitemaps/files/{infix}/{infix}-sitemap-00001.xml`
   *
   * Only the `url.loc` and `url.lastmod` fields are written to the infix sitemaps as these files
   * need to be smaller than the primary sitemaps since the infix sitemaps will be written to
   * files with the same name, and same item population, and will simply fail to write all the
   * items if a single sitemap file overflows (what fits will be written).
   *
   * The infix items, sitemap file states, and index file states are not written to the DB.
   * These files are only written as a duplicate / trimmed version of the primary sitemap.
   * The sitemap and index infix files are not retrieved from S3 for updating: they are
   * simply recalculated and re-written from the primary file contents.
   *
   * Environment variable: INFIX_DIRS
   *
   * @default []
   *
   * @example ['target', 'target2']
   */
  readonly infixDirs: string[];
}

@convict.Config({
  // optional default file to load, no errors if it doesn't exist
  file: 'config.yml', // relative to NODE_PATH or cwd()

  // optional parameter. Defaults to 'strict', can also be 'warn'
  validationMethod: 'strict',

  // optionally add parsers like yaml or toml
  parser: {
    extension: ['yml', 'yaml'],
    parse: yaml.load,
  },

  // optional extra formats to use in validation
  formats: {
    url,
    ipaddress,
  },
})
export class Config implements IConfig {
  private static _instance: IConfig;
  public static get instance(): IConfig {
    if (Config._instance === undefined) {
      const configLoader = new convict.TSConvict<Config>(Config);
      Config._instance = configLoader.load(Config.configFiles);
    }
    return Config._instance;
  }

  private static _envLevel: string | undefined;
  public static get envLevel(): string | undefined {
    if (Config._envLevel === undefined) {
      Config._envLevel = configFiles.getEnvLevel();
    }
    return Config._envLevel;
  }

  private static _configFiles: string[];
  public static get configFiles(): string[] {
    if (Config._configFiles === undefined) {
      Config._configFiles = configFiles.getConfigFiles({
        checkEnvOverrides: true,
      });
    }
    return Config._configFiles;
  }

  @convict.Property({
    default: 0,
    env: 'AWS_ACCOUNT_ID',
  })
  public awsAccountID!: number;

  @convict.Property({
    default: 'us-east-1',
    env: 'AWS_REGION',
  })
  public awsRegion!: string;

  @convict.Property({
    default: 'https://www.example.com',
    env: 'SITE_BASE_URL',
  })
  public siteBaseURL!: string;

  @convict.Property({
    default: 'sitemaps',
    env: 'SITE_BASE_SITEMAP_PATH',
  })
  public siteBaseSitemapPath!: string;

  @convict.Property({
    default: 'doc-example-bucket',
    env: 'S3_SITEMAPS_BUCKET_NAME',
  })
  public s3SitemapsBucketName!: string;

  @convict.Property({
    default: false,
    env: 'COMPRESS_SITEMAP_FILES',
  })
  public compressSitemapFiles!: boolean;

  @convict.Property({
    default: 'SSTK/Sitemaps',
    env: 'METRICS_NAMESPACE',
  })
  public metricsNamespace!: string;

  @convict.Property({
    default: '/tmp/sitemaps',
    env: 'LOCAL_DIRECTORY',
  })
  public localDirectory!: string;

  @convict.Property({
    default: 'sitemaps/',
    env: 'S3_DIRECTORY',
  })
  public s3Directory!: string;

  @convict.Property({
    default: false,
    env: 'EMIT_METRICS',
  })
  public emitMetrics!: boolean;

  @convict.Property({
    default: false,
    env: 'LOG_SILENT',
  })
  public logSilent!: boolean;

  @convict.Property({
    default: 'date+index',
    env: 'SITEMAP_FILE_NAMING_SCHEME',
  })
  public sitemapFileNamingScheme!: SitemapFileNamingSchemes;

  @convict.Property({
    default: 'sitemaps',
    env: 'TABLE_NAME',
  })
  public tableName!: string;

  @convict.Property({
    default: true,
    env: 'ITEM_STATE_IN_DYNAMODB',
  })
  public storeItemStateInDynamoDB!: boolean;

  @convict.Property({
    default: 50000,
    env: 'ITEMS_PER_SITEMAP_LIMIT',
  })
  public itemsPerSitemapLimit!: number;

  @convict.Property({
    default: 'sitemap-index-writer',
    env: 'KINESIS_INDEX_WRITER_NAME',
  })
  public kinesisIndexWriterStreamName!: string;

  @convict.Property({
    default: 20,
    env: 'DYNAMODB_CONCURRENT_WRITES',
  })
  public dynamoDBConcurrentWrites!: number;

  @convict.Property({
    default: 4,
    env: 'S3_CONCURRENT_WRITES',
  })
  public s3ConcurrentWrites!: number;

  @convict.Property({
    default: 2,
    env: 'DYNAMODB_CONCURRENT_READS',
  })
  public dynamoDBConcurrentReads!: number;

  @convict.Property({
    default: 4,
    env: 'DYNAMODB_PREFETCH_MAX_UNREAD',
  })
  public dynamoDBPrefetchMaxUnread!: number;

  @convict.Property({
    default: 0,
    env: 'INCOMING_COMPACT_VERSION',
  })
  public incomingCompactVersion!: number;

  @convict.Property({
    default: 0,
    env: 'THROW_ON_COMPACT_VERSION',
  })
  public throwOnCompactVersion!: number;

  @convict.Property({
    default: 'sitemaps',
    env: 'KINESIS_SELF_STREAM_NAME',
  })
  public kinesisSelfStreamName!: string;

  @convict.Property({
    default: [],
    env: 'INFIX_DIRS',
  })
  public infixDirs!: string[];
}
