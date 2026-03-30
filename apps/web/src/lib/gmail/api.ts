import type { FilterCondition } from "@g-spot/api/schemas/section-filters";
import type { GmailThread, GmailThreadPage, GmailFullMessage, GmailThreadDetail, GmailDraft } from "./types";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function buildGmailQuery(filters: FilterCondition[]): string {
  const parts: string[] = [];

  for (const filter of filters) {
    const { field, operator, value } = filter;
    const negate = operator === "is_not" || operator === "not_contains";
    const prefix = negate ? "-" : "";

    switch (field) {
      // Sender / Recipient
      case "from":
        parts.push(`${prefix}from:${value}`);
        break;
      case "to":
        parts.push(`${prefix}to:${value}`);
        break;
      case "cc":
        parts.push(`${prefix}cc:${value}`);
        break;
      case "bcc":
        parts.push(`${prefix}bcc:${value}`);
        break;
      case "deliveredto":
        parts.push(`${prefix}deliveredto:${value}`);
        break;
      case "list":
        parts.push(`${prefix}list:${value}`);
        break;

      // Content
      case "subject":
        parts.push(`${prefix}subject:${value}`);
        break;

      // Attachment
      case "has_attachment":
        if (value === "true") {
          parts.push(negate ? "-has:attachment" : "has:attachment");
        }
        break;
      case "has_drive":
        if (value === "true") {
          parts.push(negate ? "-has:drive" : "has:drive");
        }
        break;
      case "has_document":
        if (value === "true") {
          parts.push(negate ? "-has:document" : "has:document");
        }
        break;
      case "has_spreadsheet":
        if (value === "true") {
          parts.push(negate ? "-has:spreadsheet" : "has:spreadsheet");
        }
        break;
      case "has_presentation":
        if (value === "true") {
          parts.push(negate ? "-has:presentation" : "has:presentation");
        }
        break;
      case "has_youtube":
        if (value === "true") {
          parts.push(negate ? "-has:youtube" : "has:youtube");
        }
        break;
      case "filename":
        parts.push(`${prefix}filename:${value}`);
        break;

      // Location / Status
      case "in":
        parts.push(`${prefix}in:${value}`);
        break;
      case "is_unread":
        if (value === "true") {
          parts.push(negate ? "-is:unread" : "is:unread");
        }
        break;
      case "is_read":
        if (value === "true") {
          parts.push(negate ? "-is:read" : "is:read");
        }
        break;
      case "is_starred":
        if (value === "true") {
          parts.push(negate ? "-is:starred" : "is:starred");
        }
        break;
      case "is_important":
        if (value === "true") {
          parts.push(negate ? "-is:important" : "is:important");
        }
        break;
      case "is_snoozed":
        if (value === "true") {
          parts.push(negate ? "-is:snoozed" : "is:snoozed");
        }
        break;
      case "is_muted":
        if (value === "true") {
          parts.push(negate ? "-is:muted" : "is:muted");
        }
        break;
      case "label":
        parts.push(`${prefix}label:${value}`);
        break;
      case "category":
        parts.push(`${prefix}category:${value}`);
        break;

      // Date / Time
      case "after":
        parts.push(`after:${value}`);
        break;
      case "before":
        parts.push(`before:${value}`);
        break;
      case "older_than":
        parts.push(`older_than:${value}`);
        break;
      case "newer_than":
        parts.push(`newer_than:${value}`);
        break;

      // Size
      case "larger":
        parts.push(`larger:${value}`);
        break;
      case "smaller":
        parts.push(`smaller:${value}`);
        break;
      case "size":
        parts.push(`size:${value}`);
        break;
    }
  }

  return parts.join(" ");
}

function parseFromHeader(raw: string): { name: string; email: string } {
  // Handles "Name <email@example.com>" and plain "email@example.com"
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2] };
  }
  return { name: raw, email: raw };
}

/** Personal email providers — show initials instead of brand logo */
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "ymail.com",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "pm.me",
  "mail.com", "zoho.com", "gmx.com", "gmx.net",
  "yandex.com", "yandex.ru", "tutanota.com", "tuta.io",
]);

/** BIMI-like avatar: brand logo from favicon for business domains, null for personal email */
function getSenderAvatarUrl(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || PERSONAL_DOMAINS.has(domain)) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailMessageResponse = {
  id: string;
  threadId: string;
  snippet: string;
  labelIds?: string[];
  payload?: GmailPayloadPart;
};

type GmailPayloadPart = {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailPayloadPart[];
  filename?: string;
};

type GmailThreadResponse = {
  id: string;
  messages: GmailMessageResponse[];
};

async function fetchGmailJson<T>(
  url: string,
  token: string,
): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function getHeader(
  msg: GmailMessageResponse,
  name: string,
): string {
  return (
    msg.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

export async function searchGmailThreads(
  accessToken: string,
  filters: FilterCondition[],
  pageToken?: string | null,
): Promise<GmailThreadPage> {
  const query = buildGmailQuery(filters);

  const params = new URLSearchParams({ maxResults: "7" });
  if (query) params.set("q", query);
  if (pageToken) params.set("pageToken", pageToken);

  const listData = await fetchGmailJson<GmailListResponse>(
    `${GMAIL_API}/messages?${params.toString()}`,
    accessToken,
  );

  const messageRefs = listData.messages ?? [];
  if (messageRefs.length === 0) {
    return { threads: [], nextPageToken: null, resultSizeEstimate: 0 };
  }

  // Fetch metadata for all messages in parallel (capped at 25 by maxResults)
  const messages = await Promise.all(
    messageRefs.map((ref) =>
      fetchGmailJson<GmailMessageResponse>(
        `${GMAIL_API}/messages/${ref.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        accessToken,
      ),
    ),
  );

  const threads: GmailThread[] = messages.map((msg) => {
    const labels = msg.labelIds ?? [];
    const hasAttachment =
      labels.includes("ATTACHMENT") ||
      (msg.payload?.parts?.some((p) => p.filename && p.filename.length > 0) ??
        false);
    const from = parseFromHeader(getHeader(msg, "From"));

    return {
      id: msg.id,
      threadId: msg.threadId,
      subject: getHeader(msg, "Subject") || "(no subject)",
      from,
      snippet: msg.snippet ?? "",
      date: getHeader(msg, "Date"),
      isUnread: labels.includes("UNREAD"),
      labels,
      hasAttachment,
      avatarUrl: getSenderAvatarUrl(from.email),
    };
  });

  return {
    threads,
    nextPageToken: listData.nextPageToken ?? null,
    resultSizeEstimate: listData.resultSizeEstimate ?? 0,
  };
}

/** Decode base64url-encoded Gmail body data */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64);
}

/** Recursively extract body parts from a MIME payload */
function extractBody(part: GmailPayloadPart): { html: string | null; text: string | null } {
  if (part.mimeType === "text/html" && part.body?.data) {
    return { html: decodeBase64Url(part.body.data), text: null };
  }
  if (part.mimeType === "text/plain" && part.body?.data) {
    return { html: null, text: decodeBase64Url(part.body.data) };
  }
  if (part.parts) {
    let html: string | null = null;
    let text: string | null = null;
    for (const sub of part.parts) {
      const result = extractBody(sub);
      if (result.html) html = result.html;
      if (result.text) text = result.text;
    }
    return { html, text };
  }
  return { html: null, text: null };
}

function getHeaderFromPart(part: GmailPayloadPart, name: string): string {
  return (
    part.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

export async function archiveGmailThread(
  accessToken: string,
  threadId: string,
): Promise<void> {
  const res = await fetch(`${GMAIL_API}/threads/${threadId}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
}

export async function trashGmailThread(
  accessToken: string,
  threadId: string,
): Promise<void> {
  const res = await fetch(`${GMAIL_API}/threads/${threadId}/trash`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
}

export async function modifyGmailThreadLabels(
  accessToken: string,
  threadId: string,
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<void> {
  const res = await fetch(`${GMAIL_API}/threads/${threadId}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
}

export async function fetchGmailThreadDetail(
  accessToken: string,
  threadId: string,
): Promise<GmailThreadDetail> {
  const data = await fetchGmailJson<GmailThreadResponse>(
    `${GMAIL_API}/threads/${threadId}?format=full`,
    accessToken,
  );

  const messages: GmailFullMessage[] = data.messages.map((msg) => {
    const payload = msg.payload!;
    const from = parseFromHeader(getHeaderFromPart(payload, "From"));
    const { html, text } = extractBody(payload);

    return {
      id: msg.id,
      from,
      to: getHeaderFromPart(payload, "To"),
      cc: getHeaderFromPart(payload, "Cc"),
      date: getHeaderFromPart(payload, "Date"),
      subject: getHeaderFromPart(payload, "Subject") || "(no subject)",
      messageId: getHeaderFromPart(payload, "Message-ID"),
      inReplyTo: getHeaderFromPart(payload, "In-Reply-To"),
      references: getHeaderFromPart(payload, "References"),
      bodyHtml: html,
      bodyText: text,
    };
  });

  return {
    id: data.id,
    subject: messages[0]?.subject ?? "(no subject)",
    messages,
  };
}

// --- Draft & Send ---

export async function createGmailDraft(
  accessToken: string,
  raw: string,
  threadId?: string | null,
): Promise<GmailDraft> {
  const body: { message: { raw: string; threadId?: string } } = {
    message: { raw },
  };
  if (threadId) body.message.threadId = threadId;

  const res = await fetch(`${GMAIL_API}/drafts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  return res.json() as Promise<GmailDraft>;
}

export async function updateGmailDraft(
  accessToken: string,
  draftId: string,
  raw: string,
  threadId?: string | null,
): Promise<GmailDraft> {
  const body: { id: string; message: { raw: string; threadId?: string } } = {
    id: draftId,
    message: { raw },
  };
  if (threadId) body.message.threadId = threadId;

  const res = await fetch(`${GMAIL_API}/drafts/${draftId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  return res.json() as Promise<GmailDraft>;
}

export async function deleteGmailDraft(
  accessToken: string,
  draftId: string,
): Promise<void> {
  const res = await fetch(`${GMAIL_API}/drafts/${draftId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
}

export async function sendGmailDraft(
  accessToken: string,
  draftId: string,
): Promise<void> {
  const res = await fetch(`${GMAIL_API}/drafts/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: draftId }),
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
}

export async function sendGmailMessage(
  accessToken: string,
  raw: string,
): Promise<void> {
  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
}
