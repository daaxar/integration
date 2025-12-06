import { Expedition, ExpeditionId, ExpeditionStatus, IntegrationConfig, ProcessedLogEntry } from './types';

export interface IntegrationConfigRepository {
  listActiveIntegrations(): Promise<IntegrationConfig[]>;
  getIntegrationConfig(integrationId: string): Promise<IntegrationConfig | null>;
}

export interface ExpeditionRepository {
  listPendingExpeditions(integration: IntegrationConfig): Promise<Expedition[]>;
}

export interface SourceAdapter {
  fetchExpeditionStatus(expeditionId: ExpeditionId, integration: IntegrationConfig): Promise<ExpeditionStatus>;
}

export interface SourceAdapterFactory {
  buildAdapter(integration: IntegrationConfig): SourceAdapter;
}

export interface StateMapper {
  resolveInternalState(mapping: IntegrationConfig['stateMapping'], externalState: string): string;
}

export interface SaasApiClient {
  updateExpeditionStatus(params: {
    expeditionId: ExpeditionId;
    internalState: string;
    idempotencyKey: string;
    jwt: string;
  }): Promise<void>;
}

export interface IdempotencyKeyFactory {
  create(expeditionId: ExpeditionId, integrationId: string): string;
}

export interface LogRepository {
  append(entry: ProcessedLogEntry): Promise<void>;
}

export interface MetricsRecorder {
  recordProcessed(integrationId: string, clientId: string, result: 'updated' | 'no_change' | 'error'): Promise<void>;
}

export interface RateLimiter {
  shouldProcess(integration: IntegrationConfig): Promise<boolean>;
}
