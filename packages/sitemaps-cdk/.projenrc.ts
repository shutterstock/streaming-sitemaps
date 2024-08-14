import { awscdk } from 'projen';
import { NodePackageManager } from 'projen/lib/javascript';

const project = new awscdk.AwsCdkConstructLibrary({
  author: 'Shutterstock, Inc.',
  authorAddress: 'https://github.com/shutterstock',
  authorOrganization: true,
  description:
    'CDK construct for creating XML sitemaps and sitemap index files from Kinesis streams',
  license: 'MIT',
  copyrightPeriod: '2021-2024',
  keywords: ['aws', 'cdk', 'sitemap', 'kinesis', 'xml'],
  packageManager: NodePackageManager.NPM,
  minNodeVersion: '18.0.0',
  cdkVersion: '2.117.0',
  constructsVersion: '10.1.244',
  defaultReleaseBranch: 'main',
  jsiiVersion: '~5.4.0',
  name: '@shutterstock/sitemaps-cdk',
  projenrcTs: true,
  repositoryUrl: 'git@github.shuttercorp.net:sreng/streaming-sitemaps.git',
  // We run eslint from the root of the monorepo
  eslint: false,

  // Jest is installed in the monorepo root
  jest: false,

  devDeps: ['esbuild'],

  // deps: [],                /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],             /* Build dependencies for this module. */
  // packageName: undefined,  /* The "name" in package.json. */
});

//
// Setup tasks
//

project.compileTask.exec(
  'esbuild ../kinesis-index-writer/src/index.ts --bundle --minify --sourcemap --platform=node --target=node18 --external:aws-sdk --outfile=lib/kinesis-index-writer/index.js',
);
project.compileTask.exec(
  'esbuild ../kinesis-sitemap-freshener/src/index.ts --bundle --minify --sourcemap --platform=node --target=node18 --external:aws-sdk --outfile=lib/kinesis-sitemap-freshener/index.js',
);
project.compileTask.exec(
  'esbuild ../kinesis-sitemap-writer/src/index.ts --bundle --minify --sourcemap --platform=node --target=node18 --external:aws-sdk --outfile=lib/kinesis-sitemap-writer/index.js',
);

project.synth();
