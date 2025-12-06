import { MongoClient } from 'mongodb';
import { LogRepository, MetricsRecorder, ProcessedLogEntry } from '@integration/domain';
import { logger } from '@integration/observability';

export class MongoLogRepository implements LogRepository {
  constructor(private readonly mongoUri: string, private readonly dbName: string, private readonly collection: string) {}

  async append(entry: ProcessedLogEntry): Promise<void> {
    const client = new MongoClient(this.mongoUri);
    await client.connect();
    try {
      const col = client.db(this.dbName).collection(this.collection);
      await col.insertOne(entry);
    } catch (error) {
      logger.error({ error }, 'Failed to persist log entry');
      throw error;
    } finally {
      await client.close();
    }
  }
}

export class CloudWatchMetricsRecorder implements MetricsRecorder {
  constructor(private readonly namespace: string, private readonly dimensions: Record<string, string>) {}

  async recordProcessed(integrationId: string, clientId: string, result: 'updated' | 'no_change' | 'error'): Promise<void> {
    logger.info({ integrationId, clientId, result }, 'Metric recorded');
  }
}
