export type MessageAttachment = {
  name: string;
  type: string;
  data: string; // base64 encoded
};

type Rfc2822Params = {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MessageAttachment[];
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

  if (params.attachments && params.attachments.length > 0) {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/html; charset=utf-8");
    lines.push("");
    lines.push(`<html><body>${params.body}</body></html>`);

    for (const attachment of params.attachments) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${attachment.type}; name="${attachment.name}"`);
      lines.push(`Content-Disposition: attachment; filename="${attachment.name}"`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      for (let i = 0; i < attachment.data.length; i += 76) {
        lines.push(attachment.data.slice(i, i + 76));
      }
    }

    lines.push(`--${boundary}--`);
  } else {
    lines.push("Content-Type: text/html; charset=utf-8");
    lines.push("");
    lines.push(`<html><body>${params.body}</body></html>`);
  }

  return lines.join("\r\n");
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]!);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
