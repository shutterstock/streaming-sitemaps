import { Command } from '@oclif/core';

export default class Test extends Command {
  static description =
    'Commands to assist in testing, such as publishing kinesis messages for the sitemap writer';

  // eslint-disable-next-line @typescript-eslint/require-await
  async run(): Promise<void> {}
}
