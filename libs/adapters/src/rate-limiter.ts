import { IntegrationConfig, RateLimiter } from '@integration/domain';
import { logger } from '@integration/observability';

const inMemoryWindow: Record<string, { count: number; expiresAt: number }> = {};

export class InMemoryRateLimiter implements RateLimiter {
  async shouldProcess(integration: IntegrationConfig): Promise<boolean> {
    const key = `${integration.id}:${integration.detectionRules.rateLimit.windowSeconds}`;
    const now = Date.now();
    const current = inMemoryWindow[key];

    if (!current || current.expiresAt < now) {
      inMemoryWindow[key] = { count: 1, expiresAt: now + integration.detectionRules.rateLimit.windowSeconds * 1000 };
      return true;
    }

    if (current.count >= integration.detectionRules.rateLimit.maxPerWindow) {
      logger.warn({ integrationId: integration.id }, 'Rate limit reached');
      return false;
    }

    current.count += 1;
    return true;
  }
}
