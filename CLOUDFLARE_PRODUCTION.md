# Mogu-Mogu Match production deployment

This site can run as a static Cloudflare Pages site, but friend match history and group logs need a shared backend.
Use Cloudflare Pages Functions + D1 for production.

## 1. Create the D1 database

Log in to Cloudflare with Wrangler, then create a D1 database.

```powershell
npx wrangler login
npx wrangler d1 create mogu_mogu_match
```

Copy the returned `database_id` into `wrangler.toml`.

```toml
[[d1_databases]]
binding = "DB"
database_name = "mogu_mogu_match"
database_id = "PASTE_DATABASE_ID_HERE"
```

## 2. Apply the database schema

```powershell
npx wrangler d1 execute mogu_mogu_match --remote --file=./schema.sql
```

## 3. Deploy Pages with Functions

Run this command from the project root, not from the `outputs` folder. The deploy script first generates the blog manifest and copies Markdown/assets into `outputs`, then Wrangler deploys the static site with Pages Functions.

```powershell
npm run deploy
```

When using Cloudflare Pages Git integration, set the build command to `npm run build` and the build output directory to `outputs`.

After deployment, check:

- `https://<project>.pages.dev/api/health`
- `https://<project>.pages.dev/`

`/api/health` should return:

```json
{"ok":true}
```

## 4. Connect the custom domain

In Cloudflare Dashboard:

1. Workers & Pages
2. Select the `mogu-mogu-match` Pages project
3. Custom domains
4. Set up a domain
5. Add the purchased domain, for example `mogumogumatch.com`

## 5. What is stored in D1

- `users`
  - code URL login data
  - nickname
  - current diagnosis result
  - diagnosis history
  - friend match history
  - group log participation history
- `group_logs`
  - group log name
  - capacity
  - members and their real axis scores

Friend match records and group tables use a 90-day sliding retention window. Reading, joining, or updating active data extends that window. Group creation is limited to five successful creations per user per minute; the sixth request receives HTTP 429.

Run the API regression test before deployment:

```powershell
npm run test:api
```

The current auth model is intentionally lightweight: the user code in the URL is the access key. Anyone with a mypage URL can open that mypage, so treat those URLs like private links.

## 6. Important note

The old drag-and-drop ZIP deploy is fine for a purely static preview, but it will not be enough for production friend/group sharing. Use the Wrangler deploy flow above so Pages Functions and D1 bindings are included.
