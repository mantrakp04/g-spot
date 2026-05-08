import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../index";
import { gmailAttachments } from "../schema";

/**
 * Replace the attachment metadata for a message. Attachments are derived from
 * the message payload, so a delete-then-insert is the simplest correct sync.
 */
export async function upsertAttachments(
  messageId: string,
  attachments: Array<{
    gmailAttachmentId: string | null;
    filename: string;
    mimeType: string;
    size: number;
  }>,
): Promise<void> {
  await db
    .delete(gmailAttachments)
    .where(eq(gmailAttachments.messageId, messageId));

  if (attachments.length === 0) return;
  await db.insert(gmailAttachments).values(
    attachments.map((att) => ({
      id: nanoid(),
      messageId,
      gmailAttachmentId: att.gmailAttachmentId,
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
    })),
  );
}
