import { SQS } from 'aws-sdk';
import { DetectionOrchestrator } from '@integration/domain';
import { buildConfigRepositoryFromEnv, InMemoryRateLimiter } from '@integration/adapters';
import { logger } from '@integration/observability';
import { ExpeditionRepository, Expedition } from '@integration/domain';

class SaaSExpeditionRepository implements ExpeditionRepository {
  async listPendingExpeditions(integration: any): Promise<Expedition[]> {
    logger.info({ integrationId: integration.id }, 'Fetching pending expeditions from SaaS');
    return [];
  }
}

const sqs = new SQS({ apiVersion: '2012-11-05' });

const queuePublisher = {
  async enqueue(expedition: Expedition): Promise<void> {
    const queueUrl = process.env.SQS_QUEUE_URL;
    if (!queueUrl) throw new Error('SQS_QUEUE_URL not set');

    await sqs
      .sendMessage({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(expedition),
        MessageAttributes: {
          priority: {
            DataType: 'String',
            StringValue: expedition.priority
          }
        }
      })
      .promise();
  }
};

const orchestrator = new DetectionOrchestrator(
  buildConfigRepositoryFromEnv(),
  new SaaSExpeditionRepository(),
  queuePublisher,
  new InMemoryRateLimiter()
);

export const handler = async (): Promise<void> => {
  logger.info('Starting detection orchestrator');
  await orchestrator.run();
};
