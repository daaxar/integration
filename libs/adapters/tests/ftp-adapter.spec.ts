import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DefaultSourceAdapterFactory } from '../src/source-adapters';
import { IntegrationConfig } from '@integration/domain';
import * as ftp from 'basic-ftp';

vi.mock('basic-ftp', () => {
  const accessMock = vi.fn();
  const listMock = vi.fn();
  const downloadToMock = vi.fn();
  const closeMock = vi.fn();

  class FakeClient {
    access = accessMock;
    list = listMock;
    downloadTo = downloadToMock;
    close = closeMock;
  }

  return {
    Client: FakeClient,
    __mocks: { accessMock, listMock, downloadToMock, closeMock }
  };
});

const integration: IntegrationConfig = {
  id: 'int-ftp',
  clientId: 'client-123',
  sourceType: 'ftp',
  sourceConfig: {
    host: 'ftp.example.com',
    port: 21,
    username: 'user',
    password: 'pass',
    folder: '/exports',
    filePattern: 'expeditions.json'
  },
  stateMapping: [],
  detectionRules: {
    frequencySeconds: 60,
    rateLimit: { maxPerWindow: 100, windowSeconds: 60 },
    maxPerRun: 50
  },
  priorityRules: { defaultPriority: 'standard' }
};

const mockFns = (ftp as unknown as { __mocks: Record<string, any> }).__mocks;

describe('FtpSourceAdapter', () => {
  const factory = new DefaultSourceAdapterFactory();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the matching expedition record from FTP payloads', async () => {
    mockFns.listMock.mockResolvedValue([{ name: 'expeditions.json' }]);
    mockFns.downloadToMock.mockImplementation(async (destination: any) => {
      destination.write(Buffer.from(JSON.stringify([{ id: 'exp-1', state: 'in_transit' }])));
      destination.end();
    });

    const adapter = factory.buildAdapter(integration);
    const status = await adapter.fetchExpeditionStatus('exp-1', integration);

    expect(status).toEqual({
      externalState: 'in_transit',
      internalState: 'in_transit',
      rawPayload: { id: 'exp-1', state: 'in_transit' }
    });
    expect(mockFns.closeMock).toHaveBeenCalled();
  });

  it('closes the FTP client even when no record matches', async () => {
    mockFns.listMock.mockResolvedValue([{ name: 'expeditions.json' }]);
    mockFns.downloadToMock.mockImplementation(async (destination: any) => {
      destination.write(Buffer.from(JSON.stringify([{ id: 'other', state: 'delivered' }])));
      destination.end();
    });

    const adapter = factory.buildAdapter(integration);
    await expect(adapter.fetchExpeditionStatus('missing', integration)).rejects.toThrow(
      'Expedition missing not found in FTP payload'
    );
    expect(mockFns.closeMock).toHaveBeenCalled();
  });
});
