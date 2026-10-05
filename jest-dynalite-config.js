// use export default for ts based configs
module.exports = {
  tables: [
    {
      TableName: 'sitemaps',
      AttributeDefinitions: [
        {
          AttributeName: 'PK',
          AttributeType: 'S',
        },
        {
          AttributeName: 'SK',
          AttributeType: 'S',
        },
      ],
      KeySchema: [
        {
          AttributeName: 'PK',
          KeyType: 'HASH',
        },
        {
          AttributeName: 'SK',
          KeyType: 'RANGE',
        },
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 1,
        WriteCapacityUnits: 1,
      },
    },
  ],
  // Resolve from the listening server even after a test calls resetModules().
  // The helper adds the worker ID back when constructing table-request URLs.
  get basePort() {
    return Number(process.env.MOCK_DYNAMODB_PORT) - Number(process.env.JEST_WORKER_ID || 1);
  },
};
