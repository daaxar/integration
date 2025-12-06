import { SQS } from 'aws-sdk';
import { DetectionOrchestrator } from '@integration/domain';
import {
  buildConfigRepositoryFromEnv,
  buildPendingExpeditionRepositoryFromEnv,
  InMemoryRateLimiter
} from '@integration/adapters';
import { logger } from '@integration/observability';
import { Expedition } from '@integration/domain';

const sqs = new SQS({ apiVersion: '2012-11-05' });

const standardQueueUrl = process.env.SQS_QUEUE_URL || process.env.SQS_STANDARD_QUEUE_URL;
const highPriorityQueueUrl = process.env.SQS_HIGH_PRIORITY_QUEUE_URL;

function resolveQueueUrl(expedition: Expedition): string {
  if (!standardQueueUrl) {
    throw new Error('SQS_QUEUE_URL or SQS_STANDARD_QUEUE_URL must be set');
  }

  if (expedition.priority === 'high') {
    if (highPriorityQueueUrl) {
      return highPriorityQueueUrl;
    }
    logger.warn({ expeditionId: expedition.id }, 'High priority expedition sent to standard queue due to missing high-priority URL');
  }

  return standardQueueUrl;
}

const queuePublisher = {
  async enqueue(expedition: Expedition): Promise<void> {
    const queueUrl = resolveQueueUrl(expedition);
    await sqs
      .sendMessage({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(expedition),
        MessageAttributes: {
          priority: {
            DataType: 'String',
            StringValue: expedition.priority
          },
          clientId: {
            DataType: 'String',
            StringValue: expedition.clientId
          }
        }
      })
      .promise();
  }
};

const orchestrator = new DetectionOrchestrator(
  buildConfigRepositoryFromEnv(),
  buildPendingExpeditionRepositoryFromEnv(),
  queuePublisher,
  new InMemoryRateLimiter()
);

export const handler = async (): Promise<void> => {
  logger.info('Starting detection orchestrator');
  await orchestrator.run();
};
