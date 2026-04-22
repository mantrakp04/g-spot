import type {
  ComposeFormState,
  GmailDraft,
} from "@g-spot/types/gmail";

import type { GmailApiMessage } from "./gmail-client";
import {
  extractBody,
  GMAIL_API,
  getHeader,
  stripHtml,
} from "./gmail-client";

type GmailDraftFullResponse = {
  id: string;
  message: GmailApiMessage;
};

async function fetchJsonWithInit<T>(
  url: string,
  token: string,
  init: RequestInit,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    throw new Error(`Provider API error: ${res.status} ${res.statusText}`);
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

  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    throw new Error(`Provider API error: ${res.status} ${res.statusText}`);
  }
}

export async function fetchGmailComposeDraft(
  token: string,
  draftId: string,
): Promise<{
  draftId: string;
  messageId: string;
  form: ComposeFormState;
  quotedContent: null;
}> {
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
        ? stripHtml(html).trim()
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

export async function modifyGmailThreadLabels(
  token: string,
  threadId: string,
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<void> {
  await fetchNoContent(
    `${GMAIL_API}/threads/${encodeURIComponent(threadId)}/modify`,
    token,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    },
  );
}

export async function trashGmailThread(
  token: string,
  threadId: string,
): Promise<void> {
  await fetchNoContent(
    `${GMAIL_API}/threads/${encodeURIComponent(threadId)}/trash`,
    token,
    { method: "POST" },
  );
}

export async function createGmailDraft(
  token: string,
  raw: string,
  threadId?: string | null,
): Promise<GmailDraft> {
  const body: { message: { raw: string; threadId?: string } } = {
    message: { raw },
  };
  if (threadId) body.message.threadId = threadId;

  return fetchJsonWithInit<GmailDraft>(`${GMAIL_API}/drafts`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function updateGmailDraft(
  token: string,
  draftId: string,
  raw: string,
  threadId?: string | null,
): Promise<GmailDraft> {
  const body: { id: string; message: { raw: string; threadId?: string } } = {
    id: draftId,
    message: { raw },
  };
  if (threadId) body.message.threadId = threadId;

  return fetchJsonWithInit<GmailDraft>(
    `${GMAIL_API}/drafts/${encodeURIComponent(draftId)}`,
    token,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

export async function deleteGmailDraft(
  token: string,
  draftId: string,
): Promise<void> {
  await fetchNoContent(
    `${GMAIL_API}/drafts/${encodeURIComponent(draftId)}`,
    token,
    { method: "DELETE" },
  );
}

export async function sendGmailDraft(
  token: string,
  draftId: string,
): Promise<{ id: string; threadId: string }> {
  return fetchJsonWithInit<{ id: string; threadId: string }>(`${GMAIL_API}/drafts/send`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: draftId }),
  });
}

export async function sendGmailMessage(
  token: string,
  raw: string,
): Promise<{ id: string; threadId: string }> {
  return fetchJsonWithInit<{ id: string; threadId: string }>(`${GMAIL_API}/messages/send`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
}
