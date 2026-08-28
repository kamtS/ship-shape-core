# Ship Shape

Ship Shape is a small, opinionated Shape Up operating system backed by GitHub Issues.

It keeps one loop deliberately clear:

1. capture an opportunity;
2. shape it with evidence, appetite, constraints, a solution sketch, risks, and a decision;
3. preview the exact GitHub write;
4. confirm it yourself;
5. treat the linked GitHub Issue as the canonical record.

It is not a board, backlog, Linear clone, or GitHub Projects wrapper.

## Try it locally

Requirements: Node.js 22+ and npm.

\`\`\`bash
npm ci
npm run dev
\`\`\`

Open [http://localhost:5173](http://localhost:5173). With no OAuth credentials, Ship Shape runs in an unmistakable demo mode and performs no GitHub writes.

## Add GitHub sign-in

Ship Shape supports a standard GitHub OAuth App for self-hosting. OAuth credentials and user tokens remain server-side.

1. Create a GitHub OAuth App.
2. For local development use:

   - Homepage URL: \`http://localhost:5173/\`
   - Authorization callback URL: \`http://localhost:8787/api/auth/github/callback\`

3. Copy the example configuration:

\`\`\`bash
cp .env.example .env
\`\`\`

4. Add the OAuth client ID, client secret, and a unique session secret of at least 32 characters.
5. Restart \`npm run dev\`, sign in, and explicitly choose the writable repository that will hold canonical bet Issues.

\`public_repo\` is the narrowest OAuth App scope that can create Issues in public repositories. Private repositories require the broader \`repo\` scope. A future GitHub App can provide selected-repository, Issues-only installation permissions.

## Safety boundaries

- Draft shaping and decision rationale remain in browser storage.
- GitHub owns linked Issue identity, title/body, state, labels, and assignees.
- Every write starts with a short-lived, session-bound exact preview and requires explicit confirmation.
- The MVP never deletes or closes Issues, changes labels or assignees, transfers Issues, or touches GitHub Projects.
- OAuth uses one-time state, PKCE, secure server-side token exchange, session rotation, CSRF checks, and HttpOnly cookies.
- Repository linkage is stored only after a confirmed write.
- Refresh from GitHub is explicit and reports the last sync.

## Architecture

- \`src/\` — focused React interface and browser-local draft repository.
- \`shared/pitch.ts\` — pitch model, readiness rules, and deterministic Markdown renderer.
- \`server/oauth.ts\` — generic OAuth configuration, PKCE/state, token lifecycle, identity, and repository reads.
- \`server/issueGateway.ts\` — demo and per-session GitHub Issue adapters.
- \`server/app.ts\` — sessions, repository selection, reads, previews, and confirmed writes.
- \`compose.yaml\` — single-instance self-hosting foundation with a private Redis session store.

The core has no dependency on a hosted Ship Shape service. Managed identity, tenants, entitlements, billing, customer operations, vendor-specific production configuration, and service secrets belong outside this repository. Integration points must remain documented, generic, and independently usable by self-hosters.

## Self-hosting

See [docs/self-hosting.md](docs/self-hosting.md). The Docker profile binds the application to loopback and keeps Redis private. Production requires HTTPS, a strong stable session secret, and server-only OAuth credentials.

## Verify

\`\`\`bash
npm run check
\`\`\`

This runs the safety, OAuth, gateway, and pitch tests, followed by the production TypeScript/Vite build.

## License

MIT. See [LICENSE](LICENSE).
