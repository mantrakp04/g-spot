import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { trpcClient } from "@/utils/trpc";

export const Route = createFileRoute("/auth/openai/callback")({
  component: OpenAICallbackPage,
});

function OpenAICallbackPage() {
  const exchanged = useRef(false);

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");

    if (error) {
      notify("error");
      return;
    }

    if (!code || !state) {
      notify("error");
      return;
    }

    trpcClient.openai.exchangeCode
      .mutate({ code, state })
      .then(() => notify("success"))
      .catch(() => notify("error"));
  }, []);

  return (
    <div className="flex h-screen items-center justify-center">
      <p className="text-muted-foreground text-sm">Connecting OpenAI…</p>
    </div>
  );
}

function notify(status: "success" | "error") {
  if (window.opener) {
    window.opener.postMessage({ type: "openai-oauth", status }, "*");
  }
  window.close();
}
