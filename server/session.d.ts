import 'express-session';
import type { OAuthToken, RepositoryChoice } from './oauth.js';

declare module 'express-session' {
  interface SessionData {
    csrfToken: string;
    oauthAttempt?: { state: string; codeVerifier: string; expiresAt: number };
    github?: {
      userId: number;
      login: string;
      avatarUrl: string;
      token: OAuthToken;
      repository?: RepositoryChoice;
    };
  }
}
