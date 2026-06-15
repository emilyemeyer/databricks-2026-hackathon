import { createApp, analytics, genie, lakebase, server, serving } from '@databricks/appkit';
import { setupScenarioLakebaseRoutes } from './routes/lakebase/scenario-routes';
import { setupMappingRoutes } from './routes/mapping-routes';

createApp({
  plugins: [
    analytics({ timeout: 60_000 }),
    genie(),
    lakebase(),
    server(),
    serving(),
  ],
  async onPluginsReady(appkit) {
    await setupScenarioLakebaseRoutes(appkit);
    await setupMappingRoutes(appkit);
  },
}).catch(console.error);
