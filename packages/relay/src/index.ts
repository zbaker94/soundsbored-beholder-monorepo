import { buildServer } from './server.js';

const port = parseInt(process.env['PORT'] ?? '8080', 10);
const apiKey = process.env['LIVEKIT_API_KEY'] ?? 'devkey';
const apiSecret = process.env['LIVEKIT_API_SECRET'] ?? 'secret';
const sfuUrl = process.env['SFU_URL'] ?? 'ws://localhost:7880';
const roomPassword = process.env['ROOM_PASSWORD'];

if (!roomPassword) {
  console.error('ROOM_PASSWORD environment variable is required');
  process.exit(1);
}

const app = buildServer({ apiKey, apiSecret, roomPassword, sfuUrl });

app.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Token service listening at ${address}`);
});
