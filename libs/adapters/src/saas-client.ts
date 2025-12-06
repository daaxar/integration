import { request } from 'undici';
import { SaasApiClient } from '@integration/domain';
import { logger } from '@integration/observability';

export class HttpSaasApiClient implements SaasApiClient {
  constructor(private readonly baseUrl: string) {}

  async updateExpeditionStatus(params: { expeditionId: string; internalState: string; idempotencyKey: string; jwt: string }): Promise<void> {
    const response = await request(`${this.baseUrl}/expeditions/${params.expeditionId}/status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.jwt}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey
      },
      body: JSON.stringify({ state: params.internalState })
    });

    if (response.statusCode >= 400) {
      logger.error({ status: response.statusCode }, 'SaaS API responded with error');
      throw new Error(`Failed to update expedition ${params.expeditionId}`);
    }
  }
}
