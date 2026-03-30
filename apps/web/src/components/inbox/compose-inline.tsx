import { Separator } from "@g-spot/ui/components/separator";

import type { ComposeState } from "@/hooks/use-compose-state";
import { ComposeForm } from "./compose-form";

type ComposeInlineProps = {
  compose: ComposeState;
};

export function ComposeInline({ compose }: ComposeInlineProps) {
  if (!compose.isOpen) return null;

  return (
    <>
      <Separator />
      <div className="px-6 py-4">
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
      </div>
    </>
  );
}
