# Upstream vs Standalone WebUI — Divergence Analysis

**Analysis date:** 2026-03-24
**Upstream (llama.cpp webui) last commit checked:** `11fb11b90` — webui: Improve chat form positioning (#20901)
**Standalone last commit:** `dd1e55f` — cache system message datetime to improve llama.cpp KV cache reuse

---

## Summary

The standalone app forked from llama.cpp's `tools/server/webui/` and has since diverged. Both codebases share the same Svelte 5 + SvelteKit foundation but serve different purposes:

- **Upstream:** Embedded UI for llama.cpp server (web-only, monorepo-integrated)
- **Standalone:** Backend-agnostic client for any OpenAI-compatible API + Android app via Capacitor

As of this analysis, the standalone is **not significantly behind** upstream on functionality. Most upstream changes are architectural refactors, not new features the standalone lacks.

---

## File Counts (src/ directory)

| | Standalone | Upstream |
|---|---|---|
| Total files | 371 | 404 |
| Shared files | 327 | 327 |
| Unique files | 44 | 77 |

---

## Features: Standalone vs Upstream

### Features both have (no action needed)

| Feature | Standalone | Upstream |
|---|---|---|
| MCP server management UI | Full (server cards, forms, connection logs, resource browser) | Full (similar + dialog wrappers) |
| Agentic tool execution loop | `chat.svelte.ts` (lines 634-887) | `agentic.svelte.ts` (700 lines) — same logic, different file |
| Message editing | 3 modes: branch, preserve responses, in-place | `ChatMessageEditForm.svelte` — fewer modes |
| Code block copy/preview buttons | `enhanceCodeBlocks()` DOM post-processing | `rehypeEnhanceCodeBlocks` AST plugin — same result |
| Link security (target=_blank) | `enhanceLinks()` DOM post-processing | `rehypeEnhanceLinks` AST plugin — same result |
| Syntax highlighting | rehype-highlight + theme switching | Same |
| LaTeX/KaTeX math | remarkMath + rehypeKatex | Same |
| GFM tables | remarkGfm + table HTML restorer | Same |
| Conversation branching/tree | Full tree structure with navigation | Same |
| Dark/light theme | mode-watcher | Same |
| File attachments (image, text, PDF, audio) | Full with thumbnails and preview dialogs | Same |
| Streaming responses | Full with incremental rendering | Same |

### Features only in standalone

| Feature | Details |
|---|---|
| Android/mobile app | Capacitor build system (cap:sync, cap:run, cap:open) |
| Backend agnostic | Works with any OpenAI-compatible API (Vultr, DeepInfra, OpenRouter, local llama-server) |
| Built-in tools | `builtin_calculator`, `builtin_date_math` — work without any MCP server |
| Slot monitoring | `slots.ts` — monitors llama.cpp server slot usage |
| Storybook stories | Component stories in `src/stories/` for development |
| Server test infrastructure | `tests/server/` test project |

### Features only in upstream

| Feature | Priority | Notes |
|---|---|---|
| ChatFormPicker (modular model selector) | Low | Replaces monolithic `ChatFormModelSelector.svelte` with 5 smaller components. Cosmetic refactor, no new functionality. |
| ChatFormPromptPicker | Low | MCP prompt selection UI in chat form. Only useful if MCP servers expose prompts. |
| ChatFormResourcePicker | Low | MCP resource picker in chat form. Only useful if MCP servers expose resources. |
| ChatMessageStatistics | Low | Displays message metadata/statistics. Nice-to-have. |
| ChatMessageSystem | Low | Replaces `ChatMessageThinkingBlock`. Broader system message handling. |
| DialogMcpServersSettings | Low | Dialog wrapper around MCP settings. Standalone has the settings directly. |
| DialogMcpResources / DialogMcpResourcePreview | Low | MCP resource browsing in dialogs. Standalone has `McpResourceBrowser` already. |
| DialogModelInformation / DialogModelNotAvailable | Low | Model info/unavailable dialogs. |
| DialogCodePreview | Low | Standalone has `CodePreviewDialog` (same thing, different name). |
| UI primitives: alert, popover, table | Low | 19 new shadcn-style components. Only needed if building new UI that uses them. |
| HorizontalScrollCarousel | Low | Carousel component. |
| TruncatedText | Low | Text truncation utility component. |
| ModelsSelectorList | Low | New model selection list component. |
| Markdown rehype plugins | Done | `resolve-attachment-images.ts` — added to standalone. `enhance-links.ts` and `enhance-code-blocks.ts` — standalone uses DOM post-processing instead (same result). |
| New constants (8 files) | Low | `attachment-labels`, `chat-form`, `code-blocks`, `css-classes`, `floating-ui-constraints`, `message-export`, `model-id`, `ui`. Extracted from inline values. |
| New utils (6 files) | Low | `api-fetch`, `api-headers`, `attachment-display`, `attachment-type`, `browser-only`, `cache-ttl`. Extracted helpers. |
| Service renames | Skip | `chat.ts` → `chat.service.ts`, `models.ts` → `models.service.ts`. Cosmetic. |
| Barrel export reorganization | Skip | `app/index.ts` changed from explicit exports to directory re-exports. Cosmetic. |

---

## Heavily Diverged Shared Files

| File | Standalone | Upstream | Nature of Change |
|---|---|---|---|
| `ChatForm.svelte` | 8.6KB | 15.9KB | Upstream added picker integration |
| `ChatFormActions.svelte` | 2.5KB | 7.5KB | Upstream split into sub-components |
| `ChatSidebar.svelte` | 16.2KB | 6.3KB | Standalone has more features inline |
| `agentic.svelte.ts` | 1.5KB | 21KB | Upstream moved agentic loop here from chat store |
| `models.svelte.ts` | 6KB | 19KB | Upstream expanded model management |
| `chat.svelte.ts` | 83KB | 55KB | Standalone has agentic loop + built-in tools here |
| `app/index.ts` | 7.2KB | 285B | Different export strategies |

---

## Build & Config Differences

| Aspect | Standalone | Upstream |
|---|---|---|
| Build command | `vite build` | `vite build && ./scripts/post-build.sh` |
| Output path | `public/` | `../public/` (monorepo-aware) |
| Dev server port | 8000 (explicit) | Default (no explicit port) |
| Vite proxy | `/api`, `/chat/completions` | `/api`, `/chat/completions`, `/v1`, `/models` |
| Workspace resolution | No | Yes (`searchForWorkspaceRoot`) |
| Capacitor | Yes | No (removed) |
| SCSS deprecation silencing | Yes | Removed |

---

## Dependency Differences

### Standalone only
- `@capacitor/android`, `@capacitor/cli`, `@capacitor/core`, `@capacitor/filesystem`

### Version differences (standalone → upstream)
- `svelte`: 5.36.x → 5.38.2
- `storybook`: 10.0.7 → 10.2.4
- `@internationalized/date`: 3.8.2 → 3.10.1

---

## Conclusion

The standalone app is **functionally on par** with upstream. The 77 upstream-only files are primarily:
1. Architectural refactors (picker system, service renames, barrel exports)
2. UI component library additions (alert, popover, table primitives)
3. Dialog wrappers around existing functionality

**Recommendation: Keep standalone as-is, selectively port only if needed.**

The standalone has unique value (mobile support, backend-agnostic, built-in tools) that upstream intentionally does not support. The upstream is moving toward tighter llama.cpp integration (workspace-aware builds, post-build scripts, removed mobile support).

### What was ported in this session
- `src/lib/markdown/resolve-attachment-images.ts` — Rehype plugin to resolve MCP attachment image references (e.g., `mcp-attachment-xxx.png`) to base64 data URLs in rendered markdown. Future-proofing for MCP tools that return base64 images.

### Periodic sync strategy
- Check upstream every few weeks for bug fixes in shared files
- Cherry-pick individual utility files if needed
- Do NOT attempt wholesale merge — the architectures have diverged enough that this would be destructive
