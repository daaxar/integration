import { Client as FtpClient } from 'basic-ftp';
import { MongoClient } from 'mongodb';
import { request } from 'undici';
import {
  ApiSourceConfig,
  ExpeditionId,
  ExpeditionStatus,
  FtpSourceConfig,
  IntegrationConfig,
  MongoSourceConfig,
  SourceAdapter,
  SourceAdapterFactory
} from '@integration/domain';
import { logger } from '@integration/observability';

class MongoSourceAdapter implements SourceAdapter {
  constructor(private readonly clientFactory: () => Promise<MongoClient>) {}

  async fetchExpeditionStatus(expeditionId: ExpeditionId, integration: IntegrationConfig): Promise<ExpeditionStatus> {
    const cfg = integration.sourceConfig as MongoSourceConfig;
    const client = await this.clientFactory();
    const db = client.db(cfg.database);
    const collection = db.collection(cfg.collection);
    const query = { ...cfg.queryTemplate, expeditionId };
    const doc = await collection.findOne(query);
    await client.close();
    if (!doc) {
      throw new Error(`Expedition ${expeditionId} not found in Mongo source`);
    }
    const externalState = doc.state as string;
    return { externalState, internalState: externalState, rawPayload: doc };
  }
}

class FtpSourceAdapter implements SourceAdapter {
  constructor(private readonly cfg: FtpSourceConfig) {}

  async fetchExpeditionStatus(expeditionId: ExpeditionId): Promise<ExpeditionStatus> {
    const client = new FtpClient();
    await client.access({
      host: this.cfg.host,
      port: this.cfg.port,
      user: this.cfg.username,
      password: this.cfg.password,
      secure: false
    });

    const files = await client.list(this.cfg.folder);
    const match = files.find((f) => f.name.includes(this.cfg.filePattern));
    if (!match) {
      throw new Error('FTP file not found for expedition');
    }

    const writable: Buffer[] = [];
    await client.downloadTo(Buffer.concat(writable), `${this.cfg.folder}/${match.name}`);
    await client.close();

    const contents = writable.toString();
    const parsed = JSON.parse(contents);
    const record = parsed.find((item: any) => item.id === expeditionId);
    if (!record) {
      throw new Error(`Expedition ${expeditionId} not found in FTP payload`);
    }

    return { externalState: record.state, internalState: record.state, rawPayload: record };
  }
}

class ApiSourceAdapter implements SourceAdapter {
  constructor(private readonly cfg: ApiSourceConfig) {}

  async fetchExpeditionStatus(expeditionId: ExpeditionId): Promise<ExpeditionStatus> {
    const path = this.cfg.statusPathTemplate.replace(':id', expeditionId);
    const headers: Record<string, string> = {};

    if (this.cfg.auth.type === 'apiKey' && this.cfg.auth.headerName && this.cfg.auth.token) {
      headers[this.cfg.auth.headerName] = this.cfg.auth.token;
    }

    const response = await request(`${this.cfg.baseUrl}${path}`, { headers });
    if (response.statusCode >= 400) {
      logger.error({ status: response.statusCode }, 'API source responded with error');
      throw new Error(`API source responded with status ${response.statusCode}`);
    }

    const body = await response.body.json();
    const externalState = body.state as string;
    return { externalState, internalState: externalState, rawPayload: body };
  }
}

export class DefaultSourceAdapterFactory implements SourceAdapterFactory {
  buildAdapter(integration: IntegrationConfig): SourceAdapter {
    switch (integration.sourceType) {
      case 'mongo': {
        const cfg = integration.sourceConfig as MongoSourceConfig;
        return new MongoSourceAdapter(async () => new MongoClient(cfg.uri));
      }
      case 'ftp':
        return new FtpSourceAdapter(integration.sourceConfig as FtpSourceConfig);
      case 'api':
        return new ApiSourceAdapter(integration.sourceConfig as ApiSourceConfig);
      default:
        throw new Error(`Unsupported source type ${(integration as any).sourceType}`);
    }
  }
}
