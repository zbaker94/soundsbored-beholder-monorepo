import type { TokenRequest, TokenResponse } from '@soundsbored/contract';

/** Everything a listener needs to obtain a subscriber token (Shared Contract C6). */
export interface ListenerConfig {
  tokenEndpoint: string;
  room: string;
  password: string;
}

export type FetchLike = typeof fetch;

/** Error thrown when the token endpoint rejects or is unreachable. */
export class TokenFetchError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TokenFetchError';
    this.status = status;
  }
}

/**
 * POST /token with role 'subscriber' (C4) and return `{ token, url }` (C6).
 * Throws {@link TokenFetchError} on a non-2xx response or a network failure.
 */
export async function fetchSubscriberToken(
  config: ListenerConfig,
  fetchImpl: FetchLike = fetch,
): Promise<TokenResponse> {
  const body: TokenRequest = {
    room: config.room,
    role: 'subscriber',
    password: config.password,
  };
  const endpoint = `${config.tokenEndpoint.replace(/\/+$/, '')}/token`;

  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new TokenFetchError('token endpoint unreachable', undefined, { cause: err });
  }

  if (!res.ok) {
    throw new TokenFetchError(`token request failed (${res.status})`, res.status);
  }

  const data = (await res.json()) as Partial<TokenResponse>;
  if (!data || typeof data.token !== 'string' || !data.token || typeof data.url !== 'string' || !data.url) {
    throw new TokenFetchError('malformed token response');
  }

  return { token: data.token, url: data.url };
}

/** Decode a base64url segment to a UTF-8 string (browser + Node ≥20 safe). */
function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Seconds-since-epoch expiry from a JWT, or null if unparseable. */
export function parseJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}
