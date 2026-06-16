import { defineConfig } from 'astro/config';

// Static site (SSG). The dashboard is fully client-side: it fetches public,
// keyless market data directly from Binance/Deribit/etc. in the browser,
// exactly like the original single-file HTML it replaces.
//
// Deployed to GitHub Pages as a *project* site at
// https://bigtoc.github.io/BTC-Dashboard/, so production assets must be served
// under the `/BTC-Dashboard` base. `base` is env-gated: the deploy workflow
// sets ASTRO_BASE for `astro build`, while `astro dev` / `astro check` / the
// Playwright e2e suite keep the root base ('/') so local URLs and the tests'
// `page.goto('/')` are unchanged.
const base = process.env.ASTRO_BASE || '/';

export default defineConfig({
  site: 'https://bigtoc.github.io',
  base,
  server: { port: 4321, host: true },
});
