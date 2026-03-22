# Standalone llama.cpp WebUI

## Project Overview
This is a standalone, client-side WebUI designed to interact with OpenAI-compatible APIs, specifically optimized for `llama.cpp`. It features a rich chat interface with conversation branching, file attachments, MCP (Model Context Protocol) tool integration, agentic reasoning, and mobile support via Capacitor.

**Key Characteristics:**
- **Client-Side Only:** No backend server for the UI itself. All data (history, keys) is stored locally in the browser via IndexedDB (Dexie).
- **Backend Agnostic:** Works with any OpenAI-compatible endpoint (local `llama-server`, external APIs like Vultr, DeepInfra, OpenRouter).
- **MCP Support:** Connect to MCP servers (SSE/WebSocket/StreamableHTTP) for tool calling (web search, file access, etc.).
- **Agentic:** Models can call tools, receive results, and continue reasoning — full tool execution loop.
- **Mobile Support:** Packaged as an Android app using Capacitor.

## Tech Stack
- **Framework:** SvelteKit 2 (Svelte 5.36 with Runes)
- **Language:** TypeScript (strict)
- **Styling:** TailwindCSS 4
- **UI Components:** bits-ui 2.14.4, tailwind-variants
- **Persistence:** Dexie.js (IndexedDB wrapper)
- **Build Tool:** Vite 7
- **Mobile:** Capacitor (Android)
- **MCP:** @modelcontextprotocol/sdk, zod
- **Testing:** Vitest (Unit), Playwright (E2E)
- **UI Development:** Storybook 10

## Architecture

### Core Services (`src/lib/services/`)
- **`ChatService` (`chat.ts`):** Stateless API layer. Handles HTTP requests, streaming responses, parsing `<think>` tags (reasoning models), tool call parsing, and formatting messages for the API. Supports `tools` and `tool_choice` parameters for MCP integration. Automatically injects current date/time and timezone into system messages.
- **`MCPService` (`mcp.service.ts`):** MCP protocol client. Handles WebSocket, SSE, and StreamableHTTP transports. Manages server connections, tool discovery, and tool execution. Auto-detects SSE endpoints by URL path (`/sse`).
- **`BuiltinToolsService` (`builtin-tools.service.ts`):** Provides browser-local tools (calculator, date math) that work without any MCP server. Tools are prefixed with `builtin_` and executed locally.
- **`DatabaseService` (`database.service.ts`):** Encapsulates all Dexie.js interactions. Manages persistence for conversations and messages.
- **`PropsService` (`props.service.ts`):** Fetches server properties endpoint (for llama.cpp server capabilities).
- **`SlotsService` (`slots.ts`):** Monitors server slot usage/capacity (specific to `llama.cpp` server).

### State Management (`src/lib/stores/`)
- **`ChatStore` (`chat.svelte.ts`):** The central store for UI state. Orchestrates message sending, agentic tool execution loop (send → model calls tool → execute → send results back → model may call more tools → loop up to `maxToolIterations`), regeneration, and manages the active conversation. Each agentic iteration renders as separate bubbles (reasoning, text, tool calls) for clear multi-step visibility.
- **`ConversationsStore` (`conversations.svelte.ts`):** Manages conversation lifecycle — CRUD, title updates, branching, navigation, import/export. Extracted from ChatStore.
- **`MCPStore` (`mcp.svelte.ts`):** MCP server state orchestration. Manages connections, health checks, tool definitions, and tool execution. Provides `getToolDefinitionsForLLM()` for injecting tools into API requests and `executeTool()` for running tools.
- **`MCPResourcesStore` (`mcp-resources.svelte.ts`):** MCP resource caching.
- **`AgenticStore` (`agentic.svelte.ts`):** Manages agentic sections in messages (reasoning blocks, tool calls).
- **`SettingsStore` (`settings.svelte.ts`):** Manages user preferences (API URL, model parameters, MCP server configs).
- **`ServerStore` (`server.svelte.ts`):** Server connection state and props.

### Data Model
- **Conversations:** stored in `conversations` table.
- **Messages:** stored in `messages` table. Supports a **tree structure** (branching) where each message points to a parent.
- **Attachments:** Stored as base64 strings within the message `extra` field.
- **MCP Server configs:** Stored in localStorage via settings (key: `mcpServers`).

## Key Directories
- `src/lib/components/app/`: Core application UI components organized by category:
  - `chat/`: Chat UI (messages, form, sidebar, settings)
  - `mcp/`: MCP server management UI (server cards, forms, connection logs, resource browser)
  - `actions/`: Action buttons and controls
  - `badges/`: Status badges
  - `content/`: Content renderers (markdown, syntax highlighting, collapsible blocks)
  - `forms/`: Form components
  - `navigation/`: Navigation components
  - `models/`: Model selection UI
  - `dialogs/`: Dialog components
  - `misc/`: Miscellaneous components
- `src/lib/services/`: Business logic and API communication.
- `src/lib/stores/`: State management and database persistence.
- `src/lib/types/`: TypeScript definitions (`api.d.ts`, `database.d.ts`, `mcp.d.ts`, `agentic.d.ts`).
- `src/lib/enums/`: Enumerations (MCP, agentic, settings, UI).
- `src/lib/constants/`: Configuration constants.
- `src/lib/utils/`: Utility functions (MCP, agentic parsing, formatters, clipboard, etc.).
- `src/lib/contexts/`: Svelte context providers for dependency injection.
- `src/routes/`: SvelteKit routes (Main UI is in `+page.svelte`).
- `tests/`: Test files organized as `unit/`, `client/`, `e2e/`, `stories/`.

## Development Workflow

### Web Development
```bash
npm install       # Install dependencies
npm run dev       # Start development server (localhost:8000)
npm run build     # Build for production
```

### Mobile Development (Android)
```bash
npm run cap:sync  # Sync web build to Android project
npm run cap:run   # Build and run on connected Android device
npm run cap:open  # Open Android Studio
```

### Testing
```bash
npm run test          # Run all tests
npm run test:unit     # Run unit tests (Vitest)
npm run test:e2e      # Run E2E tests (Playwright)
npm run storybook     # Start Storybook for component development
```

## MCP Integration

### How It Works
1. Add MCP servers in **Settings → MCP Servers** tab (SSE/WebSocket/StreamableHTTP)
2. When chatting, the app auto-connects to enabled MCP servers via `mcpStore.ensureInitialized()`
3. Built-in tools (calculator, date math) + MCP tool definitions are injected into the API request as OpenAI-format `tools`
4. When the model calls a tool, the app routes it: built-in tools execute locally, MCP tools execute via `mcpStore.executeTool()`
5. Tool results are sent back to the model, which may call more tools (agentic loop, up to `maxToolIterations` from Developer settings)
6. Reasoning and tool call details accumulate in a collapsible thinking bubble across all iterations
7. The model generates a final response after all tool calls complete

### Built-in Tools
These tools work without any MCP server — they execute locally in the browser:
- **`builtin_calculator`** — Safe math expression evaluator (arithmetic, sqrt, sin/cos/tan, log, min/max, PI, E)
- **`builtin_date_math`** — Date calculations (now, add/subtract duration, diff between dates, format)

### System Message Enrichment
Every API request automatically includes the client's local date, time, and timezone in the system message (e.g., `[Current date and time: 3/13/2026, 2:30:45 PM | Timezone: Asia/Kuala_Lumpur]`). This is appended to whatever system prompt the user has configured.

### CORS for MCP Servers
Browser-based MCP connections require CORS headers. For servers without CORS:
- Run a CORS proxy (e.g., a simple Node.js proxy) in front of the MCP server
- Or use the built-in `/cors-proxy` (requires llama.cpp server running on port 8080)

### Supported Transports
- **SSE:** URLs ending in `/sse` auto-detect as SSE transport
- **StreamableHTTP:** Default for other URLs
- **WebSocket:** Explicit configuration

## Conventions
- **Svelte 5:** Use Runes (`$state`, `$derived`, `$effect`) for reactivity. Avoid legacy store syntax.
- **Tailwind:** Use utility classes for styling.
- **Imports:** Use `$lib` alias for accessing `src/lib`.
- **File naming:** `*.service.ts` for services, `*.svelte.ts` for stores.
- **Formatting:** Prettier and ESLint are configured. Run `npm run format` and `npm run lint`.

## Version Compatibility Notes
- **Svelte:** Pinned to 5.36.x (5.38+ has `blockers` API incompatibility with bits-ui)
- **bits-ui:** Pinned to 2.14.4
- **mode-watcher:** 1.1.0 — `<ModeWatcher />` component replaced with `setMode()` call due to Svelte 5 incompatibility

## Android Signing

Use the shared keystore at `/home/suananda/Program_made/ANDROID_sign/release-key.jks` for all release APK signing.

- **Alias:** `nandaida-key`
- **Zipalign:** `/home/suananda/Android/Sdk/build-tools/36.1.0/zipalign`
- See `/home/suananda/Program_made/ANDROID_sign/README.md` for full commands.
