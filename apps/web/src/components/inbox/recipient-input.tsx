import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
} from "react";

import { Input } from "@g-spot/ui/components/input";
import { cn } from "@g-spot/ui/lib/utils";
import type { OAuthConnection } from "@stackframe/react";

import { useKnownContacts } from "@/hooks/use-known-contacts";
import { filterContacts, type KnownContact } from "@/lib/gmail/contacts";

type RecipientInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  googleAccount: OAuthConnection | null;
};

function getInitial(contact: KnownContact): string {
  const source = contact.name || contact.email;
  return source[0]?.toUpperCase() ?? "?";
}

export function RecipientInput({
  value,
  onChange,
  placeholder,
  googleAccount,
}: RecipientInputProps) {
  const { data: contacts = [] } = useKnownContacts(googleAccount);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Extract the current segment being typed (after last comma)
  const getSegment = useCallback((): { prefix: string; token: string } => {
    const lastComma = value.lastIndexOf(",");
    if (lastComma === -1) return { prefix: "", token: value.trim() };
    return {
      prefix: value.slice(0, lastComma + 1) + " ",
      token: value.slice(lastComma + 1).trim(),
    };
  }, [value]);

  const { token } = getSegment();

  // Filter out contacts that are already in the value
  const existingEmails = new Set(
    value
      .split(",")
      .map((s) => {
        const match = s.match(/<(.+?)>/);
        return (match?.[1] ?? s).trim().toLowerCase();
      })
      .filter(Boolean),
  );

  const suggestions = filterContacts(contacts, token).filter(
    (c) => !existingEmails.has(c.email),
  );
  const showDropdown = isOpen && suggestions.length > 0 && token.length > 0;

  const selectContact = useCallback(
    (contact: KnownContact) => {
      const { prefix } = getSegment();
      const formatted = contact.name
        ? `${contact.name} <${contact.email}>`
        : contact.email;
      onChange(`${prefix}${formatted}, `);
      setIsOpen(false);
      setHighlightIndex(0);
      inputRef.current?.focus();
    },
    [getSegment, onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!showDropdown) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          selectContact(suggestions[highlightIndex]);
          break;
        case "Escape":
          setIsOpen(false);
          break;
      }
    },
    [showDropdown, suggestions, highlightIndex, selectContact],
  );

  // Close on click outside
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Reset highlight when token changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [token]);

  return (
    <div ref={wrapperRef} className="relative flex-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="h-7 text-sm"
        autoComplete="off"
      />
      {showDropdown && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover py-1 shadow-md">
          {suggestions.map((contact, index) => (
            <button
              key={contact.email}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors",
                index === highlightIndex
                  ? "bg-muted text-foreground"
                  : "text-popover-foreground hover:bg-muted/50",
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus on input
                selectContact(contact);
              }}
              onMouseEnter={() => setHighlightIndex(index)}
            >
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                {getInitial(contact)}
              </div>
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
          ))}
        </div>
      )}
    </div>
  );
}
