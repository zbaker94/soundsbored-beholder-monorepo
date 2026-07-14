export type Role = 'publisher' | 'subscriber';
export interface TokenRequest { room: string; role: Role; password: string }
export interface TokenResponse { token: string; url: string }
export interface TokenError { error: string }
export const ROLES: readonly Role[] = ['publisher', 'subscriber'];
