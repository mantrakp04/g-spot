export type KnownContact = {
  name: string;
  email: string;
};

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

type MessageListResponse = {
  messages?: Array<{ id: string }>;
};

type MessageMetadataResponse = {
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
};

function getHeaderValue(msg: MessageMetadataResponse, name: string): string {
  return (
    msg.payload?.headers?.find(
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
    if (char === "\"") inQuotes = !inQuotes;
    else if (char === "<") angleDepth++;
    else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);

    if (char === "," && !inQuotes && angleDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseContact(raw: string): KnownContact | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const namedMatch = trimmed.match(/^(.+?)\s*<(.+?)>$/);
  if (namedMatch) {
    return {
      name: namedMatch[1].trim().replace(/^"|"$/g, ""),
      email: namedMatch[2].trim().toLowerCase(),
    };
  }

  const bareAngle = trimmed.match(/^<(.+?)>$/);
  if (bareAngle) {
    return { name: "", email: bareAngle[1].trim().toLowerCase() };
  }

  if (trimmed.includes("@")) {
    return { name: "", email: trimmed.toLowerCase() };
  }

  return null;
}

async function fetchMessageIds(
  token: string,
  query: string,
  maxResults: number,
): Promise<string[]> {
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    q: query,
  });
  const response = await fetch(`${GMAIL_API}/messages?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  const data: MessageListResponse = await response.json();
  return data.messages?.map((message) => message.id) ?? [];
}

async function fetchMessageMetadata(
  token: string,
  messageId: string,
  headers: string[],
): Promise<MessageMetadataResponse> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const header of headers) params.append("metadataHeaders", header);
  const response = await fetch(`${GMAIL_API}/messages/${messageId}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return {};
  return response.json();
}

export async function fetchKnownContacts(
  accessToken: string,
): Promise<KnownContact[]> {
  const [sentIds, receivedIds] = await Promise.all([
    fetchMessageIds(accessToken, "in:sent", 30),
    fetchMessageIds(accessToken, "in:inbox", 20),
  ]);

  const [sentMessages, receivedMessages] = await Promise.all([
    Promise.all(
      sentIds.map((id) =>
        fetchMessageMetadata(accessToken, id, ["To", "Cc", "Bcc"]),
      ),
    ),
    Promise.all(
      receivedIds.map((id) =>
        fetchMessageMetadata(accessToken, id, ["From"]),
      ),
    ),
  ]);

  const contactMap = new Map<string, { name: string; count: number }>();

  function addContact(contact: KnownContact) {
    const existing = contactMap.get(contact.email);
    if (existing) {
      existing.count++;
      if (!existing.name && contact.name) existing.name = contact.name;
    } else {
      contactMap.set(contact.email, { name: contact.name, count: 1 });
    }
  }

  for (const message of sentMessages) {
    for (const header of ["To", "Cc", "Bcc"]) {
      const raw = getHeaderValue(message, header);
      if (!raw) continue;
      for (const address of splitAddressList(raw)) {
        const contact = parseContact(address);
        if (contact) addContact(contact);
      }
    }
  }

  for (const message of receivedMessages) {
    const raw = getHeaderValue(message, "From");
    if (!raw) continue;
    const contact = parseContact(raw);
    if (contact) addContact(contact);
  }

  return Array.from(contactMap.entries())
    .map(([email, { name, count }]) => ({ name, email, count }))
    .sort((a, b) => b.count - a.count)
    .map(({ name, email }) => ({ name, email }));
}
