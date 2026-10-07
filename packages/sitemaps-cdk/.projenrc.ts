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
  packageManager: NodePackageManager.PNPM,
  pnpmVersion: '12.7.0',
  projenCommand: 'pnpm exec projen',
  workflowNodeVersion: '24',
  github: false,
  minNodeVersion: '24.0.0',
  cdkVersion: '2.271.0',
  constructsVersion: '10.8.1',
  defaultReleaseBranch: 'main',
  jsiiVersion: '~6.0.16',
  projenVersion: '0.103.27',
  typescriptVersion: '6.0.3',
  name: '@shutterstock/sitemaps-cdk',
  projenrcTs: true,
  repositoryUrl: 'https://github.com/shutterstock/streaming-sitemaps.git',
  // We run eslint from the root of the monorepo
  eslint: false,

  // Jest is installed in the monorepo root
  jest: false,

  devDeps: [
    'esbuild@0.28.2',
    '@types/jest@30.0.0',
    '@types/node@24.19.0',
    'tslib@^2.8.1',
    'ts-node@10.9.2',
    'jsii-diff@1.140.0',
    'jsii-docgen@10.12.6',
    'jsii-pacmak@1.140.0',
  ],
  // Keep unrelated ambient workspace types out of the jsii compiler.
  tsconfig: { compilerOptions: { types: ['node'] } },
  tsconfigDev: { compilerOptions: { types: ['node', 'jest'] } },

  // deps: [],                /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],             /* Build dependencies for this module. */
  // packageName: undefined,  /* The "name" in package.json. */
});

// Rosetta is independently released; Projen's jsii-derived default can lag.
project.addDevDeps(
  'jsii-rosetta@~6.0.17',
  'jsii-diff@1.140.0',
  'jsii-pacmak@1.140.0',
  'commit-and-tag-version@13.2.1',
);
project.tsconfigDev.file.addOverride('compilerOptions.ignoreDeprecations', '6.0');

// The construct bundles sibling workspace sources; one root install/lock owns
// the whole graph. Generated nested workflows are not runnable from repo root.
project.package.addField('packageManager', 'pnpm@12.7.0');
project.package.file.addOverride('repository.directory', 'packages/sitemaps-cdk');
project.package.addField('homepage', 'https://github.com/shutterstock/streaming-sitemaps');
project.package.addField('bugs', {
  url: 'https://github.com/shutterstock/streaming-sitemaps/issues',
});
project.package.addField('files', [
  'lib/**/*.js',
  'lib/**/*.d.ts',
  'lib/**/*.js.map',
  '.jsii',
  'LICENSE',
  'README.md',
  'API.md',
]);
project.gitignore.addPatterns('/pnpm-lock.yaml');
project.npmignore?.exclude('/AGENTS.md');
project.npmignore?.exclude('/lib/**/*.test.*', '/lib/**/*.tsbuildinfo', '/.agents/', '/.codex/');
// Synthesis describes the workspace; dependency installation belongs to the
// root lock owner and is an explicit separate step, including in CI builds.
project.defaultTask?.env('PROJEN_DISABLE_POST', 'true');

//
// Setup tasks
//

project.compileTask.exec(
  'esbuild ../kinesis-index-writer/src/index.ts --bundle --minify --sourcemap --platform=node --target=node20 --external:aws-sdk --outfile=lib/kinesis-index-writer/index.js',
);
project.compileTask.exec(
  'esbuild ../kinesis-sitemap-freshener/src/index.ts --bundle --minify --sourcemap --platform=node --target=node20 --external:aws-sdk --outfile=lib/kinesis-sitemap-freshener/index.js',
);
project.compileTask.exec(
  'esbuild ../kinesis-sitemap-writer/src/index.ts --bundle --minify --sourcemap --platform=node --target=node20 --external:aws-sdk --outfile=lib/kinesis-sitemap-writer/index.js',
);

project.synth();
