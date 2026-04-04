import type { OAuthConnection } from "@stackframe/react";

/**
 * Extract a fresh access token from a Stack Auth OAuth connection.
 * Shared by all provider-specific hooks (Gmail, GitHub, etc.).
 */
export async function getOAuthToken(account: OAuthConnection): Promise<string> {
  const result = await account.getAccessToken();
  if (result.status !== "ok") throw new Error("Failed to get access token");
  return result.data.accessToken;
}

/** Compute display initials from a name/email pair. */
export function getInitials(name?: string | null, email?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const a = parts[0]?.[0] ?? "";
      const b = parts[parts.length - 1]?.[0] ?? "";
      return `${a}${b}`.toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  }
  const emailTrimmed = email?.trim();
  if (emailTrimmed) return emailTrimmed.slice(0, 2).toUpperCase();
  return "?";
}
