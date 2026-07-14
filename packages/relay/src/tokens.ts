import { AccessToken, type VideoGrant } from 'livekit-server-sdk';
import type { Role } from '@soundsbored/contract';

export function buildGrant(role: Role, room: string): VideoGrant {
  if (role === 'publisher') {
    return { roomJoin: true, room, canPublish: true, canSubscribe: false };
  }
  return { roomJoin: true, room, canPublish: false, canSubscribe: true };
}

export async function mintToken(opts: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  room: string;
  role: Role;
}): Promise<string> {
  const { apiKey, apiSecret, identity, room, role } = opts;
  const at = new AccessToken(apiKey, apiSecret, { identity });
  at.addGrant(buildGrant(role, room));
  return await at.toJwt();
}
