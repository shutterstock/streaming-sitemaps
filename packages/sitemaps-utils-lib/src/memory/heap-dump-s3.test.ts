//heapdump.test.ts
/// <reference types="jest" />

import { promisify } from 'util';
import { heapdumps3 } from './heap-dump-s3';
import * as s3 from '@aws-sdk/client-s3';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
const sleep = promisify(setTimeout);

describe('heapdumps3', () => {
  const s3Client: AwsClientStub<s3.S3Client> = mockClient(s3.S3Client);

  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('do not take a dump', async () => {
    s3Client.onAnyCommand().rejects();

    const dumper = new heapdumps3({ bucketName: 'someBucket', bucketPrefix: 'some/prefix' });

    const result = await dumper.shutdownAndFlush();
    expect(result).toBe(false);
  });

  // This test taks a long time and freezes other tests
  it.skip('do take a dump', async () => {
    s3Client.onAnyCommand().rejects().on(s3.PutObjectCommand).resolves({});

    const dumper = new heapdumps3({
      dumpAtBytes: 1024,
      intervalMS: 10,
      bucketName: 'someBucket',
      bucketPrefix: 'some/prefix',
    });

    await sleep(10);

    const result = await dumper.shutdownAndFlush();
    expect(result).toBe(true);
    expect(s3Client.calls().length).toBe(1);
  }, 30000);
});
