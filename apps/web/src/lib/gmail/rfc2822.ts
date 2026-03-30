type Rfc2822Params = {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
};

export function buildRfc2822Message(params: Rfc2822Params): string {
  const lines: string[] = [];

  lines.push(`From: ${params.from}`);
  lines.push(`To: ${params.to}`);
  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  lines.push(`Subject: ${params.subject}`);
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) lines.push(`References: ${params.references}`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/html; charset=utf-8");
  lines.push("");
  lines.push(`<html><body>${params.body}</body></html>`);

  return lines.join("\r\n");
}

export function encodeRfc2822ToBase64Url(raw: string): string {
  // UTF-8 safe base64 encoding
  const bytes = new TextEncoder().encode(raw);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  // Convert to base64url
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
