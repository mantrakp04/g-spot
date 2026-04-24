# Pi UI Contract

Backend source of truth for the Pi migration:

- [chat stream](/Users/barreloflube/Desktop/g-spot/packages/api/src/chat-stream.ts)
- [Pi router](/Users/barreloflube/Desktop/g-spot/packages/api/src/routers/pi.ts)
- [chat router](/Users/barreloflube/Desktop/g-spot/packages/api/src/routers/chat.ts)
- [Pi helpers](/Users/barreloflube/Desktop/g-spot/packages/api/src/lib/pi.ts)
- [Pi OAuth session helpers](/Users/barreloflube/Desktop/g-spot/packages/api/src/lib/pi-auth.ts)
- [shared Pi config/types](/Users/barreloflube/Desktop/g-spot/packages/types/src/agent.ts)
- [shared Pi metadata keys](/Users/barreloflube/Desktop/g-spot/packages/types/src/agent-metadata.ts)

## What Changed

- The backend no longer uses the Vercel AI SDK.
- The bespoke OpenAI OAuth callback server was removed.
- Chat streaming now uses Pi `AgentSession` events over WebSocket.
- Chat persistence now stores Pi `Message` objects.
- Chat records now persist a full `agentConfig` instead of relying on a single `model` string.
- Provider auth/config now lives under the generic `pi` tRPC router.

## Pi Config

Each chat/default uses this shape:

- `provider: string`
- `modelId: string`
- `thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"`
- `transport: "websocket"`
- `steeringMode: "one-at-a-time" | "all"`
- `followUpMode: "one-at-a-time" | "all"`
- `activeToolNames: ("read" | "bash" | "edit" | "write" | "grep" | "find" | "ls")[]`

## tRPC Routes

### `pi`

- `pi.catalog`
  Returns:
  - `oauthProviders`
  - `tools`
  - `models`
  - `availableModels`
  - `defaults`
  - `configuredProviders`

- `pi.defaults`
  Returns default `chat` and `worker` configs.

- `pi.updateDefaults`
  Input:
  - `chat?: PiAgentConfig`
  - `worker?: PiAgentConfig`

- `pi.credentials`
  Returns configured providers with credential type.

- `pi.saveApiKey`
  Input:
  - `provider`
  - `apiKey`

- `pi.removeCredential`
  Input:
  - `provider`

- `pi.startOAuth`
  Input:
  - `provider`
  Starts a Pi-native OAuth flow and returns an auth session object.

- `pi.oauthSession`
  Input:
  - `sessionId`

- `pi.submitOAuthPrompt`
  Input:
  - `sessionId`
  - `value`

- `pi.submitOAuthManualCode`
  Input:
  - `sessionId`
  - `value`

- `pi.cancelOAuth`
  Input:
  - `sessionId`

### `chat`

- `chat.create`
  Supports `agentConfig`.

- `chat.get`
  Returns parsed `agentConfig`.

- `chat.list`
  Returns parsed `agentConfig` on each chat row.

- `chat.messages`
  Returns Pi messages with:
  - `id`
  - `createdAt`
  - message fields from Pi

- `chat.updateAgentConfig`
  Input:
  - `chatId`
  - `agentConfig`

## Chat Streaming

WebSocket endpoint:

- `GET /api/chat/:chatId/socket`

Client messages:

- `{ "type": "start", "message": ... }`
- `{ "type": "attach" }`

Server messages:

- `{ "type": "socket_attached" }`
- `{ "type": "socket_missing" }`
- raw Pi `AgentSessionEvent` JSON objects

Runtime status WebSocket endpoint:

- `GET /api/chat/status/socket`

Status messages:

- server: `{ "type": "runtime_statuses", "statuses": { [chatId]: status } }`
- client: `{ "type": "mark_read", "chatId": "..." }`

There is also a non-SDK error payload shaped like:

- `{ type: "gspot_error", message: string }`

Use the Pi event `type` field to drive UI state.

## Frontend Files Likely To Change

- [chat view](/Users/barreloflube/Desktop/g-spot/apps/web/src/components/chat/chat-view.tsx)
- [chat message](/Users/barreloflube/Desktop/g-spot/apps/web/src/components/chat/chat-message.tsx)
- [chat data hooks](/Users/barreloflube/Desktop/g-spot/apps/web/src/hooks/use-chat-data.ts)
- [chat settings page](/Users/barreloflube/Desktop/g-spot/apps/web/src/components/chat/chat-settings-page.tsx)
- [connected accounts](/Users/barreloflube/Desktop/g-spot/apps/web/src/components/connected-accounts.tsx)
- [query keys](/Users/barreloflube/Desktop/g-spot/apps/web/src/lib/query-keys.ts)
- [web package manifest](/Users/barreloflube/Desktop/g-spot/apps/web/package.json)

## Frontend Requirements

- Remove the AI SDK usage from the web app.
- Remove OpenAI-specific connection UI and replace it with Pi provider management.
- Surface all configurable Pi settings in UI:
  - provider
  - model
  - thinking level
  - transport
  - steering mode
  - follow-up mode
  - active tools
  - default chat config
  - default worker config
  - API-key auth
  - OAuth auth status and flows
- Consume the Pi WebSocket event stream for chat state instead of `useChat`.
- Keep existing chat list/detail/fork/delete behavior working.
