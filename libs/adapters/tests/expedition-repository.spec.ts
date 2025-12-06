import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildPendingExpeditionRepositoryFromEnv, SaasPendingExpeditionRepository } from '../src/expedition-repository';
import { request } from 'undici';

vi.mock('undici', () => ({
  request: vi.fn()
}));

describe('SaasPendingExpeditionRepository', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates expeditions with defaults when fields are missing', async () => {
    (request as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      body: {
        async json() {
          return [
            { id: 'exp-1', priority: 'high' },
            { id: 'exp-2', clientId: 'client-override' }
          ];
        }
      }
    });

    const repo = new SaasPendingExpeditionRepository('https://saas.example.com', 'token-123');
    const result = await repo.listPendingExpeditions({
      id: 'int-1',
      clientId: 'client-default',
      sourceType: 'api',
      sourceConfig: {
        baseUrl: 'https://example.com',
        auth: { type: 'apiKey', headerName: 'X-Key', token: 'abc' },
        statusPathTemplate: '/:id'
      },
      stateMapping: [],
      detectionRules: { frequencySeconds: 60, maxPerRun: 5, rateLimit: { maxPerWindow: 10, windowSeconds: 60 } },
      priorityRules: { defaultPriority: 'standard' }
    });

    expect(request).toHaveBeenCalledWith(
      'https://saas.example.com/integrations/int-1/expeditions/pending',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-123' }) })
    );
    expect(result).toEqual([
      {
        id: 'exp-1',
        clientId: 'client-default',
        integrationId: 'int-1',
        lastKnownStatus: 'unknown',
        priority: 'high'
      },
      {
        id: 'exp-2',
        clientId: 'client-override',
        integrationId: 'int-1',
        lastKnownStatus: 'unknown',
        priority: 'standard'
      }
    ]);
  });

  it('throws when SaaS API responds with error', async () => {
    (request as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 500,
      body: { async json() { return []; } }
    });

    const repo = new SaasPendingExpeditionRepository('https://saas.example.com', 'token-123');
    await expect(
      repo.listPendingExpeditions({
        id: 'int-err',
        clientId: 'client-default',
        sourceType: 'api',
        sourceConfig: {
          baseUrl: 'https://example.com',
          auth: { type: 'apiKey', headerName: 'X-Key', token: 'abc' },
          statusPathTemplate: '/:id'
        },
        stateMapping: [],
        detectionRules: { frequencySeconds: 60, maxPerRun: 5, rateLimit: { maxPerWindow: 10, windowSeconds: 60 } },
        priorityRules: { defaultPriority: 'standard' }
      })
    ).rejects.toThrow('Failed to fetch pending expeditions for integration int-err');
  });
});

describe('buildPendingExpeditionRepositoryFromEnv', () => {
  afterEach(() => {
    delete process.env.SAAS_API_BASE_URL;
    delete process.env.SAAS_JWT_TOKEN;
  });

  it('throws when env vars are missing', () => {
    expect(() => buildPendingExpeditionRepositoryFromEnv()).toThrow('SAAS_API_BASE_URL and SAAS_JWT_TOKEN are required');
  });

  it('creates repository when env vars are present', () => {
    process.env.SAAS_API_BASE_URL = 'https://saas.example.com';
    process.env.SAAS_JWT_TOKEN = 'token-123';

    const repo = buildPendingExpeditionRepositoryFromEnv();
    expect(repo).toBeInstanceOf(SaasPendingExpeditionRepository);
  });
});
