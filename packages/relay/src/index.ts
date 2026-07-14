import { pathToFileURL } from 'node:url';
import { buildServer } from './server.js';

interface ServerConfig {
  port: number;
  deps: {
    apiKey: string;
    apiSecret: string;
    roomPassword: string;
    sfuUrl: string;
  };
}

/** Resolve server config from the environment, applying C8 defaults.
 *  Throws if the required ROOM_PASSWORD is unset (C8: "exit 1 if unset"). */
export function resolveConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const roomPassword = env['ROOM_PASSWORD'];
  if (!roomPassword) {
    throw new Error('ROOM_PASSWORD environment variable is required');
  }
  return {
    port: parseInt(env['PORT'] ?? '8080', 10),
    deps: {
      apiKey: env['LIVEKIT_API_KEY'] ?? 'devkey',
      apiSecret: env['LIVEKIT_API_SECRET'] ?? 'secret',
      sfuUrl: env['SFU_URL'] ?? 'ws://localhost:7880',
      roomPassword,
    },
  };
}

/** Build and start the token service. Returns the bound address. */
export async function start(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const { port, deps } = resolveConfig(env);
  const app = buildServer(deps);
  return app.listen({ port, host: '0.0.0.0' });
}

/** True when this module is the process entry point (run directly, not imported). */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  return argv1 !== undefined && import.meta.url === pathToFileURL(argv1).href;
}

if (isEntryPoint()) {
  start()
    .then((address) => {
      console.log(`Token service listening at ${address}`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
