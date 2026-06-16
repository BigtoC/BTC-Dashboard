import { defineConfig } from 'astro/config';

// Static site (SSG). The dashboard is fully client-side: it fetches public,
// keyless market data directly from Binance/Deribit/etc. in the browser,
// exactly like the original single-file HTML it replaces.
export default defineConfig({
  site: 'https://btc-dashboard.local',
  server: { port: 4321, host: true },
});
