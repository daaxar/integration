import { request } from 'undici';
import { Expedition, ExpeditionRepository, IntegrationConfig } from '@integration/domain';
import { logger } from '@integration/observability';

interface PendingExpeditionPayload {
  id: string;
  clientId?: string;
  priority?: Expedition['priority'];
  lastKnownStatus?: string;
}

export class SaasPendingExpeditionRepository implements ExpeditionRepository {
  constructor(private readonly baseUrl: string, private readonly jwt: string) {}

  async listPendingExpeditions(integration: IntegrationConfig): Promise<Expedition[]> {
    const response = await request(`${this.baseUrl}/integrations/${integration.id}/expeditions/pending`, {
      headers: {
        Authorization: `Bearer ${this.jwt}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.statusCode >= 400) {
      logger.error(
        { status: response.statusCode, integrationId: integration.id },
        'Failed to fetch pending expeditions from SaaS'
      );
      throw new Error(`Failed to fetch pending expeditions for integration ${integration.id}`);
    }

    const body = (await response.body.json()) as PendingExpeditionPayload[] | { expeditions?: PendingExpeditionPayload[] };
    const expeditions: PendingExpeditionPayload[] = Array.isArray(body) ? body : body.expeditions || [];

    return expeditions.map((item) => ({
      id: item.id,
      clientId: item.clientId || integration.clientId,
      integrationId: integration.id,
      priority: item.priority || integration.priorityRules.defaultPriority,
      lastKnownStatus: item.lastKnownStatus || 'unknown'
    }));
  }
}

export function buildPendingExpeditionRepositoryFromEnv(): ExpeditionRepository {
  const baseUrl = process.env.SAAS_API_BASE_URL;
  const jwt = process.env.SAAS_JWT_TOKEN;

  if (!baseUrl || !jwt) {
    logger.error('Missing SaaS API configuration for pending expedition repository');
    throw new Error('SAAS_API_BASE_URL and SAAS_JWT_TOKEN are required');
  }

  return new SaasPendingExpeditionRepository(baseUrl, jwt);
}
