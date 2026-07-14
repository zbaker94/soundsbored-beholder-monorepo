import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { ROLES, type TokenRequest } from '@soundsbored/contract';
import { mintToken } from './tokens.js';

let _counter = 0;

const TokenRequestSchema = z.object({
  room: z.string().min(1),
  role: z.enum(ROLES as [TokenRequest['role'], ...TokenRequest['role'][]]),
  password: z.string().min(1),
});

interface BuildServerDeps {
  apiKey: string;
  apiSecret: string;
  roomPassword: string;
  sfuUrl: string;
}

export function buildServer(deps: BuildServerDeps): FastifyInstance {
  const { apiKey, apiSecret, roomPassword, sfuUrl } = deps;

  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: '*',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });

  app.post('/token', async (request, reply) => {
    const parsed = TokenRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'bad request' });
    }

    const { room, role, password } = parsed.data as TokenRequest;

    if (password !== roomPassword) {
      return reply.status(401).send({ error: 'bad password' });
    }

    _counter += 1;
    const identity = `${role}-${room}-${_counter}`;

    let token: string;
    try {
      token = await mintToken({ apiKey, apiSecret, identity, room, role });
    } catch {
      return reply.status(500).send({ error: 'token generation failed' });
    }

    return reply.status(200).send({ token, url: sfuUrl });
  });

  app.get('/healthz', async (_request, reply) => {
    return reply.status(200).send({ ok: true });
  });

  return app;
}
