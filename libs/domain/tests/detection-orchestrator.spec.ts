import { describe, expect, it, vi } from 'vitest';
import { DetectionOrchestrator } from '../src/services';
import { Expedition, IntegrationConfig } from '../src/types';
import { ExpeditionRepository, IntegrationConfigRepository, RateLimiter } from '../src/ports';

const baseIntegration: IntegrationConfig = {
  id: 'int-1',
  clientId: 'client-1',
  sourceType: 'mongo',
  sourceConfig: {
    uri: 'mongodb://example',
    database: 'db',
    collection: 'expeditions',
    queryTemplate: {}
  },
  stateMapping: [],
  detectionRules: {
    frequencySeconds: 60,
    rateLimit: { maxPerWindow: 10, windowSeconds: 60 },
    maxPerRun: 2
  },
  priorityRules: {
    defaultPriority: 'standard'
  }
};

describe('DetectionOrchestrator', () => {
  it('respects rate limits and max per run when enqueuing expeditions', async () => {
    const configRepo: IntegrationConfigRepository = {
      listActiveIntegrations: vi.fn().mockResolvedValue([baseIntegration]),
      getIntegrationConfig: vi.fn()
    };

    const expeditions: Expedition[] = [
      { id: 'exp-1', clientId: 'client-1', integrationId: 'int-1', priority: 'standard', lastKnownStatus: 'pending' },
      { id: 'exp-2', clientId: 'client-1', integrationId: 'int-1', priority: 'standard', lastKnownStatus: 'pending' },
      { id: 'exp-3', clientId: 'client-1', integrationId: 'int-1', priority: 'standard', lastKnownStatus: 'pending' }
    ];

    const expeditionRepo: ExpeditionRepository = {
      listPendingExpeditions: vi.fn().mockResolvedValue(expeditions)
    };

    const queuePublisher = { enqueue: vi.fn().mockResolvedValue(undefined) };

    const limiter: RateLimiter = {
      shouldProcess: vi.fn().mockResolvedValue(true)
    };

    const orchestrator = new DetectionOrchestrator(configRepo, expeditionRepo, queuePublisher, limiter);
    await orchestrator.run();

    expect(limiter.shouldProcess).toHaveBeenCalledWith(baseIntegration);
    expect(queuePublisher.enqueue).toHaveBeenCalledTimes(baseIntegration.detectionRules.maxPerRun);
    expect(queuePublisher.enqueue).toHaveBeenCalledWith(expeditions[0]);
    expect(queuePublisher.enqueue).toHaveBeenCalledWith(expeditions[1]);
  });

  it('skips integrations that rate limiter blocks', async () => {
    const configRepo: IntegrationConfigRepository = {
      listActiveIntegrations: vi.fn().mockResolvedValue([baseIntegration]),
      getIntegrationConfig: vi.fn()
    };

    const expeditionRepo: ExpeditionRepository = {
      listPendingExpeditions: vi.fn()
    };

    const queuePublisher = { enqueue: vi.fn() };

    const limiter: RateLimiter = {
      shouldProcess: vi.fn().mockResolvedValue(false)
    };

    const orchestrator = new DetectionOrchestrator(configRepo, expeditionRepo, queuePublisher, limiter);
    await orchestrator.run();

    expect(expeditionRepo.listPendingExpeditions).not.toHaveBeenCalled();
    expect(queuePublisher.enqueue).not.toHaveBeenCalled();
  });
});
