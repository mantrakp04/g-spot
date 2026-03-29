import { useQuery } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_PEOPLE_API = "https://people.googleapis.com/v1/people/me";

async function getToken(account: OAuthConnection): Promise<string> {
  const result = await account.getAccessToken();
  if (result.status !== "ok") throw new Error("Failed to get Gmail access token");
  return result.data.accessToken;
}

const INCLUDED_SYSTEM_LABELS = [
  "INBOX",
  "SENT",
  "TRASH",
  "SPAM",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
] as const;

const SYSTEM_LABEL_DISPLAY: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  TRASH: "Trash",
  SPAM: "Spam",
  UNREAD: "Unread",
  STARRED: "Starred",
  IMPORTANT: "Important",
};

type GmailLabel = {
  id: string;
  name: string;
  type: "system" | "user";
};

type GmailLabelsResponse = {
  labels: GmailLabel[];
};

export function useGmailLabels(account: OAuthConnection | null) {
  return useQuery({
    queryKey: ["gmail", "labels"] as const,
    queryFn: async () => {
      const token = await getToken(account!);
      const res = await fetch(`${GMAIL_API}/labels`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Gmail API error: ${res.status} ${res.statusText}`);
      }
      const data: GmailLabelsResponse = await res.json();

      const includedSystemSet = new Set<string>(INCLUDED_SYSTEM_LABELS);

      return data.labels
        .filter(
          (label) =>
            label.type === "user" ||
            includedSystemSet.has(label.id),
        )
        .map((label) => ({
          value: label.id,
          label:
            label.type === "system"
              ? (SYSTEM_LABEL_DISPLAY[label.id] ?? label.name)
              : label.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!account,
  });
}

/** Fetch the authenticated Google user's profile (name + email) */
export function useGoogleProfile(account: OAuthConnection | null) {
  return useQuery({
    queryKey: ["google", "profile", account?.providerAccountId] as const,
    queryFn: async () => {
      const token = await getToken(account!);
      const res = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error("Failed to fetch Google profile");
      const data = await res.json() as {
        name?: string;
        email?: string;
        picture?: string;
      };
      return {
        name: data.name ?? data.email ?? "Google Account",
        email: data.email ?? "",
        picture: data.picture ?? "",
      };
    },
    staleTime: 30 * 60 * 1000,
    enabled: !!account,
  });
}
