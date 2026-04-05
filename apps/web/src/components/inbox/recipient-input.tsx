import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type KeyboardEvent,
} from "react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { cn } from "@g-spot/ui/lib/utils";
import { X as XIcon } from "lucide-react";
import type { OAuthConnection } from "@stackframe/react";

import { useKnownContacts } from "@/hooks/use-known-contacts";
import {
  filterContacts,
  type KnownContact,
} from "@/lib/gmail/contacts";
import {
  getGmailSenderAvatarUrl,
  getGmailSenderInitials,
} from "@/lib/gmail/avatar";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Recipient = { name: string; email: string };

type RecipientInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  googleAccount: OAuthConnection | null;
};

/* ------------------------------------------------------------------ */
/*  Parsing / serialization helpers                                    */
/* ------------------------------------------------------------------ */

/** Parse a comma-separated recipient string into structured entries. */
function parseRecipients(raw: string): Recipient[] {
  if (!raw.trim()) return [];
  const results: Recipient[] = [];

  // Split respecting quoted names and angle brackets
  let current = "";
  let inQuotes = false;
  let angleDepth = 0;

  for (const char of raw) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "<") angleDepth++;
    else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);

    if (char === "," && !inQuotes && angleDepth === 0) {
      const parsed = parseSingleRecipient(current);
      if (parsed) results.push(parsed);
      current = "";
      continue;
    }
    current += char;
  }

  const last = parseSingleRecipient(current);
  if (last) results.push(last);
  return results;
}

function parseSingleRecipient(raw: string): Recipient | null {
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

function serializeRecipients(recipients: Recipient[]): string {
  return recipients
    .map((r) => (r.name ? `${r.name} <${r.email}>` : r.email))
    .join(", ");
}

/** Get display label for a recipient badge. */
function getDisplayLabel(r: Recipient): string {
  if (r.name) return r.name;
  // Use the local part of the email
  return r.email.split("@")[0] ?? r.email;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function RecipientInput({
  value,
  onChange,
  placeholder,
  googleAccount,
}: RecipientInputProps) {
  const { data: contacts = [] } = useKnownContacts(googleAccount);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Parse the parent value into structured recipients
  const recipients = useMemo(() => parseRecipients(value), [value]);

  // Build set of existing emails for dedup
  const existingEmails = useMemo(
    () => new Set(recipients.map((r) => r.email)),
    [recipients],
  );

  // Filter suggestions
  const suggestions = useMemo(
    () =>
      filterContacts(contacts, inputValue).filter(
        (c) => !existingEmails.has(c.email),
      ),
    [contacts, inputValue, existingEmails],
  );

  const showDropdown = isOpen && suggestions.length > 0 && inputValue.length > 0;

  /* ----- actions ---- */

  const addRecipient = useCallback(
    (r: Recipient) => {
      if (existingEmails.has(r.email)) return;
      const next = [...recipients, r];
      onChange(serializeRecipients(next));
      setInputValue("");
      setIsOpen(false);
      setHighlightIndex(0);
      inputRef.current?.focus();
    },
    [recipients, existingEmails, onChange],
  );

  const removeRecipient = useCallback(
    (email: string) => {
      const next = recipients.filter((r) => r.email !== email);
      onChange(serializeRecipients(next));
      inputRef.current?.focus();
    },
    [recipients, onChange],
  );

  const selectContact = useCallback(
    (contact: KnownContact) => {
      addRecipient({ name: contact.name, email: contact.email });
    },
    [addRecipient],
  );

  /** Try to commit the current input text as a recipient. */
  const commitInput = useCallback(() => {
    const trimmed = inputValue.trim().replace(/,$/, "").trim();
    if (!trimmed) return false;
    const parsed = parseSingleRecipient(trimmed);
    if (parsed && !existingEmails.has(parsed.email)) {
      addRecipient(parsed);
      return true;
    }
    return false;
  }, [inputValue, existingEmails, addRecipient]);

  /* ----- keyboard ---- */

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      // Backspace on empty input removes last badge
      if (
        e.key === "Backspace" &&
        inputValue === "" &&
        recipients.length > 0
      ) {
        const last = recipients[recipients.length - 1];
        removeRecipient(last.email);
        return;
      }

      if (showDropdown) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
            return;
          case "ArrowUp":
            e.preventDefault();
            setHighlightIndex((i) => Math.max(i - 1, 0));
            return;
          case "Enter":
          case "Tab":
            e.preventDefault();
            selectContact(suggestions[highlightIndex]);
            return;
          case "Escape":
            setIsOpen(false);
            return;
        }
      }

      // Comma, Enter, Tab without dropdown → commit typed text
      if (e.key === "," || e.key === "Enter" || e.key === "Tab") {
        if (inputValue.trim()) {
          e.preventDefault();
          commitInput();
        }
      }
    },
    [
      inputValue,
      recipients,
      showDropdown,
      suggestions,
      highlightIndex,
      selectContact,
      removeRecipient,
      commitInput,
    ],
  );

  // Close on click outside
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        commitInput();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [commitInput]);

  // Reset highlight when input changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [inputValue]);

  // Sync: if the parent value changes externally (e.g. reply prefill), reset input
  // We only need inputValue for the "typing" portion—parsed recipients handle the rest.

  return (
    <div
      ref={wrapperRef}
      className="relative flex min-h-7 flex-1 flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-0.5 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Recipient badges */}
      {recipients.map((r) => (
        <RecipientBadge
          key={r.email}
          recipient={r}
          onRemove={() => removeRecipient(r.email)}
        />
      ))}

      {/* Text input */}
      <input
        ref={inputRef}
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Small delay to allow click events on dropdown
          setTimeout(() => commitInput(), 150);
        }}
        placeholder={recipients.length === 0 ? placeholder : undefined}
        className="min-w-[80px] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        autoComplete="off"
      />

      {/* Suggestions dropdown */}
      {showDropdown && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover py-1 shadow-md">
          {suggestions.map((contact, index) => {
            const avatarUrl = getGmailSenderAvatarUrl(contact.email);
            return (
              <button
                key={contact.email}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-xs transition-colors",
                  index === highlightIndex
                    ? "bg-muted text-foreground"
                    : "text-popover-foreground hover:bg-muted/50",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectContact(contact);
                }}
                onMouseEnter={() => setHighlightIndex(index)}
              >
                <Avatar size="sm">
                  <AvatarImage
                    src={avatarUrl ?? undefined}
                    alt={contact.name || contact.email}
                  />
                  <AvatarFallback className="text-[9px]">
                    {getGmailSenderInitials(contact.name, contact.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  {contact.name && (
                    <div className="truncate font-medium leading-tight">
                      {contact.name}
                    </div>
                  )}
                  <div className="truncate text-muted-foreground leading-tight">
                    {contact.email}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  RecipientBadge                                                     */
/* ------------------------------------------------------------------ */

function RecipientBadge({
  recipient,
  onRemove,
}: {
  recipient: Recipient;
  onRemove: () => void;
}) {
  const avatarUrl = getGmailSenderAvatarUrl(recipient.email);
  const label = getDisplayLabel(recipient);

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          "group/badge inline-flex h-6 max-w-[180px] items-center gap-1 rounded-md bg-muted px-1 text-xs transition-colors hover:bg-muted/80",
        )}
      >
        <Avatar size="sm" className="!size-4">
          <AvatarImage
            src={avatarUrl ?? undefined}
            alt={label}
          />
          <AvatarFallback className="text-[8px]">
            {getGmailSenderInitials(recipient.name, recipient.email)}
          </AvatarFallback>
        </Avatar>
        <span className="truncate">{label}</span>
        <button
          type="button"
          className="ml-0.5 shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-foreground/10 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <XIcon className="size-2.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="flex items-center gap-2">
          <Avatar size="sm">
            <AvatarImage
              src={avatarUrl ?? undefined}
              alt={label}
            />
            <AvatarFallback className="text-[9px]">
              {getGmailSenderInitials(recipient.name, recipient.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            {recipient.name && (
              <div className="truncate font-medium">{recipient.name}</div>
            )}
            <div className="truncate text-background/70">{recipient.email}</div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
