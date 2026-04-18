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
import { Textarea } from "@g-spot/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, CircleAlert, Loader2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  useRemovePiCredentialMutation,
  useSavePiCredentialMutation,
} from "@/hooks/use-pi";
import { piKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

type PiCredentialFlows = {
  configureApiKey: (provider: string) => void;
  connectOAuth: (provider: string) => Promise<void>;
  removeCredential: (provider: string) => Promise<void>;
  isRemoving: boolean;
  isConnectingOAuth: boolean;
};

const PiCredentialFlowsContext = createContext<PiCredentialFlows | null>(null);

function prettyProviderName(providerId: string) {
  return providerId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isOauthSessionRunning(status: string | undefined) {
  return (
    status === "running" ||
    status === "waiting_for_prompt" ||
    status === "waiting_for_manual_code"
  );
}

export function PiCredentialFlowsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();

  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [oauthPromptValue, setOauthPromptValue] = useState("");
  const [oauthManualCode, setOauthManualCode] = useState("");
  const lastOauthStatusRef = useRef<string | null>(null);

  const saveApiKeyMutation = useSavePiCredentialMutation();
  const removeCredentialMutation = useRemovePiCredentialMutation();

  const oauthSession = useQuery({
    queryKey: piKeys.oauthSession(oauthSessionId),
    queryFn: () =>
      trpcClient.pi.oauthSession.query({ sessionId: oauthSessionId! }),
    enabled: !!oauthSessionId,
    refetchInterval: (query) =>
      isOauthSessionRunning(query.state.data?.status) ? 1500 : false,
  });

  const startOAuthMutation = useMutation({
    mutationFn: (provider: string) =>
      trpcClient.pi.startOAuth.mutate({ provider }),
    onSuccess: (session) => {
      setOauthPromptValue("");
      setOauthManualCode("");
      setOauthSessionId(session.id);
    },
  });

  const submitOauthPromptMutation = useMutation({
    mutationFn: (input: { sessionId: string; value: string }) =>
      trpcClient.pi.submitOAuthPrompt.mutate(input),
    onSuccess: () => setOauthPromptValue(""),
  });

  const submitOauthManualCodeMutation = useMutation({
    mutationFn: (input: { sessionId: string; value: string }) =>
      trpcClient.pi.submitOAuthManualCode.mutate(input),
    onSuccess: () => setOauthManualCode(""),
  });

  const cancelOauthMutation = useMutation({
    mutationFn: (sessionId: string) =>
      trpcClient.pi.cancelOAuth.mutate({ sessionId }),
    onSuccess: () => {
      setOauthSessionId(null);
      setOauthPromptValue("");
      setOauthManualCode("");
    },
  });

  useEffect(() => {
    const status = oauthSession.data?.status ?? null;
    if (!status || lastOauthStatusRef.current === status) return;

    lastOauthStatusRef.current = status;
    if (status === "completed") {
      toast.success(`${oauthSession.data?.providerName ?? "Provider"} connected`);
      void queryClient.invalidateQueries({ queryKey: piKeys.catalog() });
    }
    if (status === "error" && oauthSession.data?.errorMessage) {
      toast.error(oauthSession.data.errorMessage);
    }
  }, [oauthSession.data, queryClient]);

  const configureApiKey = useCallback((provider: string) => {
    setApiKeyProvider(provider);
    setApiKeyValue("");
  }, []);

  const connectOAuth = useCallback(
    async (provider: string) => {
      await startOAuthMutation.mutateAsync(provider);
    },
    [startOAuthMutation],
  );

  const removeCredential = useCallback(
    async (provider: string) => {
      await removeCredentialMutation.mutateAsync(provider);
      toast.success(`${prettyProviderName(provider)} credential removed`);
    },
    [removeCredentialMutation],
  );

  const saveApiKey = useCallback(async () => {
    if (!apiKeyProvider || apiKeyValue.trim().length === 0) return;
    const provider = apiKeyProvider;
    await saveApiKeyMutation.mutateAsync({
      provider,
      apiKey: apiKeyValue.trim(),
    });
    toast.success(`${prettyProviderName(provider)} API key saved`);
    setApiKeyProvider(null);
    setApiKeyValue("");
  }, [apiKeyProvider, apiKeyValue, saveApiKeyMutation]);

  const value = useMemo<PiCredentialFlows>(
    () => ({
      configureApiKey,
      connectOAuth,
      removeCredential,
      isRemoving: removeCredentialMutation.isPending,
      isConnectingOAuth: startOAuthMutation.isPending,
    }),
    [
      configureApiKey,
      connectOAuth,
      removeCredential,
      removeCredentialMutation.isPending,
      startOAuthMutation.isPending,
    ],
  );

  return (
    <PiCredentialFlowsContext.Provider value={value}>
      {children}

      <Dialog
        open={apiKeyProvider !== null}
        onOpenChange={(open) => {
          if (!open) {
            setApiKeyProvider(null);
            setApiKeyValue("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {apiKeyProvider ? prettyProviderName(apiKeyProvider) : "Provider"} API key
            </DialogTitle>
            <DialogDescription>
              Stored locally and used to authenticate requests to this provider.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder="sk-..."
            value={apiKeyValue}
            onChange={(event) => setApiKeyValue(event.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setApiKeyProvider(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void saveApiKey()}
              disabled={
                saveApiKeyMutation.isPending || apiKeyValue.trim().length === 0
              }
            >
              {saveApiKeyMutation.isPending ? "Saving…" : "Save key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={oauthSessionId !== null}
        onOpenChange={(open) => {
          if (!open && oauthSessionId) {
            void cancelOauthMutation.mutateAsync(oauthSessionId);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {oauthSession.data?.providerName ?? "Provider"} sign-in
            </DialogTitle>
            <DialogDescription>
              Complete the OAuth flow below. Steps update as the provider progresses.
            </DialogDescription>
          </DialogHeader>

          {oauthSession.data?.auth?.instructions ? (
            <p className="text-muted-foreground">
              {oauthSession.data.auth.instructions}
            </p>
          ) : null}

          {oauthSession.data?.auth?.url ? (
            <Button
              variant="outline"
              size="sm"
              className="justify-between"
              render={
                <a
                  href={oauthSession.data.auth.url}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              Open provider login
              <ArrowUpRight className="size-3.5" />
            </Button>
          ) : null}

          {oauthSession.data?.progress?.length ? (
            <div className="space-y-1">
              <p className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
                Progress
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {oauthSession.data.progress.slice(-6).map((entry, index) => (
                  <li key={`${entry}-${index}`} className="truncate">
                    {entry}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {oauthSession.data?.status === "waiting_for_prompt" &&
          oauthSession.data.prompt ? (
            <label className="space-y-1.5">
              <span className="font-medium">{oauthSession.data.prompt.message}</span>
              <Input
                placeholder={oauthSession.data.prompt.placeholder ?? "Response"}
                value={oauthPromptValue}
                onChange={(event) => setOauthPromptValue(event.target.value)}
                autoFocus
              />
            </label>
          ) : null}

          {oauthSession.data?.status === "waiting_for_manual_code" ? (
            <label className="space-y-1.5">
              <span className="font-medium">Manual code</span>
              <Textarea
                placeholder="Paste the code from the provider"
                value={oauthManualCode}
                onChange={(event) => setOauthManualCode(event.target.value)}
                autoFocus
              />
            </label>
          ) : null}

          {oauthSession.data?.status === "completed" ? (
            <p className="flex items-center gap-1.5 text-emerald-500">
              <Check className="size-3.5" strokeWidth={2.5} />
              Provider connected.
            </p>
          ) : null}

          {oauthSession.data?.status === "error" && oauthSession.data.errorMessage ? (
            <p className="flex items-start gap-1.5 text-destructive">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{oauthSession.data.errorMessage}</span>
            </p>
          ) : null}

          <DialogFooter className="items-center sm:justify-between">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              {oauthSession.isFetching ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Syncing…
                </>
              ) : null}
            </span>
            <div className="flex items-center gap-2">
              {isOauthSessionRunning(oauthSession.data?.status) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    oauthSessionId
                      ? cancelOauthMutation.mutate(oauthSessionId)
                      : undefined
                  }
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOauthSessionId(null);
                    setOauthPromptValue("");
                    setOauthManualCode("");
                  }}
                >
                  Close
                </Button>
              )}
              {oauthSession.data?.status === "waiting_for_prompt" &&
              oauthSession.data.prompt ? (
                <Button
                  size="sm"
                  onClick={() =>
                    oauthSessionId
                      ? submitOauthPromptMutation.mutate({
                          sessionId: oauthSessionId,
                          value: oauthPromptValue,
                        })
                      : undefined
                  }
                  disabled={
                    submitOauthPromptMutation.isPending ||
                    (!oauthSession.data.prompt.allowEmpty &&
                      oauthPromptValue.trim().length === 0)
                  }
                >
                  Submit
                </Button>
              ) : null}
              {oauthSession.data?.status === "waiting_for_manual_code" ? (
                <Button
                  size="sm"
                  onClick={() =>
                    oauthSessionId
                      ? submitOauthManualCodeMutation.mutate({
                          sessionId: oauthSessionId,
                          value: oauthManualCode,
                        })
                      : undefined
                  }
                  disabled={
                    submitOauthManualCodeMutation.isPending ||
                    oauthManualCode.trim().length === 0
                  }
                >
                  Submit code
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PiCredentialFlowsContext.Provider>
  );
}

export function usePiCredentialFlows() {
  const value = useContext(PiCredentialFlowsContext);
  if (!value) {
    throw new Error(
      "usePiCredentialFlows must be used within PiCredentialFlowsProvider",
    );
  }
  return value;
}
