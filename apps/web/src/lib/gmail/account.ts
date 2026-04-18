import type { FilterCondition } from "@g-spot/types/filters";

import type { GmailLabelCatalogEntry, FilterSuggestionOption } from "@/hooks/use-gmail-options";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_USERINFO_API = "https://www.googleapis.com/oauth2/v2/userinfo";

type GmailLabelResponse = {
  labels?: Array<{
    id: string;
    name: string;
    type: "system" | "user";
    color?: {
      textColor?: string;
      backgroundColor?: string;
    };
  }>;
};

export type GoogleProfile = {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
};

const GMAIL_CATEGORY_SUGGESTIONS: FilterSuggestionOption[] = [
  { value: "primary", label: "Primary" },
  { value: "social", label: "Social" },
  { value: "promotions", label: "Promotions" },
  { value: "updates", label: "Updates" },
  { value: "forums", label: "Forums" },
];

const GMAIL_LOCATION_SUGGESTIONS: FilterSuggestionOption[] = [
  { value: "inbox", label: "Inbox" },
  { value: "sent", label: "Sent" },
  { value: "drafts", label: "Drafts" },
  { value: "spam", label: "Spam" },
  { value: "trash", label: "Trash" },
  { value: "starred", label: "Starred" },
  { value: "important", label: "Important" },
];

async function fetchJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
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

function parseAddressList(raw: string): FilterSuggestionOption[] {
  if (!raw.trim()) return [];

  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let angleDepth = 0;

  for (const char of raw) {
    if (char === "\"") inQuotes = !inQuotes;
    if (char === "<") angleDepth += 1;
    if (char === ">") angleDepth = Math.max(0, angleDepth - 1);

    if (char === "," && !inQuotes && angleDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());

  return parts.flatMap((part) => {
    const named = part.match(/^(.+?)\s*<(.+?)>$/);
    if (named) {
      const name = named[1]!.trim().replace(/^"|"$/g, "");
      const email = named[2]!.trim().toLowerCase();
      return [{ value: email, label: name ? `${name} <${email}>` : email }];
    }

    const email = part.replace(/^<|>$/g, "").trim().toLowerCase();
    return email ? [{ value: email, label: email }] : [];
  });
}

export async function fetchGoogleProfile(
  accessToken: string,
): Promise<GoogleProfile> {
  return fetchJson<GoogleProfile>(GOOGLE_USERINFO_API, accessToken);
}

export async function fetchGmailLabels(
  accessToken: string,
): Promise<GmailLabelCatalogEntry[]> {
  const response = await fetchJson<GmailLabelResponse>(
    `${GMAIL_API}/labels`,
    accessToken,
  );

  return (response.labels ?? []).map((label) => ({
    id: label.id,
    name: label.name,
    type: label.type,
    label: label.name,
    color: label.color,
  }));
}

export async function fetchGmailFilterSuggestions(
  accessToken: string,
  field:
    | "from"
    | "to"
    | "cc"
    | "bcc"
    | "deliveredto"
    | "list"
    | "subject"
    | "filename"
    | "label"
    | "category"
    | "in",
  _filters: FilterCondition[],
): Promise<FilterSuggestionOption[]> {
  if (field === "category") {
    return GMAIL_CATEGORY_SUGGESTIONS;
  }

  if (field === "in") {
    return GMAIL_LOCATION_SUGGESTIONS;
  }

  if (field === "label") {
    const labels = await fetchGmailLabels(accessToken);
    return labels.map((label) => ({ value: label.name, label: label.label }));
  }

  if (
    field !== "from"
    && field !== "to"
    && field !== "cc"
    && field !== "bcc"
    && field !== "deliveredto"
    && field !== "list"
  ) {
    return [];
  }

  const params = new URLSearchParams({
    maxResults: "20",
    format: "metadata",
  });
  params.append("metadataHeaders", field === "from" ? "From" : field);

  const response = await fetchJson<{
    messages?: Array<{
      payload?: {
        headers?: Array<{ name: string; value: string }>;
      };
    }>;
  }>(`${GMAIL_API}/messages?${params.toString()}`, accessToken);

  const options = (response.messages ?? []).flatMap((message) => {
    const headerValue = message.payload?.headers?.find(
      (header) => header.name.toLowerCase() === (field === "from" ? "from" : field),
    )?.value;

    return headerValue ? parseAddressList(headerValue) : [];
  });

  return dedupeSuggestions(options);
}
