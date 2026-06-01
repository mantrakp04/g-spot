import { useCallback, useState } from "react";

import { Button } from "@g-spot/ui/components/button";
import { useUser } from "@hexclave/react";
import { Check, LogIn } from "lucide-react";
import { toast } from "sonner";

import { signInWithExternalBrowser } from "@/lib/desktop-auth";

export function SignInStep() {
  const user = useUser();
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      await signInWithExternalBrowser();
      toast.success("Signed in");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSigningIn(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {user ? "You're signed in" : "Sign in to get started"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {user
            ? `Signed in as ${user.primaryEmail ?? user.displayName ?? "your account"}. You can move on to the next step.`
            : "Your account syncs settings, memory, and connections across devices. We'll open your browser to finish sign-in."}
        </p>
      </div>

      {user ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
          <Check className="size-4" />
          Account connected
        </div>
      ) : (
        <Button onClick={handleSignIn} disabled={signingIn}>
          <LogIn className="size-4" />
          {signingIn ? "Waiting for browser…" : "Sign in / Sign up"}
        </Button>
      )}
    </div>
  );
}
