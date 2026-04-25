import type { OAuthConnection } from "@stackframe/react";
import type { ComposeFormState, GmailDraft } from "@g-spot/types/gmail";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SCOPES = ["https://mail.google.com/"];

type GmailPayloadPart = {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPayloadPart[];
};

type GmailApiMessage = {
  id: string;
  threadId: string;
  payload?: GmailPayloadPart;
};

type GmailDraftFullResponse = {
  id: string;
  message: GmailApiMessage;
};

export async function getGoogleAccessToken(
  account: OAuthConnection,
): Promise<string> {
  const result = await account.getAccessToken({ scopes: GMAIL_SCOPES });
  if (result.status !== "ok") {
    throw new Error(result.error.message || "Google access token is unavailable");
  }
  return result.data.accessToken;
}

async function fetchJsonWithInit<T>(
  url: string,
  token: string,
  init: RequestInit,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    throw new Error(`Gmail API error: ${res.status} ${res.statusText}`);
  }
  return await res.json() as T;
}

async function fetchNoContent(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<void> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    throw new Error(`Gmail API error: ${res.status} ${res.statusText}`);
  }
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return decodeURIComponent(
    Array.from(atob(padded), (char) =>
      `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
    ).join(""),
  );
}

function extractBody(
  part: GmailPayloadPart,
): { html: string | null; text: string | null } {
  if (part.mimeType === "text/html" && part.body?.data) {
    return { html: decodeBase64Url(part.body.data), text: null };
  }
  if (part.mimeType === "text/plain" && part.body?.data) {
    return { html: null, text: decodeBase64Url(part.body.data) };
  }
  if (!part.parts) return { html: null, text: null };

  let html: string | null = null;
  let text: string | null = null;
  for (const sub of part.parts) {
    const result = extractBody(sub);
    if (result.html) html = result.html;
    if (result.text) text = result.text;
  }
  return { html, text };
}

function stripHtml(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n");
  return (el.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function getHeader(
  msg: { payload?: { headers?: Array<{ name: string; value: string }> } },
  name: string,
): string {
  return (
    msg.payload?.headers?.find(
      (header) => header.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

export async function fetchGmailComposeDraft(
  account: OAuthConnection,
  draftId: string,
): Promise<{
  draftId: string;
  messageId: string;
  form: ComposeFormState;
  quotedContent: null;
}> {
  const token = await getGoogleAccessToken(account);
  const data = await fetchJsonWithInit<GmailDraftFullResponse>(
    `${GMAIL_API}/drafts/${encodeURIComponent(draftId)}?format=full`,
    token,
    { method: "GET" },
  );
  const payload = data.message.payload;
  if (!payload) {
    throw new Error("Draft message has no payload");
  }

  const { html, text } = extractBody(payload);
  const bodyPlain =
    text?.trim() !== undefined && text.trim() !== ""
      ? text.trim()
      : html
        ? stripHtml(html)
        : "";

  return {
    draftId: data.id,
    messageId: data.message.id,
    form: {
      to: getHeader(data.message, "To"),
      cc: getHeader(data.message, "Cc"),
      bcc: getHeader(data.message, "Bcc"),
      subject: getHeader(data.message, "Subject"),
      body: bodyPlain,
      inReplyTo: getHeader(data.message, "In-Reply-To"),
      references: getHeader(data.message, "References"),
      threadId: data.message.threadId,
    },
    quotedContent: null,
  };
}

export async function modifyGmailThreadLabels(input: {
  account: OAuthConnection;
  threadId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}): Promise<void> {
  const token = await getGoogleAccessToken(input.account);
  await fetchNoContent(`${GMAIL_API}/threads/${encodeURIComponent(input.threadId)}/modify`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      addLabelIds: input.addLabelIds,
      removeLabelIds: input.removeLabelIds,
    }),
  });
}

export async function trashGmailThread(
  account: OAuthConnection,
  threadId: string,
): Promise<void> {
  const token = await getGoogleAccessToken(account);
  await fetchNoContent(`${GMAIL_API}/threads/${encodeURIComponent(threadId)}/trash`, token, {
    method: "POST",
  });
}

export async function saveGmailDraft(input: {
  account: OAuthConnection;
  draftId: string | null;
  raw: string;
  threadId?: string | null;
}): Promise<GmailDraft> {
  const token = await getGoogleAccessToken(input.account);
  const message: { raw: string; threadId?: string } = { raw: input.raw };
  if (input.threadId) message.threadId = input.threadId;

  if (!input.draftId) {
    return fetchJsonWithInit<GmailDraft>(`${GMAIL_API}/drafts`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  }

  return fetchJsonWithInit<GmailDraft>(
    `${GMAIL_API}/drafts/${encodeURIComponent(input.draftId)}`,
    token,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: input.draftId, message }),
    },
  );
}

export async function deleteGmailDraft(
  account: OAuthConnection,
  draftId: string,
): Promise<void> {
  const token = await getGoogleAccessToken(account);
  await fetchNoContent(`${GMAIL_API}/drafts/${encodeURIComponent(draftId)}`, token, {
    method: "DELETE",
  });
}

export async function sendGmailMessage(input: {
  account: OAuthConnection;
  draftId: string | null;
  raw: string;
  threadId?: string | null;
}): Promise<{ id: string; threadId: string }> {
  const token = await getGoogleAccessToken(input.account);
  if (!input.draftId) {
    return fetchJsonWithInit<{ id: string; threadId: string }>(
      `${GMAIL_API}/messages/send`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: input.raw }),
      },
    );
  }

  await saveGmailDraft(input);
  return fetchJsonWithInit<{ id: string; threadId: string }>(
    `${GMAIL_API}/drafts/send`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: input.draftId }),
    },
  );
}
