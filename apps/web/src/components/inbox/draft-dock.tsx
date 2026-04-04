import { useCallback, useMemo } from "react";

import { Badge } from "@g-spot/ui/components/badge";
import { useUser } from "@stackframe/react";
import { FileEdit } from "lucide-react";

import { useDrafts } from "@/contexts/drafts-context";
import { DraftPanel } from "./draft-panel";

const MAX_VISIBLE = 3;

export function DraftDock() {
  const {
    dockDrafts,
    updateField,
    setGmailDraftId,
    minimizeDraft,
    expandDraft,
    closeDraft,
    addAttachments,
    removeAttachment,
  } = useDrafts();

  const user = useUser();
  const accounts = user?.useConnectedAccounts();

  const resolveAccount = useCallback(
    (accountId: string | null) => {
      if (!accounts) return null;
      if (accountId) {
        return accounts.find((a) => a.providerAccountId === accountId) ?? null;
      }
      return accounts.find((a) => a.provider === "google") ?? null;
    },
    [accounts],
  );

  const visible = useMemo(
    () => dockDrafts.slice(-MAX_VISIBLE),
    [dockDrafts],
  );
  const overflowCount = dockDrafts.length - visible.length;

  if (dockDrafts.length === 0) return null;

  return (
    <div className="fixed bottom-0 right-4 z-40 flex items-end gap-2">
      {/* Overflow indicator */}
      {overflowCount > 0 && (
        <div className="mb-0 flex items-center gap-1.5 rounded-t-lg border border-b-0 bg-card px-3 py-2 shadow-lg">
          <FileEdit className="size-3.5 text-muted-foreground" />
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
            +{overflowCount}
          </Badge>
        </div>
      )}

      {/* Visible panels */}
      {visible.map((draft) => (
        <DraftPanel
          key={draft.id}
          draft={draft}
          googleAccount={resolveAccount(draft.accountId)}
          onUpdateField={updateField}
          onSetGmailDraftId={setGmailDraftId}
          onMinimize={minimizeDraft}
          onExpand={expandDraft}
          onClose={closeDraft}
          onAddAttachments={addAttachments}
          onRemoveAttachment={removeAttachment}
        />
      ))}
    </div>
  );
}
