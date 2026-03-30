import { env } from "@g-spot/env/server";
import * as jose from "jose";

// Ref: https://stack-auth.com/docs/concepts/backend-integration
// Cached JWKS — jose handles refresh internally.
const jwks = jose.createRemoteJWKSet(
  new URL(
    `https://api.stack-auth.com/api/v1/projects/${env.STACK_PROJECT_ID}/.well-known/jwks.json`,
  ),
);

/**
 * Verify a Stack Auth access token (JWT).
 * Returns the userId (`sub` claim) on success, or `null` on failure.
 */
export async function verifyStackToken(
  accessToken: string,
): Promise<string | null> {
  try {
    const { payload } = await jose.jwtVerify(accessToken, jwks);
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}
