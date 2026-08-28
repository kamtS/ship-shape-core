import type { GitHubSnapshot, Pitch } from '../shared/pitch';

export type RepositoryChoice = { id: number; owner: string; repo: string; fullName: string; private: boolean };
export type AppConfig = {
  mode: 'demo' | 'github';
  csrfToken: string;
  owner: string;
  repo: string;
  auth: { configured: boolean; signedIn: boolean; user?: { id: number; login: string; avatarUrl: string } };
  repository?: RepositoryChoice;
  oauthScope?: 'public_repo' | 'repo';
};
export type IssuePreview = {
  previewId: string;
  action: 'create' | 'update';
  issueNumber?: number;
  target: string;
  title: string;
  body: string;
  expiresAt: string;
};

let csrfToken = '';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.method && init.method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export const api = {
  config: async () => {
    const config = await request<AppConfig>('/api/config');
    csrfToken = config.csrfToken;
    return config;
  },
  repositories: () => request<{ repositories: RepositoryChoice[]; limitedTo: number }>('/api/repositories'),
  selectRepository: (owner: string, repo: string) => request<{ repository: RepositoryChoice }>('/api/repository', {
    method: 'POST', body: JSON.stringify({ owner, repo }),
  }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  preview: (pitch: Pitch) => request<IssuePreview>('/api/issues/preview', {
    method: 'POST', body: JSON.stringify({ pitch }),
  }),
  confirm: (previewId: string) => request<GitHubSnapshot>('/api/issues/confirm', {
    method: 'POST', body: JSON.stringify({ previewId, confirmed: true }),
  }),
  refresh: (pitch: Pitch) => {
    if (!pitch.github) throw new Error('This pitch is not linked to an issue.');
    const query = new URLSearchParams({ pitchId: pitch.id, owner: pitch.github.owner, repo: pitch.github.repo });
    return request<GitHubSnapshot>(`/api/issues/${pitch.github.number}?${query}`);
  },
};
