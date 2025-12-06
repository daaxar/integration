import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DefaultStateMapper, ExpeditionProcessor } from '../src/services';
import {
  ExpeditionId,
  IntegrationConfig,
  StateMappingEntry
} from '../src/types';
import {
  IdempotencyKeyFactory,
  IntegrationConfigRepository,
  LogRepository,
  MetricsRecorder,
  SaasApiClient,
  SourceAdapterFactory
} from '../src/ports';

describe('ExpeditionProcessor', () => {
  const baseMapping: StateMappingEntry[] = [
    { externalState: 'DELIVERED', internalState: 'delivered' },
    { externalState: 'IN_TRANSIT', internalState: 'in_transit' }
  ];

  const integration: IntegrationConfig = {
    id: 'integration-1',
    clientId: 'client-1',
    sourceType: 'api',
    sourceConfig: {
      baseUrl: 'https://example.com',
      auth: { type: 'apiKey', headerName: 'x-api-key', token: 'secret' },
      statusPathTemplate: '/status/{id}'
    },
    stateMapping: baseMapping,
    detectionRules: {
      frequencySeconds: 60,
      rateLimit: { maxPerWindow: 10, windowSeconds: 60 },
      maxPerRun: 50
    },
    priorityRules: { defaultPriority: 'standard' }
  };

  const buildProcessor = () => {
    const configRepo: IntegrationConfigRepository = {
      getIntegrationConfig: vi.fn().mockResolvedValue(integration),
      listActiveIntegrations: vi.fn()
    };

    const sourceAdapterFactory: SourceAdapterFactory = {
      buildAdapter: vi.fn()
    };

    const mapper = new DefaultStateMapper();

    const saasClient: SaasApiClient = {
      updateExpeditionStatus: vi.fn().mockResolvedValue(undefined)
    };

    const idempotencyFactory: IdempotencyKeyFactory = {
      create: vi.fn().mockReturnValue('fixed-key')
    };

    const logs: LogRepository = {
      append: vi.fn().mockResolvedValue(undefined)
    };

    const metrics: MetricsRecorder = {
      recordProcessed: vi.fn().mockResolvedValue(undefined)
    };

    const processor = new ExpeditionProcessor(
      configRepo,
      sourceAdapterFactory,
      mapper,
      saasClient,
      idempotencyFactory,
      logs,
      metrics
    );

    return { processor, configRepo, sourceAdapterFactory, mapper, saasClient, idempotencyFactory, logs, metrics };
  };

  beforeEach(() => {
    process.env.SAAS_JWT_TOKEN = 'test-jwt';
  });

  it('updates SaaS when external state maps to a new internal state', async () => {
    const components = buildProcessor();
    components.sourceAdapterFactory.buildAdapter = vi.fn().mockReturnValue({
      fetchExpeditionStatus: vi.fn().mockResolvedValue({ externalState: 'DELIVERED', internalState: 'delivered' })
    });

    await components.processor.handle('exp-1', integration.id, integration.clientId, 'pending');

    expect(components.saasClient.updateExpeditionStatus).toHaveBeenCalledWith({
      expeditionId: 'exp-1',
      internalState: 'delivered',
      idempotencyKey: 'fixed-key',
      jwt: 'test-jwt'
    });

    expect(components.logs.append).toHaveBeenCalledWith(
      expect.objectContaining({
        expeditionId: 'exp-1',
        integrationId: integration.id,
        clientId: integration.clientId,
        previousState: 'pending',
        receivedState: 'DELIVERED',
        resolvedInternalState: 'delivered',
        updated: true
      })
    );

    expect(components.metrics.recordProcessed).toHaveBeenCalledWith(integration.id, integration.clientId, 'updated');
  });

  it('skips SaaS update when state has not changed', async () => {
    const components = buildProcessor();
    components.sourceAdapterFactory.buildAdapter = vi.fn().mockReturnValue({
      fetchExpeditionStatus: vi.fn().mockResolvedValue({ externalState: 'IN_TRANSIT', internalState: 'in_transit' })
    });

    await components.processor.handle('exp-2', integration.id, integration.clientId, 'in_transit');

    expect(components.saasClient.updateExpeditionStatus).not.toHaveBeenCalled();
    expect(components.logs.append).toHaveBeenCalledWith(
      expect.objectContaining({
        expeditionId: 'exp-2',
        previousState: 'in_transit',
        receivedState: 'IN_TRANSIT',
        resolvedInternalState: 'in_transit',
        updated: false
      })
    );
    expect(components.metrics.recordProcessed).toHaveBeenCalledWith(integration.id, integration.clientId, 'no_change');
  });

  it('propagates missing integration as an error', async () => {
    const components = buildProcessor();
    components.configRepo.getIntegrationConfig = vi.fn().mockResolvedValue(null);

    await expect(
      components.processor.handle('exp-3', 'missing', integration.clientId, 'in_transit')
    ).rejects.toThrow('Integration missing not found');
  });
});
