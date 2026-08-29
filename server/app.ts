import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { canPreviewBet, renderIssueBody, type Pitch } from '../shared/pitch.js';
import { DemoIssueGateway, GatewayError, GitHubIssueGateway, type IssueGateway } from './issueGateway.js';
import {
  createOAuthAttempt,
  GitHubOAuthClient,
  secureEqual,
  type FetchLike,
  type OAuthConfig,
} from './oauth.js';

type Preview = {
  id: string;
  sessionId: string;
  repositoryKey: string;
  pitchId: string;
  action: 'create' | 'update';
  issueNumber?: number;
  expectedUpdatedAt?: string;
  title: string;
  body: string;
  expiresAt: number;
};

export interface AppOptions {
  oauthConfig?: OAuthConfig;
  sessionSecret?: string;
  secureCookies?: boolean;
  trustProxy?: boolean;
  fetchImpl?: FetchLike;
  demoGateway?: DemoIssueGateway;
  staticDir?: string;
  sessionStore?: session.Store;
  readinessCheck?: () => Promise<void>;
}

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);
}

function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const oauthConfig = options.oauthConfig;
  const oauthClient = oauthConfig ? new GitHubOAuthClient(oauthConfig, options.fetchImpl) : undefined;
  const demoGateway = options.demoGateway ?? new DemoIssueGateway();
  const previews = new Map<string, Preview>();
  const cookieName = 'shipshape.sid';
  const previewLimitPerSession = 20;
  const previewLimitGlobal = 1_000;

  function pruneExpiredPreviews() {
    const now = Date.now();
    for (const [id, preview] of previews) if (preview.expiresAt < now) previews.delete(id);
  }

  const previewSweeper = setInterval(pruneExpiredPreviews, 60_000);
  previewSweeper.unref();

  if (options.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://avatars.githubusercontent.com'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/healthz', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok', mode: oauthConfig ? 'github-oauth' : 'demo' });
  });
  app.get('/readyz', asyncRoute(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await options.readinessCheck?.();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not-ready' });
    }
  }));

  app.use(session({
    name: cookieName,
    secret: options.sessionSecret || randomBytes(48).toString('base64url'),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: options.sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: options.secureCookies ?? false,
      maxAge: 8 * 60 * 60 * 1000,
    },
  }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('base64url');
    next();
  });

  const sessionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false });
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
  const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
  app.use('/api/config', sessionLimiter);
  app.use('/api/auth/github', authLimiter);
  app.use('/api/issues/preview', writeLimiter);
  app.use('/api/issues/confirm', writeLimiter);
  app.use('/api/repository', writeLimiter);

  function rejectCsrf(req: Request, res: Response, next: NextFunction) {
    const provided = req.get('X-CSRF-Token');
    if (!secureEqual(provided, req.session.csrfToken)) return res.status(403).json({ error: 'The session safety token is missing or invalid.' });
    next();
  }

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!oauthConfig) return next();
    if (!req.session.github) return res.status(401).json({ error: 'Sign in with GitHub first.', code: 'not_authenticated' });
    next();
  }

  function removeSessionPreviews(sessionId: string) {
    for (const [id, preview] of previews) if (preview.sessionId === sessionId) previews.delete(id);
  }

  async function accessToken(req: Request): Promise<string> {
    const github = req.session.github;
    if (!github || !oauthClient) throw new GatewayError('Sign in with GitHub first.', 401, 'not_authenticated');
    if (!github.token.expiresAt || github.token.expiresAt > Date.now() + 60_000) return github.token.accessToken;
    if (!github.token.refreshToken || (github.token.refreshTokenExpiresAt && github.token.refreshTokenExpiresAt <= Date.now())) {
      delete req.session.github;
      throw new GatewayError('Your GitHub session expired. Sign in again.', 401, 'session_expired');
    }
    github.token = await oauthClient.refreshToken(github.token.refreshToken);
    await saveSession(req);
    return github.token.accessToken;
  }

  async function gatewayFor(req: Request): Promise<IssueGateway> {
    if (!oauthConfig) return demoGateway;
    const repository = req.session.github?.repository;
    if (!repository) throw new GatewayError('Choose a GitHub repository before making a bet.', 409, 'repository_required');
    return new GitHubIssueGateway(await accessToken(req), repository.owner, repository.repo);
  }

  function repositoryKey(req: Request): string {
    if (!oauthConfig) return `${demoGateway.owner}/${demoGateway.repo}`;
    const repository = req.session.github?.repository;
    if (!repository) throw new GatewayError('Choose a GitHub repository before making a bet.', 409, 'repository_required');
    return `${repository.owner}/${repository.repo}`;
  }

  app.get('/api/config', (req, res) => {
    const github = req.session.github;
    const repository = github?.repository;
    res.json({
      mode: oauthConfig ? 'github' : 'demo',
      csrfToken: req.session.csrfToken,
      owner: repository?.owner ?? (oauthConfig ? '' : demoGateway.owner),
      repo: repository?.repo ?? (oauthConfig ? '' : demoGateway.repo),
      auth: oauthConfig ? {
        configured: true,
        signedIn: Boolean(github),
        user: github ? { id: github.userId, login: github.login, avatarUrl: github.avatarUrl } : undefined,
      } : { configured: false, signedIn: false },
      repository,
      oauthScope: oauthConfig?.scope,
    });
  });

  app.get('/api/auth/github', asyncRoute(async (req, res) => {
    if (!oauthClient) return res.status(404).json({ error: 'GitHub OAuth is not configured. Demo mode is active.' });
    const attempt = createOAuthAttempt();
    req.session.oauthAttempt = { state: attempt.state, codeVerifier: attempt.codeVerifier, expiresAt: attempt.expiresAt };
    await saveSession(req);
    res.redirect(oauthClient.authorizationUrl(attempt.state, attempt.codeChallenge));
  }));

  app.get('/api/auth/github/callback', asyncRoute(async (req, res) => {
    if (!oauthClient || !oauthConfig) return res.status(404).send('GitHub OAuth is not configured.');
    const attempt = req.session.oauthAttempt;
    delete req.session.oauthAttempt;
    await saveSession(req);
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const valid = attempt && attempt.expiresAt > Date.now() && secureEqual(state, attempt.state) && code;
    if (!valid) return res.redirect(new URL('?auth=failed', oauthConfig.appUrl).toString());

    const token = await oauthClient.exchangeCode(code, attempt.codeVerifier);
    const grantedScopes = new Set(token.scope.split(',').map((scope) => scope.trim()).filter(Boolean));
    if (!grantedScopes.has(oauthConfig.scope)) {
      return res.redirect(new URL('?auth=failed', oauthConfig.appUrl).toString());
    }
    const user = await oauthClient.getUser(token.accessToken);
    await regenerate(req);
    req.session.csrfToken = randomBytes(32).toString('base64url');
    req.session.github = { userId: user.id, login: user.login, avatarUrl: user.avatarUrl, token };
    await saveSession(req);
    res.redirect(new URL('?auth=success', oauthConfig.appUrl).toString());
  }));

  app.post('/api/auth/logout', rejectCsrf, asyncRoute(async (req, res) => {
    removeSessionPreviews(req.sessionID);
    await destroySession(req);
    res.clearCookie(cookieName, { httpOnly: true, sameSite: 'lax', secure: options.secureCookies ?? false });
    res.status(204).end();
  }));

  app.get('/api/repositories', requireAuth, asyncRoute(async (req, res) => {
    if (!oauthClient) return res.json({ repositories: [], limitedTo: 0 });
    const repositories = await oauthClient.listRepositories(await accessToken(req));
    res.json({ repositories, limitedTo: 100 });
  }));

  app.post('/api/repository', requireAuth, rejectCsrf, asyncRoute(async (req, res) => {
    if (!oauthClient || !req.session.github) throw new GatewayError('Sign in with GitHub first.', 401, 'not_authenticated');
    const owner = typeof req.body?.owner === 'string' ? req.body.owner : '';
    const repo = typeof req.body?.repo === 'string' ? req.body.repo : '';
    const repository = await oauthClient.validateRepository(await accessToken(req), owner, repo);
    removeSessionPreviews(req.sessionID);
    req.session.github.repository = repository;
    await saveSession(req);
    res.json({ repository });
  }));

  app.post('/api/issues/preview', requireAuth, rejectCsrf, asyncRoute(async (req, res) => {
    const pitch = req.body?.pitch as Pitch | undefined;
    if (!pitch?.id || pitch.id.length > 100 || !pitch.title?.trim() || pitch.title.trim().length > 256) {
      return res.status(400).json({ error: 'A valid titled pitch is required.' });
    }
    if (!canPreviewBet(pitch)) return res.status(400).json({ error: 'Only a pitch at the bet rung, with a complete shape and the Bet decision, can preview a write.' });

    const gateway = await gatewayFor(req);
    const target = repositoryKey(req);
    pruneExpiredPreviews();
    for (const [id, existing] of previews) {
      if (existing.sessionId === req.sessionID && existing.pitchId === pitch.id) previews.delete(id);
    }
    const sessionPreviewCount = [...previews.values()].filter((item) => item.sessionId === req.sessionID).length;
    if (sessionPreviewCount >= previewLimitPerSession || previews.size >= previewLimitGlobal) {
      return res.status(429).json({ error: 'Too many pending previews. Confirm, cancel, or wait for them to expire.' });
    }
    const issueNumber = pitch.github?.number;
    if (issueNumber && (!Number.isSafeInteger(issueNumber) || issueNumber <= 0)) return res.status(400).json({ error: 'Invalid linked issue number.' });
    if (issueNumber && pitch.github && (pitch.github.owner !== gateway.owner || pitch.github.repo !== gateway.repo)) {
      return res.status(409).json({ error: 'This pitch is linked to a different repository. Cross-repository writes are not allowed.' });
    }

    let expectedUpdatedAt: string | undefined;
    if (issueNumber) {
      const current = await gateway.getIssue(issueNumber);
      if (current.isPullRequest) return res.status(409).json({ error: 'Pull requests cannot be used as canonical bet issues.' });
      if (!current.body.includes(`ship-shape:v1 pitch:${pitch.id}`)) {
        return res.status(409).json({ error: 'The linked GitHub issue does not belong to this pitch.' });
      }
      expectedUpdatedAt = current.updatedAt;
      if (pitch.github?.updatedAt && current.updatedAt !== pitch.github.updatedAt) {
        return res.status(409).json({ error: 'The GitHub issue changed since your last refresh. Refresh before preparing an update.', code: 'remote_changed' });
      }
    }

    const body = renderIssueBody(pitch);
    if (body.length > 65_536) return res.status(400).json({ error: 'The shaped pitch is too large for one GitHub Issue.' });
    const preview: Preview = {
      id: randomUUID(), sessionId: req.sessionID, repositoryKey: target, pitchId: pitch.id,
      action: issueNumber ? 'update' : 'create', issueNumber, expectedUpdatedAt,
      title: pitch.title.trim(), body, expiresAt: Date.now() + 10 * 60 * 1000,
    };
    previews.set(preview.id, preview);
    res.json({ previewId: preview.id, action: preview.action, issueNumber, target, title: preview.title, body, expiresAt: new Date(preview.expiresAt).toISOString() });
  }));

  app.post('/api/issues/confirm', requireAuth, rejectCsrf, asyncRoute(async (req, res) => {
    pruneExpiredPreviews();
    const previewId = typeof req.body?.previewId === 'string' ? req.body.previewId : undefined;
    if (req.body?.confirmed !== true || !previewId) return res.status(400).json({ error: 'Explicit confirmation of a valid preview is required.' });
    const preview = previews.get(previewId);
    if (!preview || preview.expiresAt < Date.now()) return res.status(410).json({ error: 'The preview expired. Review the write again.' });
    if (preview.sessionId !== req.sessionID || preview.repositoryKey !== repositoryKey(req)) {
      return res.status(403).json({ error: 'This preview does not belong to the current session and repository.' });
    }
    previews.delete(previewId);
    const gateway = await gatewayFor(req);
    if (preview.action === 'update' && preview.issueNumber) {
      const current = await gateway.getIssue(preview.issueNumber);
      if (current.isPullRequest || !current.body.includes(`ship-shape:v1 pitch:${preview.pitchId}`)) {
        return res.status(409).json({ error: 'The linked issue is no longer a valid canonical bet.' });
      }
      if (current.updatedAt !== preview.expectedUpdatedAt) return res.status(409).json({ error: 'The GitHub issue changed after preview. Refresh and review it again.' });
    }
    const draft = { correlationId: preview.pitchId, title: preview.title, body: preview.body };
    const issue = preview.action === 'update' && preview.issueNumber
      ? await gateway.updateIssue(preview.issueNumber, draft)
      : await gateway.createIssue(draft);
    res.json({ ...issue, lastSyncedAt: new Date().toISOString() });
  }));

  app.get('/api/issues/:number', requireAuth, asyncRoute(async (req, res) => {
    const number = Number(req.params.number);
    if (!Number.isSafeInteger(number) || number <= 0) return res.status(400).json({ error: 'Invalid issue number.' });
    const pitchId = typeof req.query.pitchId === 'string' ? req.query.pitchId : '';
    const owner = typeof req.query.owner === 'string' ? req.query.owner : '';
    const repo = typeof req.query.repo === 'string' ? req.query.repo : '';
    const gateway = await gatewayFor(req);
    if (!pitchId || owner !== gateway.owner || repo !== gateway.repo) {
      return res.status(409).json({ error: 'The linked issue does not match the current pitch and repository.' });
    }
    const issue = await gateway.getIssue(number);
    if (issue.isPullRequest) return res.status(409).json({ error: 'Pull requests cannot be canonical bet issues.' });
    if (!issue.body.includes(`ship-shape:v1 pitch:${pitchId}`)) {
      return res.status(409).json({ error: 'The linked GitHub issue does not belong to this pitch.' });
    }
    res.json({ ...issue, lastSyncedAt: new Date().toISOString() });
  }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof GatewayError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error(error instanceof Error ? error.message : 'Unknown server error');
    res.status(500).json({ error: 'Something went wrong. Your local draft is unchanged.' });
  });

  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.use((_req, res) => res.sendFile(path.join(options.staticDir!, 'index.html')));
  }
  return app;
}
