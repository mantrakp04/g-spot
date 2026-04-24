import { ListOrderedIcon, SparklesIcon, XIcon } from "lucide-react";
import { cn } from "@g-spot/ui/lib/utils";

import {
  Queue,
  QueueItem,
  QueueItemAction,
  QueueItemActions,
  QueueItemAttachment,
  QueueItemContent,
  QueueItemFile,
  QueueItemImage,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";
import {
  type QueueItem as QueueItemModel,
  removeChatQueueItem,
  useChatQueue,
} from "@/lib/chat-queue";

type ChatQueuedMessagesProps = {
  chatId: string | null;
  className?: string;
};

function queueItemText(item: QueueItemModel): string {
  const text = item.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join(" ");
  return text || "(attachment only)";
}

function QueueItemRow({
  chatId,
  item,
}: {
  chatId: string;
  item: QueueItemModel;
}) {
  const text = queueItemText(item);
  const attachments = item.parts.filter(
    (part): part is Extract<typeof part, { type: "file" }> => part.type === "file",
  );

  return (
    <QueueItem>
      <div className="flex items-start gap-2">
        <QueueItemIndicator />
        <QueueItemContent>{text}</QueueItemContent>
        <QueueItemActions>
          <QueueItemAction
            aria-label="Remove from queue"
            onClick={() => removeChatQueueItem(chatId, item.id)}
          >
            <XIcon className="size-3" />
          </QueueItemAction>
        </QueueItemActions>
      </div>
      {attachments.length > 0 && (
        <QueueItemAttachment>
          {attachments.map((attachment, i) =>
            attachment.mediaType?.startsWith("image/") ? (
              <QueueItemImage
                key={`${item.id}-att-${i}`}
                src={attachment.url}
                alt={attachment.filename ?? "image"}
              />
            ) : (
              <QueueItemFile key={`${item.id}-att-${i}`}>
                {attachment.filename ?? "file"}
              </QueueItemFile>
            ),
          )}
        </QueueItemAttachment>
      )}
    </QueueItem>
  );
}

export function ChatQueuedMessages({ chatId, className }: ChatQueuedMessagesProps) {
  const queue = useChatQueue(chatId);
  if (!chatId) return null;
  if (queue.steer.length === 0 && queue.followup.length === 0) return null;

  return (
    <div className={cn("mx-auto w-full max-w-2xl", className)}>
      <Queue>
        {queue.steer.length > 0 && (
          <QueueSection>
            <QueueSectionTrigger>
              <QueueSectionLabel
                count={queue.steer.length}
                label={queue.steer.length === 1 ? "steering message" : "steering messages"}
                icon={<SparklesIcon className="size-3.5" />}
              />
            </QueueSectionTrigger>
            <QueueSectionContent>
              <QueueList>
                {queue.steer.map((item) => (
                  <QueueItemRow key={item.id} chatId={chatId} item={item} />
                ))}
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        )}
        {queue.followup.length > 0 && (
          <QueueSection>
            <QueueSectionTrigger>
              <QueueSectionLabel
                count={queue.followup.length}
                label={queue.followup.length === 1 ? "queued message" : "queued messages"}
                icon={<ListOrderedIcon className="size-3.5" />}
              />
            </QueueSectionTrigger>
            <QueueSectionContent>
              <QueueList>
                {queue.followup.map((item) => (
                  <QueueItemRow key={item.id} chatId={chatId} item={item} />
                ))}
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        )}
      </Queue>
    </div>
  );
}
