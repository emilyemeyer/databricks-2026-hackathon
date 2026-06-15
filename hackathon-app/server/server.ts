import { createApp, analytics, genie, lakebase, server, serving } from '@databricks/appkit';
import { setupScenarioLakebaseRoutes } from './routes/lakebase/scenario-routes';

createApp({
  plugins: [
    analytics(),
    genie(),
    lakebase(),
    server(),
    serving(),
  ],
  async onPluginsReady(appkit) {
    await setupScenarioLakebaseRoutes(appkit);
  },
}).catch(console.error);
