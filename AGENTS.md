# Ship Shape core (public)

Ship Shape is a small Shape Up operating system backed by GitHub Issues. **This
repository is public.** A private hosted product consumes it one way, by pinning a
commit; nothing flows from the hosted product back into this repo except deliberate,
sanitised changes.

## Commands
- Dev: `npm ci && npm run dev` (demo mode without OAuth; no GitHub writes).
- Check before pushing: `npm run check` (tests and build).
- Self-hosting guide: `docs/self-hosting.md`.

## Rules (binding)
- This is public. Never commit hosted secrets, production configuration, tenancy,
  entitlement or billing code, managed-identity internals, customer data, private
  URLs, or screenshots and logs from the hosted service.
- Generic behaviour and its regression tests land here first; the hosted product
  integrates them afterwards. Keep the core runnable on its own in demo mode.
- Tickets, PRs, fixtures and evidence must be sanitised for public visibility. Use
  synthetic data.
- No hosted-production deploy workflow belongs in this repo.
- OAuth credentials and user tokens stay server-side; `.env*` stays ignored.

## Needs the maintainer's approval
Releases and tags, licence changes, repository visibility or history changes, OAuth
scope changes, and anything that commits the project publicly.
