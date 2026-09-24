# igscript.com production source

This branch is a snapshot of the complete Cloudflare Pages deployment source for igscript.com as of September 25, 2026. It includes the static site, Pages Functions, `_routes.json`, redirects, assets, and the live legal pages.

## Deploy

Deploy from this repository root so that the static assets and Pages Functions are uploaded together:

```bash
npx wrangler pages deploy . --project-name=igscript
```

The Cloudflare Pages project supplies its environment variables. Do not commit credentials, API keys, OAuth client files, access tokens, or `.dev.vars` files.

## Verification

After a deployment, verify the public pages and the API baseline:

- `POST /api/transcript` returns 400 without a required input.
- `POST /api/pro-status` returns 200.
- `POST /api/pro-create-order` returns 200.
- `POST /api/pro-activate` returns 400 without required input.
- `POST /api/usage` returns 405.

The privacy and terms pages are available at `/privacy` and `/terms`.
