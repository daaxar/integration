import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export class IntegrationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const dlq = new Queue(this, 'ExpeditionsDlq', {
      queueName: 'expeditions-dlq',
      retentionPeriod: Duration.days(14)
    });

    const standardQueue = new Queue(this, 'ExpeditionsQueue', {
      queueName: 'expeditions-standard',
      visibilityTimeout: Duration.minutes(5),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: dlq
      }
    });

    const highPriorityQueue = new Queue(this, 'ExpeditionsHighPriorityQueue', {
      queueName: 'expeditions-high',
      visibilityTimeout: Duration.minutes(5),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: dlq
      }
    });

    const orchestrator = new NodejsFunction(this, 'DetectionOrchestrator', {
      runtime: Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '../../funcs/orchestrator/src/index.ts'),
      handler: 'handler',
      environment: {
        SQS_QUEUE_URL: standardQueue.queueUrl,
        SQS_HIGH_PRIORITY_QUEUE_URL: highPriorityQueue.queueUrl,
        CENTRAL_MONGO_URI: process.env.CENTRAL_MONGO_URI || '',
        CENTRAL_MONGO_DB: process.env.CENTRAL_MONGO_DB || '',
        SAAS_API_BASE_URL: process.env.SAAS_API_BASE_URL || '',
        SAAS_JWT_TOKEN: process.env.SAAS_JWT_TOKEN || ''
      }
    });

    standardQueue.grantSendMessages(orchestrator);
    highPriorityQueue.grantSendMessages(orchestrator);

    new Rule(this, 'OrchestratorSchedule', {
      schedule: Schedule.rate(Duration.minutes(5)),
      targets: [new LambdaFunction(orchestrator)]
    });

    const processor = new NodejsFunction(this, 'ExpeditionProcessor', {
      runtime: Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '../../funcs/processor/src/index.ts'),
      handler: 'handler',
      environment: {
        SAAS_API_BASE_URL: process.env.SAAS_API_BASE_URL || '',
        CENTRAL_MONGO_URI: process.env.CENTRAL_MONGO_URI || '',
        CENTRAL_MONGO_DB: process.env.CENTRAL_MONGO_DB || '',
        CLIENT_MONGO_URI: process.env.CLIENT_MONGO_URI || '',
        CLIENT_MONGO_DB: process.env.CLIENT_MONGO_DB || '',
        SAAS_JWT_TOKEN: process.env.SAAS_JWT_TOKEN || ''
      }
    });

    standardQueue.grantConsumeMessages(processor);
    highPriorityQueue.grantConsumeMessages(processor);

    processor.addEventSourceMapping('StandardQueueMapping', {
      eventSourceArn: standardQueue.queueArn,
      batchSize: 5
    });

    processor.addEventSourceMapping('HighPriorityQueueMapping', {
      eventSourceArn: highPriorityQueue.queueArn,
      batchSize: 5
    });

    new Table(this, 'RateLimitTable', {
      partitionKey: { name: 'integrationId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY
    });
  }
}
