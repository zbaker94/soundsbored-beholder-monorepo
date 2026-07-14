/** The two token roles; single source of truth for the {@link Role} union. */
export const ROLES = ['publisher', 'subscriber'] as const;
export type Role = (typeof ROLES)[number];
export interface TokenRequest { room: string; role: Role; password: string }
export interface TokenResponse { token: string; url: string }
export interface TokenError { error: string }
