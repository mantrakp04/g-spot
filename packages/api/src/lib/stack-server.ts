import { env } from "@g-spot/env/server";

const STACK_API = "https://api.stack-auth.com/api/v1";

function serverHeaders() {
  return {
    "x-stack-access-type": "server",
    "x-stack-project-id": env.STACK_PROJECT_ID,
    "x-stack-secret-server-key": env.STACK_SECRET_SERVER_KEY,
    "content-type": "application/json",
  } as const;
}

export async function getServerMetadata(
  userId: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${STACK_API}/users/${userId}`, {
    headers: serverHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Stack Auth: failed to get user ${userId}: ${res.status}`);
  }
  const user = (await res.json()) as { server_metadata?: Record<string, unknown> };
  return user.server_metadata ?? {};
}

export async function patchServerMetadata(
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const current = await getServerMetadata(userId);
  const merged = { ...current, ...patch };

  const res = await fetch(`${STACK_API}/users/${userId}`, {
    method: "PATCH",
    headers: serverHeaders(),
    body: JSON.stringify({ server_metadata: merged }),
  });
  if (!res.ok) {
    throw new Error(
      `Stack Auth: failed to patch user ${userId}: ${res.status}`,
    );
  }
}
