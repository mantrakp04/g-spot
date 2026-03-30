import { Button } from "@g-spot/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@g-spot/ui/components/dialog";
import { Input } from "@g-spot/ui/components/input";
import { useState } from "react";
import { toast } from "sonner";

import { trpcClient } from "@/utils/trpc";

export function OpenAIConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const key = apiKey.trim();
    if (!key) return;

    setLoading(true);
    try {
      await trpcClient.openai.saveKey.mutate({ apiKey: key });
      toast.success("OpenAI connected via API key");
      setApiKey("");
      onConnected();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to validate API key",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect OpenAI via API Key</DialogTitle>
          <DialogDescription>
            Enter your OpenAI API key. It will be validated and stored securely
            on the server. Use this if OAuth login doesn't work.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Input
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoFocus
            disabled={loading}
          />
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!apiKey.trim() || loading}>
              {loading ? "Validating…" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
