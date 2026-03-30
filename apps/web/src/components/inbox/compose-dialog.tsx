import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@g-spot/ui/components/dialog";

import type { ComposeState } from "@/hooks/use-compose-state";
import { ComposeForm } from "./compose-form";

type ComposeDialogProps = {
  compose: ComposeState;
};

export function ComposeDialog({ compose }: ComposeDialogProps) {
  return (
    <Dialog
      open={compose.isOpen && compose.mode === "new"}
      onOpenChange={(open: boolean) => {
        if (!open) compose.closeCompose();
      }}
    >
      <DialogContent className="min-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
        </DialogHeader>
        <ComposeForm
          mode={compose.mode}
          form={compose.form}
          onUpdateField={compose.updateField}
          onSend={compose.send}
          onDiscard={compose.discardDraft}
          onClose={compose.closeCompose}
          isSaving={compose.isSaving}
          isSending={compose.isSending}
          lastSavedAt={compose.lastSavedAt}
          quotedContent={compose.quotedContent}
        />
      </DialogContent>
    </Dialog>
  );
}
