# Quest Live Deployment

## GitHub Pages

The GitHub Actions workflow at `.github/workflows/deploy-live.yml` builds only the `live/` app and deploys `live/dist` to GitHub Pages.

Before running the workflow, configure the repository:

1. Go to `Settings > Pages`.
2. Set **Build and deployment** source to **GitHub Actions**.
3. Go to `Settings > Secrets and variables > Actions`.
4. Add repository variable:
   - `VITE_SUPABASE_URL` = `https://geczcdirypydhrsvowsw.supabase.co`
5. Add repository secret:
   - `VITE_SUPABASE_PUBLISHABLE_KEY`

Do not commit `.env`, `.env.local`, service-role keys, database passwords, or AI provider keys.

## Supabase

Run `supabase/sql/001_live_mvp_schema.sql` in the Supabase SQL Editor to create the first live schema and RLS policies.

The frontend uses the Supabase project base URL:

```text
https://geczcdirypydhrsvowsw.supabase.co
```

Do not use the `/rest/v1/` API URL for the Supabase JS client config.
