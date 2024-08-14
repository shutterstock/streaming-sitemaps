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
   * CloudWatch metrics namespace
   *
   * Environment variable: METRICS_NAMESPACE
   *
   * @default 'SSTK/Sitemaps'
   */
  readonly metricsNamespace: string;

  /**
   * S3 sitemap files bucket name
   *
   * Environment variable: S3_SITEMAPS_BUCKET_NAME
   *
   * @default 'doc-example-bucket'
   */
  readonly s3SitemapsBucketName: string;

  /**
   * gzip compress the sitemap XML files, saving as .xml.gz
   *
   * ⚠️ CAUTION: Compressing and uncompressing sitemap files is very CPU intensive.
   * This severely limits the throughput rate and increases the Lambda runtime cost.
   *
   * Environment variable: COMPRESS_SITEMAP_FILES
   *
   * @default false
   */
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
   * DynamoDB table name
   *
   * Environment variable: TABLE_NAME
   *
   * @default 'sitemaps'
   */
  readonly tableName: string;

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
    default: 'sitemaps',
    env: 'TABLE_NAME',
  })
  public tableName!: string;

  @convict.Property({
    default: [],
    env: 'INFIX_DIRS',
  })
  public infixDirs!: string[];
}
