export type ExpeditionId = string;

export interface Expedition {
  id: ExpeditionId;
  clientId: string;
  integrationId: string;
  priority: 'high' | 'standard';
  lastKnownStatus: string;
}

export interface StateMappingEntry {
  externalState: string;
  internalState: string;
}

export interface RateLimitRule {
  maxPerWindow: number;
  windowSeconds: number;
}

export type SourceType = 'mongo' | 'ftp' | 'api';

export interface MongoSourceConfig {
  uri: string;
  database: string;
  collection: string;
  queryTemplate: Record<string, unknown>;
}

export interface FtpSourceConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  folder: string;
  filePattern: string;
}

export interface ApiAuthConfig {
  type: 'apiKey' | 'basic' | 'oauth2' | 'jwt';
  headerName?: string;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
}

export interface ApiSourceConfig {
  baseUrl: string;
  auth: ApiAuthConfig;
  statusPathTemplate: string;
}

export interface IntegrationConfig {
  id: string;
  clientId: string;
  sourceType: SourceType;
  sourceConfig: MongoSourceConfig | FtpSourceConfig | ApiSourceConfig;
  stateMapping: StateMappingEntry[];
  detectionRules: {
    frequencySeconds: number;
    rateLimit: RateLimitRule;
    maxPerRun: number;
  };
  priorityRules: {
    defaultPriority: 'high' | 'standard';
  };
}

export interface ExpeditionStatus {
  externalState: string;
  internalState: string;
  rawPayload?: unknown;
}

export interface ProcessedLogEntry {
  expeditionId: ExpeditionId;
  integrationId: string;
  clientId: string;
  previousState: string;
  receivedState: string;
  resolvedInternalState: string;
  updated: boolean;
  error?: string;
  timestamp: string;
}
