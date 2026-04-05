import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@g-spot/ui/components/card";
import { ChatModelPreferenceControl } from "@/components/chat/chat-model-preference-control";
import {
  useDefaultChatModelPreference,
  useDefaultWorkerModelPreference,
} from "@/hooks/use-chat-preferences";

export function ChatPreferences() {
  const {
    defaultChatModel,
    setDefaultChatModel,
    isSaving: isSavingChatModel,
  } = useDefaultChatModelPreference();
  const {
    defaultWorkerModel,
    setDefaultWorkerModel,
    isSaving: isSavingWorkerModel,
  } = useDefaultWorkerModelPreference();

  return (
    <Card className="rounded-lg border border-border/60 bg-card">
      <CardHeader className="border-b border-border/50">
        <CardTitle>Chat Preferences</CardTitle>
        <CardDescription>
          Configure the default chat model and the worker model used for title refreshes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <ChatModelPreferenceControl
          fieldId="default-chat-model"
          label="Default chat model"
          value={defaultChatModel}
          isSaving={isSavingChatModel}
          onChange={setDefaultChatModel}
          successMessage="Default chat model updated"
          errorMessage="Could not save default chat model"
          description="New draft chats start here. Changing the model in a brand new chat also updates this default."
        />

        <ChatModelPreferenceControl
          fieldId="default-worker-model"
          label="Default worker model"
          value={defaultWorkerModel}
          isSaving={isSavingWorkerModel}
          onChange={setDefaultWorkerModel}
          successMessage="Default worker model updated"
          errorMessage="Could not save default worker model"
          description="g-spot stores both preferences in your Stack Auth client metadata."
        />
      </CardContent>
    </Card>
  );
}
