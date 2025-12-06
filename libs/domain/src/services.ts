import { randomUUID } from 'crypto';
import { Expedition, ExpeditionId, IntegrationConfig } from './types';
import {
  ExpeditionRepository,
  IdempotencyKeyFactory,
  IntegrationConfigRepository,
  LogRepository,
  MetricsRecorder,
  RateLimiter,
  SaasApiClient,
  SourceAdapterFactory,
  StateMapper
} from './ports';

export class DetectionOrchestrator {
  constructor(
    private readonly configRepo: IntegrationConfigRepository,
    private readonly expeditionRepo: ExpeditionRepository,
    private readonly queuePublisher: {
      enqueue(expedition: Expedition): Promise<void>;
    },
    private readonly limiter: RateLimiter
  ) {}

  async run(): Promise<void> {
    const integrations = await this.configRepo.listActiveIntegrations();

    for (const integration of integrations) {
      const allowed = await this.limiter.shouldProcess(integration);
      if (!allowed) continue;

      const expeditions = await this.expeditionRepo.listPendingExpeditions(integration);
      const limited = expeditions.slice(0, integration.detectionRules.maxPerRun);
      for (const expedition of limited) {
        await this.queuePublisher.enqueue(expedition);
      }
    }
  }
}

export class ExpeditionProcessor {
  constructor(
    private readonly configRepo: IntegrationConfigRepository,
    private readonly adapterFactory: SourceAdapterFactory,
    private readonly mapper: StateMapper,
    private readonly saasClient: SaasApiClient,
    private readonly idempotencyKeys: IdempotencyKeyFactory,
    private readonly logs: LogRepository,
    private readonly metrics: MetricsRecorder
  ) {}

  async handle(expeditionId: ExpeditionId, integrationId: string, clientId: string, lastKnownState: string): Promise<void> {
    const integration = await this.configRepo.getIntegrationConfig(integrationId);
    if (!integration) {
      throw new Error(`Integration ${integrationId} not found`);
    }

    const adapter = this.adapterFactory.buildAdapter(integration);
    const status = await adapter.fetchExpeditionStatus(expeditionId, integration);
    const internalState = this.mapper.resolveInternalState(integration.stateMapping, status.externalState);

    const updated = internalState !== lastKnownState;
    if (updated) {
      const key = this.idempotencyKeys.create(expeditionId, integrationId);
      await this.saasClient.updateExpeditionStatus({
        expeditionId,
        internalState,
        idempotencyKey: key,
        jwt: createJwtFromEnv()
      });
    }

    await this.logs.append({
      expeditionId,
      integrationId,
      clientId,
      previousState: lastKnownState,
      receivedState: status.externalState,
      resolvedInternalState: internalState,
      updated,
      timestamp: new Date().toISOString()
    });

    await this.metrics.recordProcessed(integrationId, clientId, updated ? 'updated' : 'no_change');
  }
}

function createJwtFromEnv(): string {
  const token = process.env.SAAS_JWT_TOKEN;
  if (!token) {
    throw new Error('Missing SAAS_JWT_TOKEN in environment');
  }
  return token;
}

export class DefaultIdempotencyKeyFactory implements IdempotencyKeyFactory {
  create(expeditionId: ExpeditionId, integrationId: string): string {
    return `${integrationId}:${expeditionId}:${randomUUID()}`;
  }
}

export class DefaultStateMapper implements StateMapper {
  resolveInternalState(mapping: IntegrationConfig['stateMapping'], externalState: string): string {
    const found = mapping.find((m) => m.externalState === externalState);
    if (found) return found.internalState;
    return externalState;
  }
}
