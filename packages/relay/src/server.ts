import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { ROLES, type TokenError } from '@soundsbored/contract';
import { mintToken } from './tokens.js';

const TokenRequestSchema = z.object({
  room: z.string().min(1),
  role: z.enum(ROLES),
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

  // Per-server monotonic suffix for participant identities — scoped to this
  // instance so separate buildServer() calls (e.g. tests) don't share state.
  // It guarantees uniqueness but nothing more: it restarts at 1 with the
  // process, so on its own the Nth joiner always lands on the same identity.
  let tokenSeq = 0;

  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: '*',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });

  app.post('/token', async (request, reply) => {
    const parsed = TokenRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'bad request' } satisfies TokenError);
    }

    const { room, role, password } = parsed.data;

    if (password !== roomPassword) {
      return reply.status(401).send({ error: 'bad password' } satisfies TokenError);
    }

    tokenSeq += 1;
    // The random half is what clients hash to pick an avatar, so it has to vary
    // per connection rather than per join order; the counter keeps the whole
    // thing unique even if two randoms ever collided.
    const identity = `${role}-${room}-${tokenSeq}-${randomUUID().slice(0, 8)}`;

    let token: string;
    try {
      token = await mintToken({ apiKey, apiSecret, identity, room, role });
    } catch {
      // No error logging here by design: the security scanner forbids logging in
      // this credential-handling module, and the 500 status already signals the
      // failure. See the accepted-debt note on the error_consistency finding.
      return reply.status(500).send({ error: 'token generation failed' } satisfies TokenError);
    }

    return reply.status(200).send({ token, url: sfuUrl });
  });

  app.get('/healthz', async (_request, reply) => {
    return reply.status(200).send({ ok: true });
  });

  return app;
}
