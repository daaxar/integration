import { MongoClient } from 'mongodb';
import { IntegrationConfig, IntegrationConfigRepository } from '@integration/domain';
import { logger } from '@integration/observability';

export class MongoIntegrationConfigRepository implements IntegrationConfigRepository {
  constructor(private readonly mongoUri: string, private readonly dbName: string, private readonly collection: string) {}

  private async withCollection<T>(fn: (collection: any) => Promise<T>): Promise<T> {
    const client = new MongoClient(this.mongoUri);
    await client.connect();
    try {
      const col = client.db(this.dbName).collection(this.collection);
      return await fn(col);
    } finally {
      await client.close();
    }
  }

  async listActiveIntegrations(): Promise<IntegrationConfig[]> {
    return this.withCollection((col) => col.find({ active: true }).toArray());
  }

  async getIntegrationConfig(integrationId: string): Promise<IntegrationConfig | null> {
    return this.withCollection((col) => col.findOne({ id: integrationId }));
  }
}

export function buildConfigRepositoryFromEnv(): IntegrationConfigRepository {
  const uri = process.env.CENTRAL_MONGO_URI;
  const db = process.env.CENTRAL_MONGO_DB;
  const collection = process.env.CENTRAL_MONGO_COLLECTION || 'integrations';

  if (!uri || !db) {
    logger.error('Missing central MongoDB configuration');
    throw new Error('CENTRAL_MONGO_URI and CENTRAL_MONGO_DB are required');
  }

  return new MongoIntegrationConfigRepository(uri, db, collection);
}
