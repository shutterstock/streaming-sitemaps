const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');
const { GetBucketLocationCommand, S3Client } = require('@aws-sdk/client-s3');

test('the patched XML parser preserves SDK response deserialization', async () => {
  let requests = 0;
  const client = new S3Client({
    region: 'us-east-1',
    // Synthetic credentials: the request handler never opens a connection.
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
    requestHandler: {
      handle: async () => {
        requests += 1;
        return {
          response: {
            statusCode: 200,
            headers: { 'content-type': 'application/xml' },
            body: Readable.from([
              '<?xml version="1.0" encoding="UTF-8"?>' +
                '<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
                'us-east-2</LocationConstraint>',
            ]),
          },
        };
      },
    },
  });
  try {
    const response = await client.send(new GetBucketLocationCommand({ Bucket: 'example' }));
    assert.equal(response.LocationConstraint, 'us-east-2');
    assert.equal(requests, 1);
  } finally {
    client.destroy();
  }
});
