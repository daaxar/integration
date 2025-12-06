import { describe, expect, it, beforeEach } from 'vitest';
import { DetectionOrchestrator, DefaultStateMapper, ExpeditionProcessor } from '../src/services';
import {
  Expedition,
  ExpeditionId,
  ExpeditionStatus,
  IntegrationConfig,
  ProcessedLogEntry
} from '../src/types';
import {
  ExpeditionRepository,
  IdempotencyKeyFactory,
  IntegrationConfigRepository,
  LogRepository,
  MetricsRecorder,
  RateLimiter,
  SaasApiClient,
  SourceAdapterFactory
} from '../src/ports';

describe('Detection and processing integration flow', () => {
  const integration: IntegrationConfig = {
    id: 'integration-1',
    clientId: 'client-1',
    sourceType: 'api',
    sourceConfig: {
      baseUrl: 'https://clients.example',
      auth: { type: 'jwt', token: 'client-token' },
      statusPathTemplate: '/status/{id}'
    },
    stateMapping: [
      { externalState: 'DELIVERED', internalState: 'delivered' },
      { externalState: 'IN_TRANSIT', internalState: 'in_transit' }
    ],
    detectionRules: {
      frequencySeconds: 60,
      rateLimit: { maxPerWindow: 5, windowSeconds: 60 },
      maxPerRun: 10
    },
    priorityRules: { defaultPriority: 'high' }
  };

  const queue: Expedition[] = [];
  const logs: ProcessedLogEntry[] = [];
  const metrics: Array<{ integrationId: string; clientId: string; result: string }> = [];

  const configRepo: IntegrationConfigRepository = {
    listActiveIntegrations: async () => [integration],
    getIntegrationConfig: async (id: string) => (id === integration.id ? integration : null)
  };

  const expeditionRepo: ExpeditionRepository = {
    listPendingExpeditions: async () => [
      { id: 'exp-1', clientId: integration.clientId, integrationId: integration.id, priority: 'high', lastKnownStatus: 'pending' },
      { id: 'exp-2', clientId: integration.clientId, integrationId: integration.id, priority: 'standard', lastKnownStatus: 'in_transit' }
    ]
  };

  const limiter: RateLimiter = {
    shouldProcess: async () => true
  };

  const queuePublisher = {
    enqueue: async (expedition: Expedition) => {
      queue.push(expedition);
    }
  };

  const statusById: Record<ExpeditionId, ExpeditionStatus> = {
    'exp-1': { externalState: 'DELIVERED', internalState: 'delivered' },
    'exp-2': { externalState: 'IN_TRANSIT', internalState: 'in_transit' }
  };

  const adapterFactory: SourceAdapterFactory = {
    buildAdapter: () => ({
      fetchExpeditionStatus: async (id: ExpeditionId) => statusById[id]
    })
  };

  const idempotencyKeys: IdempotencyKeyFactory = {
    create: (expeditionId, integrationId) => `key-${integrationId}-${expeditionId}`
  };

  const saasClient: SaasApiClient = {
    updateExpeditionStatus: async () => {
      /* no-op for integration test */
    }
  };

  const logRepo: LogRepository = {
    append: async (entry) => {
      logs.push(entry);
    }
  };

  const metricsRecorder: MetricsRecorder = {
    recordProcessed: async (integrationId, clientId, result) => {
      metrics.push({ integrationId, clientId, result });
    }
  };

  beforeEach(() => {
    queue.length = 0;
    logs.length = 0;
    metrics.length = 0;
    process.env.SAAS_JWT_TOKEN = 'integration-jwt';
  });

  it('orchestrates detection and processing through to logs and metrics', async () => {
    const orchestrator = new DetectionOrchestrator(configRepo, expeditionRepo, queuePublisher, limiter);
    await orchestrator.run();

    const processor = new ExpeditionProcessor(
      configRepo,
      adapterFactory,
      new DefaultStateMapper(),
      saasClient,
      idempotencyKeys,
      logRepo,
      metricsRecorder
    );

    for (const expedition of queue) {
      await processor.handle(expedition.id, expedition.integrationId, expedition.clientId, expedition.lastKnownStatus);
    }

    expect(queue).toHaveLength(2);
    expect(logs).toHaveLength(2);
    expect(metrics).toEqual([
      { integrationId: integration.id, clientId: integration.clientId, result: 'updated' },
      { integrationId: integration.id, clientId: integration.clientId, result: 'no_change' }
    ]);

    const deliveredLog = logs.find((entry) => entry.expeditionId === 'exp-1');
    expect(deliveredLog?.resolvedInternalState).toBe('delivered');
    expect(deliveredLog?.updated).toBe(true);

    const unchangedLog = logs.find((entry) => entry.expeditionId === 'exp-2');
    expect(unchangedLog?.updated).toBe(false);
  });
});
