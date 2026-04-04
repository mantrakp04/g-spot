import { useQuery } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";
import type { FilterCondition } from "@g-spot/types/filters";

import { gmailKeys, googleKeys } from "@/lib/query-keys";
import { buildGmailSearchQuery } from "@/lib/gmail/api";
import { getOAuthToken } from "@/lib/oauth";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

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

export type FilterSuggestionOption = {
  value: string;
  label: string;
};

type GmailSuggestionField =
  | "from"
  | "to"
  | "cc"
  | "bcc"
  | "deliveredto"
  | "list"
  | "subject"
  | "filename";

type GmailSuggestionListResponse = {
  messages?: Array<{ id: string }>;
};

type GmailSuggestionMessageResponse = {
  labelIds?: string[];
  payload?: GmailSuggestionPayloadPart;
};

type GmailSuggestionPayloadPart = {
  headers?: Array<{ name: string; value: string }>;
  parts?: GmailSuggestionPayloadPart[];
  filename?: string;
};

export function useGmailLabels(account: OAuthConnection | null) {
  return useQuery({
    queryKey: gmailKeys.labels(account?.providerAccountId),
    queryFn: async () => {
      const token = await getOAuthToken(account!);
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
          value: label.name,
          label:
            label.type === "system"
              ? (SYSTEM_LABEL_DISPLAY[label.id] ?? label.name)
              : label.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
    enabled: !!account,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

function dedupeSuggestions(
  options: FilterSuggestionOption[],
): FilterSuggestionOption[] {
  const seen = new Set<string>();
  const deduped: FilterSuggestionOption[] = [];

  for (const option of options) {
    if (!option.value || seen.has(option.value)) continue;
    seen.add(option.value);
    deduped.push(option);
  }

  return deduped.sort((a, b) => a.label.localeCompare(b.label));
}

function getHeader(
  payload: GmailSuggestionPayloadPart | undefined,
  name: string,
): string {
  return (
    payload?.headers?.find(
      (header) => header.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

function splitAddressList(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let angleDepth = 0;

  for (const char of raw) {
    if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "<") {
      angleDepth += 1;
    } else if (char === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
    }

    if (char === "," && !inQuotes && angleDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseMailboxParticipant(raw: string): { label: string; value: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const namedMatch = trimmed.match(/^(.+?)\s*<(.+?)>$/);
  if (namedMatch) {
    const name = namedMatch[1].trim().replace(/^"|"$/g, "");
    const email = namedMatch[2].trim();
    return {
      value: email,
      label: name ? `${name} <${email}>` : email,
    };
  }

  const bareAngle = trimmed.match(/^<(.+?)>$/);
  if (bareAngle) {
    const email = bareAngle[1].trim();
    return { value: email, label: email };
  }

  return { value: trimmed, label: trimmed };
}

function parseListValue(raw: string): FilterSuggestionOption | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const angleMatch = trimmed.match(/<(.+?)>/);
  const value = angleMatch?.[1]?.trim() ?? trimmed;
  return { value, label: value };
}

function collectFilenames(
  part: GmailSuggestionPayloadPart | undefined,
  options: FilterSuggestionOption[],
) {
  if (!part) return;
  if (part.filename?.trim()) {
    options.push({ value: part.filename, label: part.filename });
  }
  part.parts?.forEach((child) => collectFilenames(child, options));
}

export async function fetchGmailFilterSuggestions(
  account: OAuthConnection,
  field: GmailSuggestionField,
  filters: FilterCondition[],
): Promise<FilterSuggestionOption[]> {
  const token = await getOAuthToken(account);
  const query = buildGmailSearchQuery(filters);
  const params = new URLSearchParams({ maxResults: "25" });
  if (query) params.set("q", query);

  const listRes = await fetch(`${GMAIL_API}/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    throw new Error(`Gmail API error: ${listRes.status} ${listRes.statusText}`);
  }

  const listData: GmailSuggestionListResponse = await listRes.json();
  const messageIds = listData.messages?.map((message) => message.id) ?? [];
  if (messageIds.length === 0) {
    return [];
  }

  const metadataHeaders = [
    "Subject",
    "From",
    "To",
    "Cc",
    "Bcc",
    "Delivered-To",
    "List-Id",
  ];

  const messages = await Promise.all(
    messageIds.map(async (id) => {
      const detailParams = new URLSearchParams({ format: "metadata" });
      metadataHeaders.forEach((header) =>
        detailParams.append("metadataHeaders", header),
      );

      const res = await fetch(
        `${GMAIL_API}/messages/${id}?${detailParams.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        throw new Error(`Gmail API error: ${res.status} ${res.statusText}`);
      }
      return res.json() as Promise<GmailSuggestionMessageResponse>;
    }),
  );

  const options: FilterSuggestionOption[] = [];

  for (const message of messages) {
    switch (field) {
      case "from": {
        const participant = parseMailboxParticipant(
          getHeader(message.payload, "From"),
        );
        if (participant) options.push(participant);
        break;
      }
      case "to":
      case "cc":
      case "bcc": {
        const headerName = field === "to" ? "To" : field === "cc" ? "Cc" : "Bcc";
        splitAddressList(getHeader(message.payload, headerName)).forEach((entry) => {
          const participant = parseMailboxParticipant(entry);
          if (participant) options.push(participant);
        });
        break;
      }
      case "deliveredto": {
        const participant = parseMailboxParticipant(
          getHeader(message.payload, "Delivered-To"),
        );
        if (participant) options.push(participant);
        break;
      }
      case "list": {
        const listOption = parseListValue(getHeader(message.payload, "List-Id"));
        if (listOption) options.push(listOption);
        break;
      }
      case "subject": {
        const subject = getHeader(message.payload, "Subject").trim();
        if (subject) options.push({ value: subject, label: subject });
        break;
      }
      case "filename":
        collectFilenames(message.payload, options);
        break;
    }
  }

  return dedupeSuggestions(options);
}

/** Fetch the authenticated Google user's profile (name + email) */
export function useGoogleProfile(account: OAuthConnection | null) {
  return useQuery({
    queryKey: googleKeys.profile(account?.providerAccountId),
    queryFn: async () => {
      const token = await getOAuthToken(account!);
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
    enabled: !!account,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}
