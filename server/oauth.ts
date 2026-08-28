import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { GatewayError } from './issueGateway.js';

export type OAuthScope = 'public_repo' | 'repo';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  appUrl: string;
  scope: OAuthScope;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  scope: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatarUrl: string;
}

export interface RepositoryChoice {
  id: number;
  owner: string;
  repo: string;
  fullName: string;
  private: boolean;
}

type GitHubUserResponse = { id: number; login: string; avatar_url: string };
type GitHubRepositoryResponse = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  has_issues: boolean;
  owner: { login: string };
  permissions?: { push?: boolean };
};

export type FetchLike = typeof fetch;

export function readOAuthConfig(env: NodeJS.ProcessEnv): OAuthConfig | undefined {
  const values = [env.GITHUB_OAUTH_CLIENT_ID, env.GITHUB_OAUTH_CLIENT_SECRET, env.GITHUB_OAUTH_CALLBACK_URL];
  if (values.every((value) => !value?.trim())) return undefined;
  if (values.some((value) => !value?.trim())) {
    throw new Error('GitHub OAuth requires GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and GITHUB_OAUTH_CALLBACK_URL.');
  }
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters when GitHub OAuth is configured.');
  }
  const scope = env.GITHUB_OAUTH_SCOPE?.trim() || 'public_repo';
  if (scope !== 'public_repo' && scope !== 'repo') {
    throw new Error('GITHUB_OAUTH_SCOPE must be public_repo or repo.');
  }
  return {
    clientId: values[0]!.trim(),
    clientSecret: values[1]!.trim(),
    callbackUrl: values[2]!.trim(),
    appUrl: env.APP_URL?.trim() || 'http://localhost:5173',
    scope,
  };
}

export function createOAuthAttempt() {
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { state, codeVerifier, codeChallenge, expiresAt: Date.now() + 10 * 60 * 1000 };
}

export function secureEqual(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class GitHubOAuthClient {
  constructor(private config: OAuthConfig, private fetchImpl: FetchLike = fetch) {}

  authorizationUrl(state: string, codeChallenge: string): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.callbackUrl);
    url.searchParams.set('scope', `${this.config.scope} offline_access`);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  private normalizeToken(body: Record<string, unknown>): OAuthToken {
    if (typeof body.access_token !== 'string') throw new GatewayError('GitHub did not return an access token.', 502, 'oauth_exchange_failed');
    const now = Date.now();
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
      expiresAt: typeof body.expires_in === 'number' ? now + body.expires_in * 1000 : undefined,
      refreshTokenExpiresAt: typeof body.refresh_token_expires_in === 'number' ? now + body.refresh_token_expires_in * 1000 : undefined,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  }

  private async tokenRequest(body: URLSearchParams): Promise<OAuthToken> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new GatewayError('GitHub sign-in could not be reached.', 503, 'oauth_network_error');
    }
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || payload.error) throw new GatewayError('GitHub sign-in could not be completed.', 502, 'oauth_exchange_failed');
    return this.normalizeToken(payload);
  }

  exchangeCode(code: string, codeVerifier: string): Promise<OAuthToken> {
    return this.tokenRequest(new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.callbackUrl,
      code_verifier: codeVerifier,
    }));
  }

  refreshToken(refreshToken: string): Promise<OAuthToken> {
    return this.tokenRequest(new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }));
  }

  private async api<T>(token: string, path: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.github.com${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch {
      throw new GatewayError('GitHub could not be reached.', 503, 'github_network_error');
    }
    if (!response.ok) throw new GatewayError('GitHub rejected this session or permission.', response.status, 'github_auth_error');
    return response.json() as Promise<T>;
  }

  async getUser(token: string): Promise<GitHubUser> {
    const user = await this.api<GitHubUserResponse>(token, '/user');
    return { id: user.id, login: user.login, avatarUrl: user.avatar_url };
  }

  async listRepositories(token: string): Promise<RepositoryChoice[]> {
    const repos = await this.api<GitHubRepositoryResponse[]>(token, '/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100');
    return repos.filter((repo) => repo.has_issues && repo.permissions?.push).map((repo) => ({
      id: repo.id,
      owner: repo.owner.login,
      repo: repo.name,
      fullName: repo.full_name,
      private: repo.private,
    }));
  }

  async validateRepository(token: string, owner: string, repo: string): Promise<RepositoryChoice> {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
      throw new GatewayError('Invalid repository selection.', 400, 'invalid_repository');
    }
    const record = await this.api<GitHubRepositoryResponse>(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    if (!record.has_issues || !record.permissions?.push) {
      throw new GatewayError('This repository does not allow this account to write Issues.', 403, 'repository_not_writable');
    }
    return { id: record.id, owner: record.owner.login, repo: record.name, fullName: record.full_name, private: record.private };
  }
}
