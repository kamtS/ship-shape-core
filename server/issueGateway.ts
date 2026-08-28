export interface IssueRecord {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  updatedAt: string;
  isPullRequest?: boolean;
}

export interface IssueDraft {
  correlationId: string;
  title: string;
  body: string;
}

export interface IssueGateway {
  readonly mode: 'demo' | 'github';
  readonly owner: string;
  readonly repo: string;
  getIssue(number: number): Promise<IssueRecord>;
  findByCorrelationId(correlationId: string): Promise<IssueRecord | undefined>;
  createIssue(draft: IssueDraft): Promise<IssueRecord>;
  updateIssue(number: number, draft: IssueDraft): Promise<IssueRecord>;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export class DemoIssueGateway implements IssueGateway {
  readonly mode = 'demo' as const;
  readonly owner = 'demo-workspace';
  readonly repo = 'ship-shape-sandbox';
  private issues = new Map<number, IssueRecord>();
  private nextNumber = 41;

  async getIssue(number: number): Promise<IssueRecord> {
    const issue = this.issues.get(number);
    if (!issue) throw new GatewayError('Demo issue was not found. Create the bet again.', 404, 'not_found');
    return issue;
  }

  async findByCorrelationId(correlationId: string): Promise<IssueRecord | undefined> {
    return [...this.issues.values()].find((issue) => issue.body.includes(`pitch:${correlationId}`));
  }

  async createIssue(draft: IssueDraft): Promise<IssueRecord> {
    const number = this.nextNumber++;
    const issue: IssueRecord = {
      owner: this.owner,
      repo: this.repo,
      number,
      url: `https://github.com/${this.owner}/${this.repo}/issues/${number}`,
      title: draft.title,
      body: draft.body,
      state: 'open',
      updatedAt: new Date().toISOString(),
    };
    this.issues.set(number, issue);
    return issue;
  }

  async updateIssue(number: number, draft: IssueDraft): Promise<IssueRecord> {
    const existing = await this.getIssue(number);
    const issue = { ...existing, title: draft.title, body: draft.body, updatedAt: new Date().toISOString() };
    this.issues.set(number, issue);
    return issue;
  }
}

type GitHubIssueResponse = {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  updated_at: string;
  pull_request?: unknown;
};

export class GitHubIssueGateway implements IssueGateway {
  readonly mode = 'github' as const;

  constructor(
    private token: string,
    readonly owner: string,
    readonly repo: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      });
    } catch {
      throw new GatewayError('GitHub could not be reached. Your draft is safe; try again.', 503, 'network_error');
    }

    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? 'GitHub rejected the credentials or repository permission.'
        : response.status === 404
          ? 'The configured GitHub repository or issue was not found.'
          : `GitHub returned an unexpected ${response.status} response.`;
      throw new GatewayError(message, response.status, 'github_error');
    }
    return response.json() as Promise<T>;
  }

  private normalize(issue: GitHubIssueResponse): IssueRecord {
    return {
      owner: this.owner,
      repo: this.repo,
      number: issue.number,
      url: issue.html_url,
      title: issue.title,
      body: issue.body ?? '',
      state: issue.state,
      updatedAt: issue.updated_at,
      isPullRequest: Boolean(issue.pull_request),
    };
  }

  async getIssue(number: number): Promise<IssueRecord> {
    return this.normalize(await this.request<GitHubIssueResponse>(`/repos/${this.owner}/${this.repo}/issues/${number}`));
  }

  async findByCorrelationId(correlationId: string): Promise<IssueRecord | undefined> {
    const issues = await this.request<GitHubIssueResponse[]>(
      `/repos/${this.owner}/${this.repo}/issues?state=all&per_page=100&sort=updated`,
    );
    const marker = `pitch:${correlationId}`;
    const match = issues.find((issue) => issue.body?.includes(marker));
    return match ? this.normalize(match) : undefined;
  }

  async createIssue(draft: IssueDraft): Promise<IssueRecord> {
    const existing = await this.findByCorrelationId(draft.correlationId);
    if (existing) return existing;
    const issue = await this.request<GitHubIssueResponse>(`/repos/${this.owner}/${this.repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title: draft.title, body: draft.body }),
    });
    return this.normalize(issue);
  }

  async updateIssue(number: number, draft: IssueDraft): Promise<IssueRecord> {
    const issue = await this.request<GitHubIssueResponse>(`/repos/${this.owner}/${this.repo}/issues/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: draft.title, body: draft.body }),
    });
    return this.normalize(issue);
  }
}
