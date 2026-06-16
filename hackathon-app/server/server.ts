import { createApp, analytics, lakebase, server } from '@databricks/appkit';
import { setupScenarioLakebaseRoutes } from './routes/lakebase/scenario-routes';
import { setupMappingRoutes } from './routes/mapping-routes';

createApp({
  plugins: [
    analytics({ timeout: 60_000 }),
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    await setupScenarioLakebaseRoutes(appkit);
    await setupMappingRoutes(appkit);
  },
}).catch(console.error);
