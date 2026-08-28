import { describe, expect, it } from 'vitest';
import { createOAuthAttempt, GitHubOAuthClient, readOAuthConfig, secureEqual, type OAuthConfig } from '../server/oauth.js';

const config: OAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  callbackUrl: 'http://localhost:8787/api/auth/github/callback',
  appUrl: 'http://localhost:5173',
  scope: 'public_repo',
};

describe('OAuth helpers', () => {
  it('creates high-entropy, expiring state and PKCE material', () => {
    const first = createOAuthAttempt();
    const second = createOAuthAttempt();
    expect(first.state.length).toBeGreaterThan(40);
    expect(first.codeVerifier.length).toBeGreaterThan(40);
    expect(first.codeChallenge.length).toBeGreaterThan(40);
    expect(first.state).not.toBe(second.state);
    expect(first.expiresAt).toBeGreaterThan(Date.now());
  });

  it('builds an authorization URL with state, PKCE, callback, and narrow public scope', () => {
    const url = new URL(new GitHubOAuthClient(config).authorizationUrl('state', 'challenge'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('state')).toBe('state');
    expect(url.searchParams.get('code_challenge')).toBe('challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('public_repo offline_access');
  });

  it('uses constant-time-compatible equality and rejects partial OAuth configuration', () => {
    expect(secureEqual('same', 'same')).toBe(true);
    expect(secureEqual('same', 'different')).toBe(false);
    expect(() => readOAuthConfig({ GITHUB_OAUTH_CLIENT_ID: 'only-one' })).toThrow(/requires/);
  });

  it('requires a strong session secret and only permits documented repository scopes', () => {
    expect(() => readOAuthConfig({
      GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_OAUTH_CLIENT_SECRET: 'secret', GITHUB_OAUTH_CALLBACK_URL: 'http://callback', SESSION_SECRET: 'short',
    })).toThrow(/32 characters/);
    expect(() => readOAuthConfig({
      GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_OAUTH_CLIENT_SECRET: 'secret', GITHUB_OAUTH_CALLBACK_URL: 'http://callback', SESSION_SECRET: 'x'.repeat(40), GITHUB_OAUTH_SCOPE: 'admin:org',
    })).toThrow(/public_repo or repo/);
  });
});
