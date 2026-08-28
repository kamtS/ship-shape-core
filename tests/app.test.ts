import { describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../server/app.js';
import type { OAuthConfig } from '../server/oauth.js';
import { createEmptyPitch, type Pitch } from '../shared/pitch.js';

function completePitch(id = 'pitch-app-test'): Pitch {
  return {
    ...createEmptyPitch(), id, title: 'A bounded bet', problem: 'A real problem', evidence: 'Repeated evidence',
    appetite: 'One week', constraints: 'No automation', solution: 'A focused flow', risks: 'One known risk',
    decision: 'bet', decisionRationale: 'Worth the appetite',
  };
}

describe('app safety boundary', () => {
  it('serves liveness without creating a session and reports readiness failures', async () => {
    const healthy = createApp({ sessionSecret: 'test-secret'.repeat(4), readinessCheck: async () => undefined });
    const liveness = await supertest(healthy).get('/healthz').expect(200);
    expect(liveness.body).toEqual({ status: 'ok', mode: 'demo' });
    expect(liveness.headers['set-cookie']).toBeUndefined();
    await supertest(healthy).get('/readyz').expect(200, { status: 'ready' });

    const unavailable = createApp({ sessionSecret: 'test-secret'.repeat(4), readinessCheck: async () => { throw new Error('store unavailable'); } });
    await supertest(unavailable).get('/readyz').expect(503, { status: 'not-ready' });
  });

  it('keeps demo mode anonymous but requires CSRF and explicit confirmation', async () => {
    const agent = supertest.agent(createApp({ sessionSecret: 'test-secret'.repeat(4) }));
    const config = await agent.get('/api/config').expect(200);
    expect(config.body.mode).toBe('demo');

    await agent.post('/api/issues/preview').send({ pitch: completePitch() }).expect(403);
    const preview = await agent.post('/api/issues/preview').set('X-CSRF-Token', config.body.csrfToken).send({ pitch: completePitch() }).expect(200);
    await agent.post('/api/issues/confirm').set('X-CSRF-Token', config.body.csrfToken).send({ previewId: preview.body.previewId, confirmed: false }).expect(400);
    const issue = await agent.post('/api/issues/confirm').set('X-CSRF-Token', config.body.csrfToken).send({ previewId: preview.body.previewId, confirmed: true }).expect(200);
    expect(issue.body.number).toBe(41);
    await agent.post('/api/issues/confirm').set('X-CSRF-Token', config.body.csrfToken).send({ previewId: preview.body.previewId, confirmed: true }).expect(410);
  });

  it('binds a preview to the browser session that created it', async () => {
    const app = createApp({ sessionSecret: 'test-secret'.repeat(4) });
    const owner = supertest.agent(app);
    const other = supertest.agent(app);
    const ownerConfig = await owner.get('/api/config');
    const otherConfig = await other.get('/api/config');
    const preview = await owner.post('/api/issues/preview').set('X-CSRF-Token', ownerConfig.body.csrfToken).send({ pitch: completePitch() });
    await other.post('/api/issues/confirm').set('X-CSRF-Token', otherConfig.body.csrfToken).send({ previewId: preview.body.previewId, confirmed: true }).expect(403);
  });

  it('caps pending previews per browser session', async () => {
    const agent = supertest.agent(createApp({ sessionSecret: 'test-secret'.repeat(4) }));
    const config = await agent.get('/api/config');
    for (let index = 0; index < 20; index += 1) {
      await agent.post('/api/issues/preview').set('X-CSRF-Token', config.body.csrfToken).send({ pitch: completePitch(`pitch-${index}`) }).expect(200);
    }
    await agent.post('/api/issues/preview').set('X-CSRF-Token', config.body.csrfToken).send({ pitch: completePitch('pitch-over-limit') }).expect(429);
  });
});

describe('GitHub OAuth flow', () => {
  const oauthConfig: OAuthConfig = {
    clientId: 'client-id', clientSecret: 'client-secret', callbackUrl: 'http://localhost:8787/api/auth/github/callback',
    appUrl: 'http://localhost:5173/app', scope: 'public_repo',
  };

  it('rejects a mismatched one-time state without exchanging a token', async () => {
    const fetchMock = vi.fn();
    const agent = supertest.agent(createApp({ oauthConfig, sessionSecret: 's'.repeat(40), fetchImpl: fetchMock as unknown as typeof fetch }));
    await agent.get('/api/auth/github').expect(302);
    await agent.get('/api/auth/github/callback?code=code&state=wrong').expect(302).expect('Location', 'http://localhost:5173/app?auth=failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the code server-side, rotates the session, and never exposes the token', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.includes('/login/oauth/access_token')) return Response.json({ access_token: 'super-secret-token', scope: 'public_repo' });
      if (value.endsWith('/user')) return Response.json({ id: 123, login: 'shape-user', avatar_url: 'https://avatars.githubusercontent.com/u/123' });
      throw new Error(`Unexpected URL: ${value}`);
    });
    const agent = supertest.agent(createApp({ oauthConfig, sessionSecret: 's'.repeat(40), fetchImpl: fetchMock as unknown as typeof fetch }));
    const start = await agent.get('/api/auth/github').expect(302);
    const state = new URL(start.headers.location).searchParams.get('state');
    const beforeCookie = start.headers['set-cookie']?.[0];
    const callback = await agent.get(`/api/auth/github/callback?code=valid-code&state=${encodeURIComponent(state!)}`).expect(302);
    expect(callback.headers.location).toBe('http://localhost:5173/app?auth=success');
    const afterCookie = callback.headers['set-cookie']?.[0];
    expect(afterCookie).not.toBe(beforeCookie);
    const status = await agent.get('/api/config').expect(200);
    expect(status.body.auth).toMatchObject({ configured: true, signedIn: true, user: { id: 123, login: 'shape-user' } });
    expect(JSON.stringify(status.body)).not.toContain('super-secret-token');
  });

  it('requires authentication for repositories and GitHub issue routes', async () => {
    const app = createApp({ oauthConfig, sessionSecret: 's'.repeat(40), fetchImpl: vi.fn() as unknown as typeof fetch });
    const agent = supertest.agent(app);
    const config = await agent.get('/api/config');
    await agent.get('/api/repositories').expect(401);
    await agent.post('/api/issues/preview').set('X-CSRF-Token', config.body.csrfToken).send({ pitch: completePitch() }).expect(401);
  });
});
