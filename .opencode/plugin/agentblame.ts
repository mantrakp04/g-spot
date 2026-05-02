import type { Plugin } from "@opencode-ai/plugin"
import { execSync } from "child_process"

// Cache file paths from before hook (keyed by callID) so after hook can use them
const callFiles = new Map<string, string>()

// Store latest prompt and model per session from chat.message hook
const sessionPrompts = new Map<string, string>()
const sessionModels = new Map<string, string>()

export default (async (ctx) => {
  // Check if bunx is available (for running agentblame)
  let hasBunx = false
  try {
    execSync("command -v bunx", { stdio: "pipe" })
    hasBunx = true
  } catch {
    // bunx not installed - all captures will be no-ops
  }

  function capture(payload: any): void {
    if (!hasBunx) return  // Skip if bunx not installed
    try {
      execSync("bunx @mesadev/agentblame capture --provider opencode", {
        input: JSON.stringify(payload),
        cwd: ctx.directory || process.cwd(),
        stdio: ["pipe", "inherit", "inherit"],
        timeout: 5000,
      })
    } catch {
      // Silent failure - don't interrupt OpenCode
    }
  }

  return {
    // Capture user prompts and model info when a new message is created
    // Fires BEFORE tool execution starts (verified from OpenCode source: prompt.ts line 1193)
    //
    // Signature from @opencode-ai/plugin Hooks interface:
    //   (input: { sessionID, agent?, model?: { providerID, modelID }, messageID?, variant? },
    //    output: { message: UserMessage, parts: Part[] }) => void
    //
    // UserMessage has { role, model, sessionID } but NO content field
    // Content is in output.parts as Part objects: { type: "text", text: string, synthetic?: boolean }
    "chat.message": async (input, output) => {
      try {
        const sessionID = input.sessionID

        // Capture model from message (always has the resolved model)
        const message = output?.message
        if (message?.model) {
          sessionModels.set(sessionID, message.model.modelID || message.model.providerID)
        }
        // Fallback: model from input (may be undefined if user didn't specify)
        if (!sessionModels.has(sessionID) && input.model) {
          sessionModels.set(sessionID, input.model.modelID || input.model.providerID)
        }

        // Capture prompt text from parts (only for user messages)
        if (message?.role === "user" && output?.parts) {
          const textParts = output.parts
            .filter((p: any) => p.type === "text" && p.text && !p.synthetic)
            .map((p: any) => p.text)
          if (textParts.length > 0) {
            sessionPrompts.set(sessionID, textParts.join("\n"))
          }
        }
      } catch {
        // Silent failure
      }
    },

    // Capture file state BEFORE edit (same as Claude PreToolUse)
    // Signature: (input: { tool, sessionID, callID }, output: { args }) => void
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "edit" && input.tool !== "write") {
        return
      }

      const filePath = output?.args?.filePath
      if (!filePath) return

      // Cache filePath so after hook can retrieve it (after hook has no args)
      callFiles.set(input.callID, filePath)

      capture({
        tool: input.tool,
        sessionID: input.sessionID,
        filePath,
        hook_event: "before",
      })
    },

    // Capture file state AFTER edit (same as Claude PostToolUse)
    // Signature: (input: { tool, sessionID, callID }, output: { title, output, metadata }) => void
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "edit" && input.tool !== "write") {
        return
      }

      // Retrieve filePath cached from before hook
      const filePath = callFiles.get(input.callID)
      callFiles.delete(input.callID)
      if (!filePath) return

      const model = sessionModels.get(input.sessionID)
      const prompt = sessionPrompts.get(input.sessionID)

      capture({
        tool: input.tool,
        sessionID: input.sessionID,
        filePath,
        hook_event: "after",
        ...(model && { model }),
        ...(prompt && { prompt }),
      })
    },
  }
}) satisfies Plugin
