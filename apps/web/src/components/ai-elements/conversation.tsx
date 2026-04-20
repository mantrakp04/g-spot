"use client";

import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useMemo,
} from "react";

import { useAutoScroll } from "@/hooks/use-auto-scroll";
import type { UIMessage } from "@/lib/chat-ui";

type ConversationCtx = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  scrollToBottom: () => void;
  isAtBottom: boolean;
};

const ConversationContext = createContext<ConversationCtx | null>(null);

function useConversationContext() {
  const ctx = useContext(ConversationContext);
  if (!ctx) {
    throw new Error(
      "Conversation sub-components must be rendered inside <Conversation>",
    );
  }
  return ctx;
}

export type ConversationProps = ComponentProps<"div">;

export const Conversation = ({
  className,
  children,
  ...props
}: ConversationProps) => {
  const { scrollRef, contentRef, scrollToBottom, isAtBottom } = useAutoScroll();
  const ctx = useMemo(
    () => ({ scrollRef, contentRef, scrollToBottom, isAtBottom }),
    [scrollRef, contentRef, scrollToBottom, isAtBottom],
  );

  // The scroll button has `absolute bottom-4` to sit pinned over the chat.
  // If rendered inside the scroll container its `bottom` resolves against
  // the scroll content (sticking it to ~the top of the first assistant
  // message). Partition children so the button renders as a sibling of the
  // scroll container and gets positioned against the viewport-sized wrapper.
  const childArray = Children.toArray(children);
  const buttons = childArray.filter(
    (child) => isValidElement(child) && child.type === ConversationScrollButton,
  );
  const rest = childArray.filter(
    (child) => !(isValidElement(child) && child.type === ConversationScrollButton),
  );

  return (
    <ConversationContext.Provider value={ctx}>
      <div className={cn("relative", className)} {...props}>
        <div
          ref={scrollRef}
          role="log"
          className="absolute inset-0 overflow-y-auto scroll-smooth"
        >
          {rest}
        </div>
        {buttons}
      </div>
    </ConversationContext.Provider>
  );
};

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => {
  const { contentRef } = useConversationContext();
  return (
    <div
      ref={contentRef}
      className={cn("flex flex-col gap-8 p-4", className)}
      {...props}
    />
  );
};

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useConversationContext();

  if (isAtBottom) return null;

  return (
    <Button
      className={cn(
        "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted",
        className,
      )}
      onClick={scrollToBottom}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  );
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number
  ) => string = defaultFormatMessage
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
