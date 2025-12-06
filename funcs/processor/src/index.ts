import {
  DefaultIdempotencyKeyFactory,
  DefaultStateMapper,
  ExpeditionProcessor,
  Expedition
} from '@integration/domain';
import {
  DefaultSourceAdapterFactory,
  HttpSaasApiClient,
  MongoLogRepository,
  buildConfigRepositoryFromEnv,
  CloudWatchMetricsRecorder
} from '@integration/adapters';
import { logger } from '@integration/observability';

const integrationConfigRepo = buildConfigRepositoryFromEnv();
const adapterFactory = new DefaultSourceAdapterFactory();
const stateMapper = new DefaultStateMapper();
const idempotencyFactory = new DefaultIdempotencyKeyFactory();
const saasClient = new HttpSaasApiClient(process.env.SAAS_API_BASE_URL || '');

type SqsEvent = { Records: Array<{ body: string }> };

export const handler = async (event: SqsEvent): Promise<void> => {
  const processor = new ExpeditionProcessor(
    integrationConfigRepo,
    adapterFactory,
    stateMapper,
    saasClient,
    idempotencyFactory,
    new MongoLogRepository(
      process.env.CLIENT_MONGO_URI || '',
      process.env.CLIENT_MONGO_DB || 'logs',
      process.env.CLIENT_MONGO_COLLECTION || 'expedition_logs'
    ),
    new CloudWatchMetricsRecorder('integration-platform', {})
  );

  for (const record of event.Records) {
    const payload = JSON.parse(record.body) as Expedition;
    logger.info({ expeditionId: payload.id }, 'Processing expedition message');

    try {
      await processor.handle(payload.id, payload.integrationId, payload.clientId, payload.lastKnownStatus);
    } catch (error) {
      logger.error({ error, expeditionId: payload.id }, 'Failed to process expedition');
      throw error;
    }
  }
};
