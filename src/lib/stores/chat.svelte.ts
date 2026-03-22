import { DatabaseService } from '$lib/services/database.service';
import { chatService, slotsService } from '$lib/services';
import { config, settingsStore } from '$lib/stores/settings.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { conversationsStore } from '$lib/stores/conversations.svelte';
import { mcpStore } from '$lib/stores/mcp.svelte';
import { getBuiltinToolDefinitions, isBuiltinTool, executeBuiltinTool } from '$lib/services/builtin-tools.service';
import { normalizeModelName } from '$lib/utils/model-names';
import { filterByLeafNodeId, findLeafNode, findDescendantMessages } from '$lib/utils/branching';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { toast } from 'svelte-sonner';
import { SvelteMap } from 'svelte/reactivity';
import type { ExportedConversations, DatabaseMessageExtra } from '$lib/types/database';

/**
 * ChatStore - Central state management for chat messaging and AI interactions
 *
 * This store manages the chat messaging experience including:
 * - Message management with branching support for conversation trees
 * - Real-time AI response streaming with reasoning content support
 * - File attachment handling and processing
 * - Context error management and recovery
 * - Message persistence through DatabaseService integration
 *
 * **Architecture & Relationships:**
 * - **ChatService**: Handles low-level API communication with AI models
 *   - ChatStore orchestrates ChatService for streaming responses
 *   - ChatService provides abort capabilities and error handling
 *   - ChatStore manages the UI state while ChatService handles network layer
 *
 * - **DatabaseService**: Provides persistent storage for conversations and messages
 *   - ChatStore uses DatabaseService for message CRUD operations
 *   - Maintains referential integrity for conversation trees
 *   - Handles message branching and parent-child relationships
 *
 * - **ConversationsStore**: Manages conversation lifecycle and state
 *   - ConversationsStore handles conversation CRUD (create, load, delete, update)
 *   - ChatStore focuses on message-level operations and streaming
 *   - Both stores coordinate through shared DatabaseService
 *
 * - **SlotsService**: Monitors server resource usage during AI generation
 *   - ChatStore coordinates slots polling during streaming
 *   - Provides real-time feedback on server capacity
 *
 * **Key Features:**
 * - Reactive state management using Svelte 5 runes ($state)
 * - Message branching for exploring different response paths
 * - Streaming AI responses with real-time content updates
 * - File attachment support (images, PDFs, text files, audio)
 * - Partial response saving when generation is interrupted
 * - Message editing with automatic response regeneration
 */
class ChatStore {
	currentResponse = $state('');
	errorDialogState = $state<{ type: 'timeout' | 'server'; message: string } | null>(null);
	isInitialized = $state(false);
	isLoading = $state(false);
	conversationLoadingStates = new SvelteMap<string, boolean>();
	conversationStreamingStates = new SvelteMap<string, { response: string; messageId: string }>();
	titleUpdateConfirmationCallback?: (currentTitle: string, newTitle: string) => Promise<boolean>;

	/**
	 * Helper properties that delegate to conversationsStore for seamless integration
	 */
	get activeConversation(): DatabaseConversation | null {
		return conversationsStore.activeConversation;
	}

	set activeConversation(value: DatabaseConversation | null) {
		conversationsStore.activeConversation = value;
	}

	get activeMessages(): DatabaseMessage[] {
		return conversationsStore.activeMessages;
	}

	set activeMessages(value: DatabaseMessage[]) {
		conversationsStore.activeMessages = value;
	}

	get conversations(): DatabaseConversation[] {
		return conversationsStore.conversations;
	}

	set conversations(value: DatabaseConversation[]) {
		conversationsStore.conversations = value;
	}

	constructor() {
		if (browser) {
			this.initialize();
		}
	}

	/**
	 * Initializes the chat store
	 * Sets up initial state - conversations are initialized by conversationsStore
	 */
	async initialize(): Promise<void> {
		try {
			// Register the title confirmation callback with conversationsStore
			if (this.titleUpdateConfirmationCallback) {
				conversationsStore.setTitleUpdateConfirmationCallback(this.titleUpdateConfirmationCallback);
			}

			this.isInitialized = true;
		} catch (error) {
			console.error('Failed to initialize chat store:', error);
		}
	}

	/**
	 * Creates a new conversation with model selection and navigates to it
	 * Delegates to conversationsStore but adds model selection logic
	 * @param name - Optional name for the conversation, defaults to timestamped name
	 * @returns The ID of the created conversation
	 */
	async createConversation(name?: string): Promise<string> {
		const conversationName = name || `Chat ${new Date().toLocaleString()}`;

		// Create conversation through conversationsStore
		const convId = await conversationsStore.createConversation(conversationName);

		// Store the currently selected model in the conversation
		const { modelsStore } = await import('$lib/stores/models.svelte');
		if (modelsStore.selectedModelName) {
			await DatabaseService.updateConversation(convId, { model: modelsStore.selectedModelName });
			// Update the active conversation in conversationsStore
			const conversation = await DatabaseService.getConversation(convId);
			if (conversation && conversationsStore.activeConversation?.id === convId) {
				conversationsStore.activeConversation = conversation;
			}
		}

		slotsService.setActiveConversation(convId);

		const isConvLoading = this.isConversationLoading(convId);
		this.isLoading = isConvLoading;

		this.currentResponse = '';

		return convId;
	}

	/**
	 * Loads a specific conversation and its messages
	 * Delegates to conversationsStore and synchronizes UI state
	 * @param convId - The conversation ID to load
	 * @returns True if conversation was loaded successfully, false otherwise
	 */
	async loadConversation(convId: string): Promise<boolean> {
		try {
			// Load conversation through conversationsStore
			const loaded = await conversationsStore.loadConversation(convId);

			if (!loaded) {
				return false;
			}

			slotsService.setActiveConversation(convId);

			const isConvLoading = this.isConversationLoading(convId);
			this.isLoading = isConvLoading;

			const streamingState = this.getConversationStreaming(convId);
			this.currentResponse = streamingState?.response || '';

			const activeMessages = conversationsStore.activeMessages;

			// Restore conversation state (image gen mode and model)
			// Check if this conversation has image generation messages
			const hasImageGeneration = activeMessages.some(
				(msg) =>
					msg.role === 'assistant' &&
					msg.extra &&
					msg.extra.some((extra: DatabaseMessageExtra) => extra.type === 'imageFile')
			);

			// Always set image generation mode based on conversation content (even if false)
			settingsStore.updateConfig('imageGenerationMode', hasImageGeneration);

			// Restore the model that was used for this specific conversation
			const conversation = conversationsStore.activeConversation;
			let modelToRestore = null;
			if (conversation?.model) {
				// If the conversation has a model field set, use it
				modelToRestore = conversation.model;
			} else if (activeMessages.length > 0) {
				// Otherwise, try to restore from last assistant message with model info
				const lastAssistantMessageWithModel = [...activeMessages]
					.reverse()
					.find((msg) => msg.role === 'assistant' && msg.model);

				if (lastAssistantMessageWithModel && lastAssistantMessageWithModel.model) {
					modelToRestore = lastAssistantMessageWithModel.model;
				}
			}

			// If we have a model to restore, select it
			if (modelToRestore) {
				// Find the model in the available models
				const { modelsStore } = await import('$lib/stores/models.svelte');
				const models = modelsStore.models;
				const modelOption = models.find(
					(m) => m.model === modelToRestore
				);

				if (modelOption) {
					// Select this model
					await modelsStore.select(modelOption.id);
				}
			}

			return true;
		} catch (error) {
			console.error('Failed to load conversation:', error);

			return false;
		}
	}

	/**
	 * Adds a new message to the active conversation
	 * @param role - The role of the message sender (user/assistant)
	 * @param content - The message content
	 * @param type - The message type, defaults to 'text'
	 * @param parent - Parent message ID, defaults to '-1' for auto-detection
	 * @param extras - Optional extra data (files, attachments, etc.)
	 * @returns The created message or null if failed
	 */
	async addMessage(
		role: ChatRole,
		content: string,
		type: ChatMessageType = 'text',
		parent: string = '-1',
		extras?: DatabaseMessageExtra[]
	): Promise<DatabaseMessage | null> {
		if (!this.activeConversation) {
			console.error('No active conversation when trying to add message');
			return null;
		}

		try {
			let parentId: string | null = null;

			if (parent === '-1') {
				if (this.activeMessages.length > 0) {
					parentId = this.activeMessages[this.activeMessages.length - 1].id;
				} else {
					const allMessages = await DatabaseService.getConversationMessages(
						this.activeConversation.id
					);
					const rootMessage = allMessages.find((m) => m.parent === null && m.type === 'root');

					if (!rootMessage) {
						const rootId = await DatabaseService.createRootMessage(this.activeConversation.id);
						parentId = rootId;
					} else {
						parentId = rootMessage.id;
					}
				}
			} else {
				parentId = parent;
			}

			const message = await DatabaseService.createMessageBranch(
				{
					convId: this.activeConversation.id,
					role,
					content,
					type,
					timestamp: Date.now(),
					thinking: '',
					toolCalls: '',
					children: [],
					extra: extras
				},
				parentId
			);

			this.activeMessages.push(message);

			await DatabaseService.updateCurrentNode(this.activeConversation.id, message.id);
			this.activeConversation.currNode = message.id;

			this.updateConversationTimestamp();

			return message;
		} catch (error) {
			console.error('Failed to add message:', error);
			return null;
		}
	}

	/**
	 * Gets API options from current configuration settings
	 * Converts settings store values to API-compatible format
	 * @returns API options object for chat completion requests
	 */
	private getApiOptions(): Record<string, unknown> {
		const currentConfig = config();
		const hasValue = (value: unknown): boolean =>
			value !== undefined && value !== null && value !== '';

		const apiOptions: Record<string, unknown> = {
			stream: true,
			timings_per_token: true
		};

		if (hasValue(currentConfig.temperature)) {
			apiOptions.temperature = Number(currentConfig.temperature);
		}
		if (hasValue(currentConfig.max_tokens)) {
			apiOptions.max_tokens = Number(currentConfig.max_tokens);
		}
		if (hasValue(currentConfig.max_completion_tokens)) {
			apiOptions.max_completion_tokens = Number(currentConfig.max_completion_tokens);
		}
		if (hasValue(currentConfig.reasoning_effort) && currentConfig.reasoning_effort !== 'none') {
			apiOptions.reasoning_effort = currentConfig.reasoning_effort;
		}
		if (hasValue(currentConfig.dynatemp_range)) {
			apiOptions.dynatemp_range = Number(currentConfig.dynatemp_range);
		}
		if (hasValue(currentConfig.dynatemp_exponent)) {
			apiOptions.dynatemp_exponent = Number(currentConfig.dynatemp_exponent);
		}
		if (hasValue(currentConfig.top_k)) {
			apiOptions.top_k = Number(currentConfig.top_k);
		}
		if (hasValue(currentConfig.top_p)) {
			apiOptions.top_p = Number(currentConfig.top_p);
		}
		if (hasValue(currentConfig.min_p)) {
			apiOptions.min_p = Number(currentConfig.min_p);
		}
		if (hasValue(currentConfig.xtc_probability)) {
			apiOptions.xtc_probability = Number(currentConfig.xtc_probability);
		}
		if (hasValue(currentConfig.xtc_threshold)) {
			apiOptions.xtc_threshold = Number(currentConfig.xtc_threshold);
		}
		if (hasValue(currentConfig.typ_p)) {
			apiOptions.typ_p = Number(currentConfig.typ_p);
		}
		if (hasValue(currentConfig.repeat_last_n)) {
			apiOptions.repeat_last_n = Number(currentConfig.repeat_last_n);
		}
		if (hasValue(currentConfig.repeat_penalty)) {
			apiOptions.repeat_penalty = Number(currentConfig.repeat_penalty);
		}
		if (hasValue(currentConfig.presence_penalty)) {
			apiOptions.presence_penalty = Number(currentConfig.presence_penalty);
		}
		if (hasValue(currentConfig.frequency_penalty)) {
			apiOptions.frequency_penalty = Number(currentConfig.frequency_penalty);
		}
		if (hasValue(currentConfig.dry_multiplier)) {
			apiOptions.dry_multiplier = Number(currentConfig.dry_multiplier);
		}
		if (hasValue(currentConfig.dry_base)) {
			apiOptions.dry_base = Number(currentConfig.dry_base);
		}
		if (hasValue(currentConfig.dry_allowed_length)) {
			apiOptions.dry_allowed_length = Number(currentConfig.dry_allowed_length);
		}
		if (hasValue(currentConfig.dry_penalty_last_n)) {
			apiOptions.dry_penalty_last_n = Number(currentConfig.dry_penalty_last_n);
		}
		if (currentConfig.samplers) {
			apiOptions.samplers = currentConfig.samplers;
		}
		if (currentConfig.custom) {
			apiOptions.custom = currentConfig.custom;
		}

		return apiOptions;
	}

	/**
	 * Helper methods for per-conversation loading state management
	 */
	private setConversationLoading(convId: string, loading: boolean): void {
		if (loading) {
			this.conversationLoadingStates.set(convId, true);
			if (this.activeConversation?.id === convId) {
				this.isLoading = true;
			}
		} else {
			this.conversationLoadingStates.delete(convId);
			if (this.activeConversation?.id === convId) {
				this.isLoading = false;
			}
		}
	}

	private isConversationLoading(convId: string): boolean {
		return this.conversationLoadingStates.get(convId) || false;
	}

	private setConversationStreaming(convId: string, response: string, messageId: string): void {
		this.conversationStreamingStates.set(convId, { response, messageId });
		if (this.activeConversation?.id === convId) {
			this.currentResponse = response;
		}
	}

	private clearConversationStreaming(convId: string): void {
		this.conversationStreamingStates.delete(convId);
		if (this.activeConversation?.id === convId) {
			this.currentResponse = '';
		}
	}

	private getConversationStreaming(
		convId: string
	): { response: string; messageId: string } | undefined {
		return this.conversationStreamingStates.get(convId);
	}

	/**
	 * Handles streaming chat completion with the AI model
	 * @param allMessages - All messages in the conversation
	 * @param assistantMessage - The assistant message to stream content into
	 * @param onComplete - Optional callback when streaming completes
	 * @param onError - Optional callback when an error occurs
	 */
	private async streamChatCompletion(
		allMessages: DatabaseMessage[],
		assistantMessage: DatabaseMessage,
		onComplete?: (content: string) => Promise<void>,
		onError?: (error: Error) => void
	): Promise<void> {
		let streamedContent = '';
		let streamedReasoningContent = '';
		let streamedToolCallContent = '';

		let resolvedModel: string | null = null;
		let modelPersisted = false;
		const currentConfig = config();
		const preferServerPropsModel = !currentConfig.modelSelectorEnabled;
		let serverPropsRefreshed = false;
		let updateModelFromServerProps: ((persistImmediately?: boolean) => void) | null = null;

		const refreshServerPropsOnce = () => {
			if (serverPropsRefreshed) {
				return;
			}

			serverPropsRefreshed = true;

			const hasExistingProps = serverStore.serverProps !== null;

			serverStore
				.fetchServerProps({ silent: hasExistingProps })
				.then(() => {
					updateModelFromServerProps?.(true);
				})
				.catch((error) => {
					console.warn('Failed to refresh server props after streaming started:', error);
				});
		};

		const recordModel = (modelName: string | null | undefined, persistImmediately = true): void => {
			const serverModelName = serverStore.modelName;
			const preferredModelSource = preferServerPropsModel
				? (serverModelName ?? modelName ?? null)
				: (modelName ?? serverModelName ?? null);

			if (!preferredModelSource) {
				return;
			}

			const normalizedModel = normalizeModelName(preferredModelSource);

			if (!normalizedModel || normalizedModel === resolvedModel) {
				return;
			}

			resolvedModel = normalizedModel;

			const messageIndex = this.findMessageIndex(assistantMessage.id);

			this.updateMessageAtIndex(messageIndex, { model: normalizedModel });

			if (persistImmediately && !modelPersisted) {
				modelPersisted = true;
				DatabaseService.updateMessage(assistantMessage.id, { model: normalizedModel }).catch(
					(error) => {
						console.error('Failed to persist model name:', error);
						modelPersisted = false;
						resolvedModel = null;
					}
				);
			}
		};

		if (preferServerPropsModel) {
			updateModelFromServerProps = (persistImmediately = true) => {
				const currentServerModel = serverStore.modelName;

				if (!currentServerModel) {
					return;
				}

				recordModel(currentServerModel, persistImmediately);
			};

			updateModelFromServerProps(false);
		}

		slotsService.startStreaming();
		slotsService.setActiveConversation(assistantMessage.convId);

		// Ensure MCP servers are connected and get tool definitions
		const hasServers = mcpStore.hasAvailableServers();
		console.log('[MCP] hasAvailableServers:', hasServers, 'connections:', mcpStore.connectedServerCount, 'isInitialized:', mcpStore.isInitialized);
		if (hasServers) {
			const initResult = await mcpStore.ensureInitialized();
			console.log('[MCP] ensureInitialized result:', initResult, 'connections after:', mcpStore.connectedServerCount);
		}
		const mcpTools = mcpStore.getToolDefinitionsForLLM();
		const builtinTools = getBuiltinToolDefinitions();
		const allTools = [...builtinTools, ...mcpTools];
		console.log('[Tools] Built-in:', builtinTools.length, 'MCP:', mcpTools.length, 'Total:', allTools.length);
		const mcpToolsOptions: Record<string, unknown> = {};
		if (allTools.length > 0) {
			mcpToolsOptions.tools = allTools;
			mcpToolsOptions.tool_choice = 'auto';
			console.log('[Tools] Injecting tools into request:', allTools.map(t => t.function.name));
		}

		await chatService.sendMessage(
			allMessages,
			{
				...this.getApiOptions(),
				...mcpToolsOptions,

				onFirstValidChunk: () => {
					refreshServerPropsOnce();
				},
				onChunk: (chunk: string) => {
					streamedContent += chunk;
					this.setConversationStreaming(
						assistantMessage.convId,
						streamedContent,
						assistantMessage.id
					);

					const messageIndex = this.findMessageIndex(assistantMessage.id);
					this.updateMessageAtIndex(messageIndex, {
						content: streamedContent
					});
				},

				onReasoningChunk: (reasoningChunk: string) => {
					streamedReasoningContent += reasoningChunk;

					const messageIndex = this.findMessageIndex(assistantMessage.id);

					this.updateMessageAtIndex(messageIndex, { thinking: streamedReasoningContent });
				},

				onToolCallChunk: (toolCallChunk: string) => {
					const chunk = toolCallChunk.trim();

					if (!chunk) {
						return;
					}

					streamedToolCallContent = chunk;

					const messageIndex = this.findMessageIndex(assistantMessage.id);

					this.updateMessageAtIndex(messageIndex, { toolCalls: streamedToolCallContent });
				},

				onModel: (modelName: string) => {
					recordModel(modelName);
				},

				onComplete: async (
					finalContent?: string,
					reasoningContent?: string,
					timings?: ChatMessageTimings,
					toolCallContent?: string
				) => {
					slotsService.stopStreaming();

					const updateData: {
						content: string;
						thinking: string;
						toolCalls: string;
						timings?: ChatMessageTimings;
						model?: string;
					} = {
						content: finalContent || streamedContent,
						thinking: reasoningContent || streamedReasoningContent,
						toolCalls: toolCallContent || streamedToolCallContent,
						timings: timings
					};

					if (resolvedModel && !modelPersisted) {
						updateData.model = resolvedModel;
						modelPersisted = true;
					}

					await DatabaseService.updateMessage(assistantMessage.id, updateData);

					const messageIndex = this.findMessageIndex(assistantMessage.id);

					const localUpdateData: {
						timings?: ChatMessageTimings;
						model?: string;
						toolCalls?: string;
					} = {
						timings: timings
					};

					if (updateData.model) {
						localUpdateData.model = updateData.model;
					}

					if (updateData.toolCalls !== undefined) {
						localUpdateData.toolCalls = updateData.toolCalls;
					}

					this.updateMessageAtIndex(messageIndex, localUpdateData);

					// === Agentic Tool Execution Loop ===
					const currentSettings = config();
					const MAX_TOOL_ITERATIONS = Number(currentSettings.maxToolIterations) || 10;
					let currentToolCalls = toolCallContent || streamedToolCallContent;
					let currentContent = updateData.content;
					let accumulatedThinking = updateData.thinking || '';
					let allToolCallsJson = currentToolCalls || '';
					// Build agentic-tagged content for multi-bubble display
					let accumulatedAgenticContent = '';
					let conversationHistory = [
						...allMessages.map((m: any) => ({ role: m.role, content: m.content }))
					];
					let iteration = 0;

					// Helper to format tool call using agentic tags
					const formatAgenticToolCall = (name: string, args: string, result: string) => {
						return `<<<AGENTIC_TOOL_CALL_START>>>\n<<<TOOL_NAME:${name}>>>\n<<<TOOL_ARGS_START>>>${args}<<<TOOL_ARGS_END>>>\n${result}\n<<<AGENTIC_TOOL_CALL_END>>>`;
					};

					const formatAgenticReasoning = (content: string) => {
						return `<<<reasoning_content_start>>>${content}<<<reasoning_content_end>>>`;
					};

					// Truncate tool result for conversation history to save LLM context
					const truncateForHistory = (text: string, max = 4000) => {
						if (text.length <= max) return text;
						return text.substring(0, max) + '\n... [truncated, ' + text.length + ' chars total]';
					};

					while (currentToolCalls && allTools.length > 0 && iteration < MAX_TOOL_ITERATIONS) {
						iteration++;
						console.log(`[Tools] Iteration ${iteration}/${MAX_TOOL_ITERATIONS}`);

						// On first iteration, seed with initial reasoning so it's not lost
						if (iteration === 1 && accumulatedThinking.trim()) {
							accumulatedAgenticContent = formatAgenticReasoning(accumulatedThinking.trim());
						}

						try {
							const parsedToolCalls = JSON.parse(currentToolCalls);
							if (!Array.isArray(parsedToolCalls) || parsedToolCalls.length === 0) break;

							console.log('[Tools] Executing:', parsedToolCalls.map((tc: any) => tc.function?.name));

							// Add the LLM's text content from this iteration to agentic content
							if (currentContent && currentContent.trim()) {
								accumulatedAgenticContent += (accumulatedAgenticContent ? '\n\n' : '') + currentContent.trim();
							}

							// Execute each tool call
							const toolResults: Array<{ tool_call_id: string; role: string; content: string }> = [];
							for (const tc of parsedToolCalls) {
								try {
									let resultText = 'No result';
									if (isBuiltinTool(tc.function.name)) {
										resultText = executeBuiltinTool({
											id: tc.id,
											type: 'function',
											function: { name: tc.function.name, arguments: tc.function.arguments }
										});
										console.log('[Builtin] Tool result for', tc.function.name, ':', resultText.substring(0, 200));
									} else {
										const result = await mcpStore.executeTool({
											id: tc.id,
											type: 'function',
											function: {
												name: tc.function.name,
												arguments: tc.function.arguments
											}
										});
										console.log('[MCP] Raw tool result:', JSON.stringify(result).substring(0, 500));
										if (Array.isArray(result.content)) {
											resultText = result.content
												.map((c: any) => c.type === 'text' ? c.text : JSON.stringify(c))
												.join('\n');
										} else if (typeof result.content === 'string') {
											resultText = result.content;
										} else if (result.content) {
											resultText = JSON.stringify(result.content);
										} else if (typeof result === 'string') {
											resultText = result;
										} else {
											resultText = JSON.stringify(result);
										}
									}
									toolResults.push({
										tool_call_id: tc.id,
										role: 'tool',
										content: resultText
									});
									console.log('[Tools] Tool result for', tc.function.name, ':', resultText.substring(0, 200));

									// Add to agentic content as tagged tool call block
									const toolResultPreview = resultText.length > 2000
										? resultText.substring(0, 2000) + '\n... [truncated]'
										: resultText;
									accumulatedAgenticContent += '\n' + formatAgenticToolCall(
										tc.function.name,
										tc.function.arguments || '{}',
										toolResultPreview
									);
								} catch (toolError) {
									console.error('[Tools] Tool execution error:', toolError);
									const errorMsg = `Error: ${toolError instanceof Error ? toolError.message : String(toolError)}`;
									toolResults.push({
										tool_call_id: tc.id,
										role: 'tool',
										content: errorMsg
									});
									accumulatedAgenticContent += '\n' + formatAgenticToolCall(
										tc.function.name,
										tc.function.arguments || '{}',
										errorMsg
									);
								}
							}

							// Keep thinking for backward compat (used by ThinkingBlock)
							const toolCallSummary = parsedToolCalls.map((tc: any) => {
								let args = tc.function.arguments;
								try { args = JSON.stringify(JSON.parse(args), null, 2); } catch { /* keep as-is */ }
								return `🔧 **${tc.function.name}**\n\`\`\`json\n${args}\n\`\`\``;
							}).join('\n');
							const toolResultSummary = toolResults.map(tr => {
								const preview = tr.content.length > 300 ? tr.content.substring(0, 300) + '...' : tr.content;
								const isError = tr.content.startsWith('Error:');
								return isError ? `❌ ${preview}` : `✅ Result received (${tr.content.length} chars)`;
							}).join('\n');
							accumulatedThinking += (accumulatedThinking ? '\n\n---\n\n' : '') +
								toolCallSummary + '\n\n' + toolResultSummary;

							// Append assistant + tool results to conversation history
							// Truncate large tool results to save LLM context
							const truncatedToolResults = toolResults.map(tr => ({
								...tr,
								content: truncateForHistory(tr.content)
							}));
							conversationHistory.push({
								role: 'assistant' as const,
								content: currentContent || null,
								tool_calls: parsedToolCalls
							} as any);
							conversationHistory.push(...truncatedToolResults as any);

							// Update UI — show agentic content with progress indicator
							const messageIndex2 = this.findMessageIndex(assistantMessage.id);
							this.updateMessageAtIndex(messageIndex2, {
								content: accumulatedAgenticContent + `\n\n*Executing step ${iteration}...*`,
								thinking: accumulatedThinking
							});

							// Stream follow-up
							streamedContent = '';
							streamedReasoningContent = '';
							streamedToolCallContent = '';

							let followUpToolCalls = '';
							let followUpError = false;

							slotsService.startStreaming();
							await chatService.sendMessage(
								conversationHistory as any,
								{
									...this.getApiOptions(),
									...mcpToolsOptions,
									onChunk: (chunk: string) => {
										streamedContent += chunk;
										this.setConversationStreaming(assistantMessage.convId, streamedContent, assistantMessage.id);
										const idx = this.findMessageIndex(assistantMessage.id);
										// Show accumulated agentic content + streaming new content
										this.updateMessageAtIndex(idx, {
											content: accumulatedAgenticContent + '\n\n' + streamedContent
										});
									},
									onReasoningChunk: (rc: string) => {
										streamedReasoningContent += rc;
										const idx = this.findMessageIndex(assistantMessage.id);
										// Add streaming reasoning as a pending reasoning block
										this.updateMessageAtIndex(idx, {
											content: accumulatedAgenticContent + '\n\n' + '<<<reasoning_content_start>>>' + streamedReasoningContent,
											thinking: accumulatedThinking + '\n\n---\n\n' + streamedReasoningContent
										});
									},
									onToolCallChunk: (chunk: string) => {
										streamedToolCallContent = chunk;
									},
									onComplete: async (fc?: string, rc?: string, _timings?: ChatMessageTimings, tc?: string) => {
										slotsService.stopStreaming();
										followUpToolCalls = tc || streamedToolCallContent;

										// Add completed reasoning to agentic content
										const iterationThinking = rc || streamedReasoningContent;
										if (iterationThinking && iterationThinking.trim()) {
											accumulatedThinking += (accumulatedThinking ? '\n\n---\n\n' : '') + iterationThinking;
											accumulatedAgenticContent += '\n\n' + formatAgenticReasoning(iterationThinking);
										}

										currentContent = fc || streamedContent;

										// Save current state with agentic content
										const displayContent = followUpToolCalls
											? accumulatedAgenticContent  // more tool calls coming, don't add final text yet
											: accumulatedAgenticContent + (currentContent?.trim() ? '\n\n' + currentContent.trim() : '');
										const finalData = {
											content: displayContent,
											thinking: accumulatedThinking,
											toolCalls: followUpToolCalls || allToolCallsJson
										};
										await DatabaseService.updateMessage(assistantMessage.id, finalData);
										const idx = this.findMessageIndex(assistantMessage.id);
										this.updateMessageAtIndex(idx, finalData);
									},
									onError: async (err: Error) => {
										console.error('[Tools] Follow-up request error:', err);
										slotsService.stopStreaming();
										followUpError = true;
										const fallbackContent = toolResults.map(tr =>
											`**Tool result:**\n${tr.content}`
										).join('\n\n');
										const finalData = {
											content: accumulatedAgenticContent + '\n\n' + (fallbackContent || `Error: ${err.message}`),
											thinking: accumulatedThinking,
											toolCalls: allToolCallsJson
										};
										await DatabaseService.updateMessage(assistantMessage.id, finalData);
										const idx = this.findMessageIndex(assistantMessage.id);
										this.updateMessageAtIndex(idx, finalData);
									}
								},
								assistantMessage.convId
							);

							if (followUpError) break;

							// Track all tool calls across iterations
							if (followUpToolCalls) {
								allToolCallsJson = followUpToolCalls;
							}

							// Check if the AI wants to call more tools
							currentToolCalls = followUpToolCalls;
							if (!currentToolCalls) break;

							console.log(`[Tools] AI requested more tool calls, continuing loop...`);
						} catch (parseError) {
							console.warn('[Tools] Could not parse tool calls:', parseError);
							break;
						}
					}

					if (iteration >= MAX_TOOL_ITERATIONS) {
						console.warn('[Tools] Max iterations reached, stopping tool loop');
					}
					// === End Agentic Tool Execution Loop ===

					await DatabaseService.updateCurrentNode(assistantMessage.convId, assistantMessage.id);

					if (this.activeConversation?.id === assistantMessage.convId) {
						this.activeConversation.currNode = assistantMessage.id;
						await this.refreshActiveMessages();
					}

					if (onComplete) {
						await onComplete(streamedContent);
					}

					this.setConversationLoading(assistantMessage.convId, false);
					this.clearConversationStreaming(assistantMessage.convId);
					slotsService.clearConversationState(assistantMessage.convId);
				},

				onError: (error: Error) => {
					slotsService.stopStreaming();

					if (this.isAbortError(error)) {
						this.setConversationLoading(assistantMessage.convId, false);
						this.clearConversationStreaming(assistantMessage.convId);
						slotsService.clearConversationState(assistantMessage.convId);
						return;
					}

					console.error('Streaming error:', error);
					this.setConversationLoading(assistantMessage.convId, false);
					this.clearConversationStreaming(assistantMessage.convId);
					slotsService.clearConversationState(assistantMessage.convId);

					const messageIndex = this.activeMessages.findIndex(
						(m: DatabaseMessage) => m.id === assistantMessage.id
					);

					if (messageIndex !== -1) {
						const [failedMessage] = this.activeMessages.splice(messageIndex, 1);

						if (failedMessage) {
							DatabaseService.deleteMessage(failedMessage.id).catch((cleanupError) => {
								console.error('Failed to remove assistant message after error:', cleanupError);
							});
						}
					}

					const dialogType = error.name === 'TimeoutError' ? 'timeout' : 'server';

					this.showErrorDialog(dialogType, error.message);

					if (onError) {
						onError(error);
					}
				}
			},
			assistantMessage.convId
		);
	}

	/**
	 * Checks if an error is an abort error (user cancelled operation)
	 * @param error - The error to check
	 * @returns True if the error is an abort error
	 */
	private isAbortError(error: unknown): boolean {
		return error instanceof Error && (error.name === 'AbortError' || error instanceof DOMException);
	}

	private showErrorDialog(type: 'timeout' | 'server', message: string): void {
		this.errorDialogState = { type, message };
	}

	dismissErrorDialog(): void {
		this.errorDialogState = null;
	}

	/**
	 * Finds the index of a message in the active messages array
	 * Delegates to conversationsStore
	 * @param messageId - The message ID to find
	 * @returns The index of the message, or -1 if not found
	 */
	private findMessageIndex(messageId: string): number {
		return conversationsStore.findMessageIndex(messageId);
	}

	/**
	 * Updates a message at a specific index with partial data
	 * Delegates to conversationsStore
	 * @param index - The index of the message to update
	 * @param updates - Partial message data to update
	 */
	private updateMessageAtIndex(index: number, updates: Partial<DatabaseMessage>): void {
		conversationsStore.updateMessageAtIndex(index, updates);
	}

	/**
	 * Creates a new assistant message in the database
	 * @param parentId - Optional parent message ID, defaults to '-1'
	 * @returns The created assistant message or null if failed
	 */
	private async createAssistantMessage(parentId?: string): Promise<DatabaseMessage | null> {
		if (!this.activeConversation) return null;

		return await DatabaseService.createMessageBranch(
			{
				convId: this.activeConversation.id,
				type: 'text',
				role: 'assistant',
				content: '',
				timestamp: Date.now(),
				thinking: '',
				toolCalls: '',
				children: [],
				model: null
			},
			parentId || null
		);
	}

	/**
	 * Updates conversation lastModified timestamp and moves it to top of list
	 * Ensures recently active conversations appear first in the sidebar
	 */
	private updateConversationTimestamp(): void {
		// Delegate to conversationsStore
		conversationsStore.updateConversationTimestamp();
	}

	/**
	 * Sends a new message and generates AI response
	 * @param content - The message content to send
	 * @param extras - Optional extra data (files, attachments, etc.)
	 */
	async sendMessage(content: string, extras?: DatabaseMessageExtra[]): Promise<void> {
		if (!content.trim() && (!extras || extras.length === 0)) return;

		if (this.activeConversation && this.isConversationLoading(this.activeConversation.id)) {
			console.log('Cannot send message: current conversation is already processing a message');
			return;
		}

		let isNewConversation = false;

		if (!this.activeConversation) {
			await this.createConversation();
			isNewConversation = true;
		}

		if (!this.activeConversation) {
			console.error('No active conversation available for sending message');
			return;
		}

		this.errorDialogState = null;

		this.setConversationLoading(this.activeConversation.id, true);
		this.clearConversationStreaming(this.activeConversation.id);

		let userMessage: DatabaseMessage | null = null;

		try {
			userMessage = await this.addMessage('user', content, 'text', '-1', extras);

			if (!userMessage) {
				throw new Error('Failed to add user message');
			}

			if (isNewConversation && content) {
				const title = content.trim();
				await this.updateConversationName(this.activeConversation.id, title);
			}

			const assistantMessage = await this.createAssistantMessage(userMessage.id);

			if (!assistantMessage) {
				throw new Error('Failed to create assistant message');
			}

			this.activeMessages.push(assistantMessage);

			const conversationContext = this.activeMessages.slice(0, -1);

			// Check if image generation mode is enabled
			const currentConfig = this.getApiOptions();
			const imageMode = settingsStore.getConfig('imageGenerationMode');

			if (imageMode) {
				// Generate image instead of text
				try {
					const startTime = Date.now();
					const base64Image = await chatService.generateImage(content);
					const endTime = Date.now();

					// Calculate timing for image generation
					const generationTimeMs = endTime - startTime;
					const timings: ChatMessageTimings = {
						predicted_ms: generationTimeMs,
						predicted_n: 1 // Representing 1 image generated
					};

					// Get current model name
					const { modelsStore } = await import('$lib/stores/models.svelte');
					const currentModelName = modelsStore.selectedModelName;
					const normalizedModel = currentModelName ? normalizeModelName(currentModelName) : null;

					// Check if it's a URL or base64 data
					const isUrl = base64Image.startsWith('http://') || base64Image.startsWith('https://');
					const base64Url = isUrl ? base64Image : `data:image/png;base64,${base64Image}`;

					// Create image attachment as extra
					const imageExtra: DatabaseMessageExtra = {
						type: 'imageFile',
						name: 'generated-image.png',
						base64Url: base64Url
					};

					// Update assistant message with empty content and image attachment
					const messageIndex = this.findMessageIndex(assistantMessage.id);
					this.updateMessageAtIndex(messageIndex, {
						content: '',
						type: 'text',
						extra: [imageExtra],
						timings: timings,
						model: normalizedModel ?? undefined
					});

					// Persist to database
					await DatabaseService.updateMessage(assistantMessage.id, {
						content: '',
						type: 'text',
						extra: [imageExtra],
						timings: timings,
						model: normalizedModel ?? undefined
					});

					this.setConversationLoading(this.activeConversation.id, false);
				} catch (error) {
					console.error('Image generation failed:', error);
					throw error;
				}
			} else {
				// Regular text chat completion
				await this.streamChatCompletion(conversationContext, assistantMessage);
			}
		} catch (error) {
			if (this.isAbortError(error)) {
				this.setConversationLoading(this.activeConversation!.id, false);
				return;
			}

			console.error('Failed to send message:', error);
			this.setConversationLoading(this.activeConversation!.id, false);
			if (!this.errorDialogState) {
				if (error instanceof Error) {
					const dialogType = error.name === 'TimeoutError' ? 'timeout' : 'server';
					this.showErrorDialog(dialogType, error.message);
				} else {
					this.showErrorDialog('server', 'Unknown error occurred while sending message');
				}
			}
		}
	}

	/**
	 * Stops the current message generation
	 * Aborts ongoing requests and saves partial response if available
	 */
	async stopGeneration(): Promise<void> {
		if (!this.activeConversation) return;

		const convId = this.activeConversation.id;

		await this.savePartialResponseIfNeeded(convId);

		slotsService.stopStreaming();
		chatService.abort(convId);

		this.setConversationLoading(convId, false);
		this.clearConversationStreaming(convId);
		slotsService.clearConversationState(convId);
	}

	/**
	 * Gracefully stops generation and saves partial response
	 */
	async gracefulStop(): Promise<void> {
		if (!this.isLoading) return;

		slotsService.stopStreaming();
		chatService.abort();
		await this.savePartialResponseIfNeeded();

		this.conversationLoadingStates.clear();
		this.conversationStreamingStates.clear();
		this.isLoading = false;
		this.currentResponse = '';
	}

	/**
	 * Saves partial response if generation was interrupted
	 * Preserves user's partial content and timing data when generation is stopped early
	 */
	private async savePartialResponseIfNeeded(convId?: string): Promise<void> {
		const conversationId = convId || this.activeConversation?.id;
		if (!conversationId) return;

		const streamingState = this.conversationStreamingStates.get(conversationId);
		if (!streamingState || !streamingState.response.trim()) {
			return;
		}

		const messages =
			conversationId === this.activeConversation?.id
				? this.activeMessages
				: await DatabaseService.getConversationMessages(conversationId);

		if (!messages.length) return;

		const lastMessage = messages[messages.length - 1];

		if (lastMessage && lastMessage.role === 'assistant') {
			try {
				const updateData: {
					content: string;
					thinking?: string;
					timings?: ChatMessageTimings;
				} = {
					content: streamingState.response
				};

				if (lastMessage.thinking?.trim()) {
					updateData.thinking = lastMessage.thinking;
				}

				const lastKnownState = await slotsService.getCurrentState();

				if (lastKnownState) {
					updateData.timings = {
						prompt_n: lastKnownState.promptTokens || 0,
						predicted_n: lastKnownState.tokensDecoded || 0,
						cache_n: lastKnownState.cacheTokens || 0,
						predicted_ms:
							lastKnownState.tokensPerSecond && lastKnownState.tokensDecoded
								? (lastKnownState.tokensDecoded / lastKnownState.tokensPerSecond) * 1000
								: undefined
					};
				}

				await DatabaseService.updateMessage(lastMessage.id, updateData);

				lastMessage.content = this.currentResponse;
				if (updateData.thinking !== undefined) {
					lastMessage.thinking = updateData.thinking;
				}
				if (updateData.timings) {
					lastMessage.timings = updateData.timings;
				}
			} catch (error) {
				lastMessage.content = this.currentResponse;
				console.error('Failed to save partial response:', error);
			}
		} else {
			console.error('Last message is not an assistant message');
		}
	}

	/**
	 * Updates a user message and regenerates the assistant response
	 * @param messageId - The ID of the message to update
	 * @param newContent - The new content for the message
	 */
	async updateMessage(messageId: string, newContent: string): Promise<void> {
		if (!this.activeConversation) return;

		if (this.isLoading) {
			this.stopGeneration();
		}

		try {
			const messageIndex = this.findMessageIndex(messageId);
			if (messageIndex === -1) {
				console.error('Message not found for update');
				return;
			}

			const messageToUpdate = this.activeMessages[messageIndex];
			const originalContent = messageToUpdate.content;

			if (messageToUpdate.role !== 'user') {
				console.error('Only user messages can be edited');
				return;
			}

			const allMessages = await DatabaseService.getConversationMessages(this.activeConversation.id);
			const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);
			const isFirstUserMessage =
				rootMessage && messageToUpdate.parent === rootMessage.id && messageToUpdate.role === 'user';

			this.updateMessageAtIndex(messageIndex, { content: newContent });
			await DatabaseService.updateMessage(messageId, { content: newContent });

			if (isFirstUserMessage && newContent.trim()) {
				await this.updateConversationTitleWithConfirmation(
					this.activeConversation.id,
					newContent.trim(),
					this.titleUpdateConfirmationCallback
				);
			}

			const messagesToRemove = this.activeMessages.slice(messageIndex + 1);
			for (const message of messagesToRemove) {
				await DatabaseService.deleteMessage(message.id);
			}

			this.activeMessages = this.activeMessages.slice(0, messageIndex + 1);
			this.updateConversationTimestamp();

			this.setConversationLoading(this.activeConversation.id, true);
			this.clearConversationStreaming(this.activeConversation.id);

			try {
				const assistantMessage = await this.createAssistantMessage();
				if (!assistantMessage) {
					throw new Error('Failed to create assistant message');
				}

				this.activeMessages.push(assistantMessage);
				await DatabaseService.updateCurrentNode(this.activeConversation.id, assistantMessage.id);
				this.activeConversation.currNode = assistantMessage.id;

				await this.streamChatCompletion(
					this.activeMessages.slice(0, -1),
					assistantMessage,
					undefined,
					() => {
						const editedMessageIndex = this.findMessageIndex(messageId);
						this.updateMessageAtIndex(editedMessageIndex, { content: originalContent });
					}
				);
			} catch (regenerateError) {
				console.error('Failed to regenerate response:', regenerateError);
				this.setConversationLoading(this.activeConversation!.id, false);

				const messageIndex = this.findMessageIndex(messageId);
				this.updateMessageAtIndex(messageIndex, { content: originalContent });
			}
		} catch (error) {
			if (this.isAbortError(error)) {
				return;
			}

			console.error('Failed to update message:', error);
		}
	}

	/**
	 * Regenerates an assistant message with a new response
	 * @param messageId - The ID of the assistant message to regenerate
	 */
	async regenerateMessage(messageId: string): Promise<void> {
		if (!this.activeConversation || this.isLoading) return;

		try {
			const messageIndex = this.findMessageIndex(messageId);
			if (messageIndex === -1) {
				console.error('Message not found for regeneration');
				return;
			}

			const messageToRegenerate = this.activeMessages[messageIndex];
			if (messageToRegenerate.role !== 'assistant') {
				console.error('Only assistant messages can be regenerated');
				return;
			}

			// Check if the message being regenerated was an image generation
			// (check BEFORE we delete it)
			const wasImageGeneration =
				messageToRegenerate.extra &&
				messageToRegenerate.extra.some((extra: DatabaseMessageExtra) => extra.type === 'imageFile');

			const messagesToRemove = this.activeMessages.slice(messageIndex);
			for (const message of messagesToRemove) {
				await DatabaseService.deleteMessage(message.id);
			}

			this.activeMessages = this.activeMessages.slice(0, messageIndex);
			this.updateConversationTimestamp();

			this.setConversationLoading(this.activeConversation.id, true);
			this.clearConversationStreaming(this.activeConversation.id);

			try {
				const parentMessageId =
					this.activeMessages.length > 0
						? this.activeMessages[this.activeMessages.length - 1].id
						: null;

				const assistantMessage = await this.createAssistantMessage(parentMessageId);

				if (!assistantMessage) {
					throw new Error('Failed to create assistant message');
				}

				this.activeMessages.push(assistantMessage);

				const conversationContext = this.activeMessages.slice(0, -1);

				if (wasImageGeneration) {
					// Get the user message prompt (last user message)
					const userMessage = [...conversationContext].reverse().find((msg) => msg.role === 'user');
					const prompt = userMessage?.content || '';

					if (!prompt) {
						throw new Error('No prompt found for image generation');
					}

					// Generate image instead of text
					try {
						const startTime = Date.now();
						const base64Image = await chatService.generateImage(prompt);
						const endTime = Date.now();

						// Calculate timing for image generation
						const generationTimeMs = endTime - startTime;
						const timings: ChatMessageTimings = {
							predicted_ms: generationTimeMs,
							predicted_n: 1 // Representing 1 image generated
						};

						// Get current model name
						const { modelsStore } = await import('$lib/stores/models.svelte');
						const currentModelName = modelsStore.selectedModelName;
						const normalizedModel = currentModelName ? normalizeModelName(currentModelName) : null;

						// Check if it's a URL or base64 data
						const isUrl = base64Image.startsWith('http://') || base64Image.startsWith('https://');
						const base64Url = isUrl ? base64Image : `data:image/png;base64,${base64Image}`;

						// Create image attachment as extra
						const imageExtra: DatabaseMessageExtra = {
							type: 'imageFile',
							name: 'generated-image.png',
							base64Url: base64Url
						};

						// Update assistant message with empty content and image attachment
						const messageIndex = this.findMessageIndex(assistantMessage.id);
						this.updateMessageAtIndex(messageIndex, {
							content: '',
							type: 'text',
							extra: [imageExtra],
							timings: timings,
							model: normalizedModel ?? undefined
						});

						// Persist to database
						await DatabaseService.updateMessage(assistantMessage.id, {
							content: '',
							type: 'text',
							extra: [imageExtra],
							timings: timings,
							model: normalizedModel ?? undefined
						});

						this.setConversationLoading(this.activeConversation.id, false);
					} catch (error) {
						console.error('Image generation failed:', error);
						throw error;
					}
				} else {
					// Regular text chat completion
					await this.streamChatCompletion(conversationContext, assistantMessage);
				}
			} catch (regenerateError) {
				console.error('Failed to regenerate response:', regenerateError);
				this.setConversationLoading(this.activeConversation!.id, false);
			}
		} catch (error) {
			if (this.isAbortError(error)) return;
			console.error('Failed to regenerate message:', error);
		}
	}

	/**
	 * Updates the name of a conversation
	 * @param convId - The conversation ID to update
	 * @param name - The new name for the conversation
	 */
	async updateConversationName(convId: string, name: string): Promise<void> {
		// Delegate to conversationsStore
		await conversationsStore.updateConversationName(convId, name);
	}

	/**
	 * Sets the callback function for title update confirmations
	 * @param callback - Function to call when confirmation is needed
	 */
	setTitleUpdateConfirmationCallback(
		callback: (currentTitle: string, newTitle: string) => Promise<boolean>
	): void {
		this.titleUpdateConfirmationCallback = callback;
		// Also register with conversationsStore
		conversationsStore.setTitleUpdateConfirmationCallback(callback);
	}

	/**
	 * Updates conversation title with optional confirmation dialog based on settings
	 * @param convId - The conversation ID to update
	 * @param newTitle - The new title content
	 * @param onConfirmationNeeded - Callback when user confirmation is needed (deprecated)
	 * @returns Promise<boolean> - True if title was updated, false if cancelled
	 */
	async updateConversationTitleWithConfirmation(
		convId: string,
		newTitle: string,
		onConfirmationNeeded?: (currentTitle: string, newTitle: string) => Promise<boolean>
	): Promise<boolean> {
		// If a callback is provided, use it; otherwise use the registered one
		const callback = onConfirmationNeeded || this.titleUpdateConfirmationCallback;
		if (callback) {
			conversationsStore.setTitleUpdateConfirmationCallback(callback);
		}

		// Delegate to conversationsStore
		return await conversationsStore.updateConversationTitleWithConfirmation(convId, newTitle);
	}

	/**
	 * Downloads a conversation as JSON file
	 * Delegates to conversationsStore
	 * @param convId - The conversation ID to download
	 */
	async downloadConversation(convId: string): Promise<void> {
		await conversationsStore.downloadConversation(convId);
	}

	/**
	 * Exports all conversations with their messages as a JSON file
	 * Delegates to conversationsStore
	 * Returns the list of exported conversations
	 */
	async exportAllConversations(): Promise<DatabaseConversation[]> {
		return await conversationsStore.exportAllConversations();
	}

	/**
	 * Imports conversations from a JSON file.
	 * Delegates to conversationsStore
	 * Returns the list of imported conversations
	 */
	async importConversations(): Promise<DatabaseConversation[]> {
		return await conversationsStore.importConversations();
	}

	/**
	 * Deletes a conversation and all its messages
	 * Delegates to conversationsStore
	 * @param convId - The conversation ID to delete
	 */
	async deleteConversation(convId: string): Promise<void> {
		await conversationsStore.deleteConversation(convId);
	}

	/**
	 * Deletes multiple conversations and all their messages
	 * @param convIds - Array of conversation IDs to delete
	 */
	async deleteMultipleConversations(convIds: string[]): Promise<void> {
		for (const convId of convIds) {
			await conversationsStore.deleteConversation(convId);
		}
	}

	/**
	 * Gets information about what messages will be deleted when deleting a specific message
	 * @param messageId - The ID of the message to be deleted
	 * @returns Object with deletion info including count and types of messages
	 */
	async getDeletionInfo(messageId: string): Promise<{
		totalCount: number;
		userMessages: number;
		assistantMessages: number;
		messageTypes: string[];
	}> {
		if (!this.activeConversation) {
			return { totalCount: 0, userMessages: 0, assistantMessages: 0, messageTypes: [] };
		}

		const allMessages = await DatabaseService.getConversationMessages(this.activeConversation.id);
		const descendants = findDescendantMessages(allMessages, messageId);
		const allToDelete = [messageId, ...descendants];

		const messagesToDelete = allMessages.filter((m) => allToDelete.includes(m.id));

		let userMessages = 0;
		let assistantMessages = 0;
		const messageTypes: string[] = [];

		for (const msg of messagesToDelete) {
			if (msg.role === 'user') {
				userMessages++;
				if (!messageTypes.includes('user message')) messageTypes.push('user message');
			} else if (msg.role === 'assistant') {
				assistantMessages++;
				if (!messageTypes.includes('assistant response')) messageTypes.push('assistant response');
			}
		}

		return {
			totalCount: allToDelete.length,
			userMessages,
			assistantMessages,
			messageTypes
		};
	}

	/**
	 * Deletes a message and all its descendants, updating conversation path if needed
	 * @param messageId - The ID of the message to delete
	 */
	async deleteMessage(messageId: string): Promise<void> {
		try {
			if (!this.activeConversation) return;

			// Get all messages to find siblings before deletion
			const allMessages = await DatabaseService.getConversationMessages(this.activeConversation.id);
			const messageToDelete = allMessages.find((m) => m.id === messageId);

			if (!messageToDelete) {
				console.error('Message to delete not found');
				return;
			}

			// Check if the deleted message is in the current conversation path
			const currentPath = filterByLeafNodeId(
				allMessages,
				this.activeConversation.currNode || '',
				false
			);
			const isInCurrentPath = currentPath.some((m) => m.id === messageId);

			// If the deleted message is in the current path, we need to update currNode
			if (isInCurrentPath && messageToDelete.parent) {
				// Find all siblings (messages with same parent)
				const siblings = allMessages.filter(
					(m) => m.parent === messageToDelete.parent && m.id !== messageId
				);

				if (siblings.length > 0) {
					// Find the latest sibling (highest timestamp)
					const latestSibling = siblings.reduce((latest, sibling) =>
						sibling.timestamp > latest.timestamp ? sibling : latest
					);

					// Find the leaf node for this sibling branch to get the complete conversation path
					const leafNodeId = findLeafNode(allMessages, latestSibling.id);

					// Update conversation to use the leaf node of the latest remaining sibling
					await DatabaseService.updateCurrentNode(this.activeConversation.id, leafNodeId);
					this.activeConversation.currNode = leafNodeId;
				} else {
					// No siblings left, navigate to parent if it exists
					if (messageToDelete.parent) {
						const parentLeafId = findLeafNode(allMessages, messageToDelete.parent);
						await DatabaseService.updateCurrentNode(this.activeConversation.id, parentLeafId);
						this.activeConversation.currNode = parentLeafId;
					}
				}
			}

			// Use cascading deletion to remove the message and all its descendants
			await DatabaseService.deleteMessageCascading(this.activeConversation.id, messageId);

			// Refresh active messages to show the updated branch
			await this.refreshActiveMessages();

			// Update conversation timestamp
			this.updateConversationTimestamp();
		} catch (error) {
			console.error('Failed to delete message:', error);
		}
	}

	/**
	 * Clears the active conversation and messages
	 * Used when navigating away from chat or starting fresh
	 * Note: Does not stop ongoing streaming to allow background completion
	 */
	clearActiveConversation(): void {
		this.activeConversation = null;
		this.activeMessages = [];
		this.isLoading = false;
		this.currentResponse = '';
		slotsService.setActiveConversation(null);
	}

	/** Refreshes active messages based on currNode after branch navigation */
	async refreshActiveMessages(): Promise<void> {
		// Delegate to conversationsStore
		await conversationsStore.refreshActiveMessages();
	}

	/**
	 * Navigates to a specific sibling branch by updating currNode and refreshing messages
	 * Delegates to conversationsStore
	 * @param siblingId - The sibling message ID to navigate to
	 */
	async navigateToSibling(siblingId: string): Promise<void> {
		await conversationsStore.navigateToSibling(siblingId);
	}

	/**
	 * Edits an assistant message with optional branching
	 * @param messageId - The ID of the assistant message to edit
	 * @param newContent - The new content for the message
	 * @param shouldBranch - Whether to create a branch or replace in-place
	 */
	async editAssistantMessage(
		messageId: string,
		newContent: string,
		shouldBranch: boolean
	): Promise<void> {
		if (!this.activeConversation || this.isLoading) return;

		try {
			const messageIndex = this.findMessageIndex(messageId);

			if (messageIndex === -1) {
				console.error('Message not found for editing');
				return;
			}

			const messageToEdit = this.activeMessages[messageIndex];

			if (messageToEdit.role !== 'assistant') {
				console.error('Only assistant messages can be edited with this method');
				return;
			}

			if (shouldBranch) {
				const newMessage = await DatabaseService.createMessageBranch(
					{
						convId: messageToEdit.convId,
						type: messageToEdit.type,
						timestamp: Date.now(),
						role: messageToEdit.role,
						content: newContent,
						thinking: messageToEdit.thinking || '',
						toolCalls: messageToEdit.toolCalls || '',
						children: [],
						model: messageToEdit.model // Preserve original model info when branching
					},
					messageToEdit.parent!
				);

				await DatabaseService.updateCurrentNode(this.activeConversation.id, newMessage.id);
				this.activeConversation.currNode = newMessage.id;
			} else {
				await DatabaseService.updateMessage(messageToEdit.id, {
					content: newContent,
					timestamp: Date.now()
				});

				// Ensure currNode points to the edited message to maintain correct path
				await DatabaseService.updateCurrentNode(this.activeConversation.id, messageToEdit.id);
				this.activeConversation.currNode = messageToEdit.id;

				this.updateMessageAtIndex(messageIndex, {
					content: newContent,
					timestamp: Date.now()
				});
			}

			this.updateConversationTimestamp();
			await this.refreshActiveMessages();
		} catch (error) {
			console.error('Failed to edit assistant message:', error);
		}
	}

	/**
	 * Edits a user message and preserves all responses below
	 * Updates the message content in-place without deleting or regenerating responses
	 *
	 * **Use Case**: When you want to fix a typo or rephrase a question without losing the assistant's response
	 *
	 * **Important Behavior:**
	 * - Does NOT create a branch (unlike editMessageWithBranching)
	 * - Does NOT regenerate assistant responses
	 * - Only updates the user message content in the database
	 * - Preserves the entire conversation tree below the edited message
	 * - Updates conversation title if this is the first user message
	 *
	 * @param messageId - The ID of the user message to edit
	 * @param newContent - The new content for the message
	 */
	async editUserMessagePreserveResponses(messageId: string, newContent: string): Promise<void> {
		if (!this.activeConversation) return;

		try {
			const messageIndex = this.findMessageIndex(messageId);
			if (messageIndex === -1) {
				console.error('Message not found for editing');
				return;
			}

			const messageToEdit = this.activeMessages[messageIndex];
			if (messageToEdit.role !== 'user') {
				console.error('Only user messages can be edited with this method');
				return;
			}

			// Simply update the message content in-place
			await DatabaseService.updateMessage(messageId, {
				content: newContent,
				timestamp: Date.now()
			});

			this.updateMessageAtIndex(messageIndex, {
				content: newContent,
				timestamp: Date.now()
			});

			// Check if first user message for title update
			const allMessages = await DatabaseService.getConversationMessages(this.activeConversation.id);
			const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);
			const isFirstUserMessage =
				rootMessage && messageToEdit.parent === rootMessage.id && messageToEdit.role === 'user';

			if (isFirstUserMessage && newContent.trim()) {
				await this.updateConversationTitleWithConfirmation(
					this.activeConversation.id,
					newContent.trim(),
					this.titleUpdateConfirmationCallback
				);
			}

			this.updateConversationTimestamp();
		} catch (error) {
			console.error('Failed to edit user message:', error);
		}
	}

	/**
	 * Edits a message by creating a new branch with the edited content
	 * @param messageId - The ID of the message to edit
	 * @param newContent - The new content for the message
	 */
	async editMessageWithBranching(messageId: string, newContent: string): Promise<void> {
		if (!this.activeConversation || this.isLoading) return;

		try {
			const messageIndex = this.findMessageIndex(messageId);
			if (messageIndex === -1) {
				console.error('Message not found for editing');
				return;
			}

			const messageToEdit = this.activeMessages[messageIndex];
			if (messageToEdit.role !== 'user') {
				console.error('Only user messages can be edited');
				return;
			}

			// Check if this conversation is an image generation conversation
			// Look at all messages in the current conversation branch
			const wasImageGeneration = this.activeMessages.some(
				(msg) =>
					msg.role === 'assistant' &&
					msg.extra &&
					msg.extra.some((extra: DatabaseMessageExtra) => extra.type === 'imageFile')
			);

			// Check if this is the first user message in the conversation
			// First user message is one that has the root message as its parent
			const allMessages = await DatabaseService.getConversationMessages(this.activeConversation.id);
			const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);
			const isFirstUserMessage =
				rootMessage && messageToEdit.parent === rootMessage.id && messageToEdit.role === 'user';

			let parentId = messageToEdit.parent;

			if (parentId === undefined || parentId === null) {
				const rootMessage = allMessages.find((m) => m.type === 'root' && m.parent === null);
				if (rootMessage) {
					parentId = rootMessage.id;
				} else {
					console.error('No root message found for editing');
					return;
				}
			}

			const newMessage = await DatabaseService.createMessageBranch(
				{
					convId: messageToEdit.convId,
					type: messageToEdit.type,
					timestamp: Date.now(),
					role: messageToEdit.role,
					content: newContent,
					thinking: messageToEdit.thinking || '',
					toolCalls: messageToEdit.toolCalls || '',
					children: [],
					extra: messageToEdit.extra ? JSON.parse(JSON.stringify(messageToEdit.extra)) : undefined,
					model: messageToEdit.model // Preserve original model info when branching
				},
				parentId
			);

			await DatabaseService.updateCurrentNode(this.activeConversation.id, newMessage.id);
			this.activeConversation.currNode = newMessage.id;
			this.updateConversationTimestamp();

			// If this is the first user message, update the conversation title with confirmation if needed
			if (isFirstUserMessage && newContent.trim()) {
				await this.updateConversationTitleWithConfirmation(
					this.activeConversation.id,
					newContent.trim(),
					this.titleUpdateConfirmationCallback
				);
			}

			await this.refreshActiveMessages();

			if (messageToEdit.role === 'user') {
				await this.generateResponseForMessage(newMessage.id, wasImageGeneration);
			}
		} catch (error) {
			console.error('Failed to edit message with branching:', error);
		}
	}

	/**
	 * Regenerates an assistant message by creating a new branch with a new response
	 * @param messageId - The ID of the assistant message to regenerate
	 */
	async regenerateMessageWithBranching(messageId: string): Promise<void> {
		if (!this.activeConversation || this.isLoading) return;

		try {
			const messageIndex = this.findMessageIndex(messageId);
			if (messageIndex === -1) {
				console.error('Message not found for regeneration');
				return;
			}

			const messageToRegenerate = this.activeMessages[messageIndex];
			if (messageToRegenerate.role !== 'assistant') {
				console.error('Only assistant messages can be regenerated');
				return;
			}

			// Check if the message being regenerated was an image generation
			// (check BEFORE we create the branch)
			const wasImageGeneration =
				messageToRegenerate.extra &&
				messageToRegenerate.extra.some((extra: DatabaseMessageExtra) => extra.type === 'imageFile');

			// Find parent message in all conversation messages, not just active path
			const conversationMessages = await DatabaseService.getConversationMessages(
				this.activeConversation.id
			);
			const parentMessage = conversationMessages.find((m) => m.id === messageToRegenerate.parent);
			if (!parentMessage) {
				console.error('Parent message not found for regeneration');
				return;
			}

			this.setConversationLoading(this.activeConversation.id, true);
			this.clearConversationStreaming(this.activeConversation.id);

			const newAssistantMessage = await DatabaseService.createMessageBranch(
				{
					convId: this.activeConversation.id,
					type: 'text',
					timestamp: Date.now(),
					role: 'assistant',
					content: '',
					thinking: '',
					toolCalls: '',
					children: [],
					model: null
				},
				parentMessage.id
			);

			await DatabaseService.updateCurrentNode(this.activeConversation.id, newAssistantMessage.id);
			this.activeConversation.currNode = newAssistantMessage.id;
			this.updateConversationTimestamp();
			await this.refreshActiveMessages();

			const allConversationMessages = await DatabaseService.getConversationMessages(
				this.activeConversation.id
			);
			const conversationPath = filterByLeafNodeId(
				allConversationMessages,
				parentMessage.id,
				false
			) as DatabaseMessage[];

			if (wasImageGeneration) {
				// Generate image instead of text
				try {
					const userMessage = [...conversationPath].reverse().find((msg) => msg.role === 'user');
					const prompt = userMessage?.content || '';

					if (!prompt) {
						throw new Error('No prompt found for image generation');
					}

					const startTime = Date.now();
					const base64Image = await chatService.generateImage(prompt);
					const endTime = Date.now();

					// Calculate timing for image generation
					const generationTimeMs = endTime - startTime;
					const timings: ChatMessageTimings = {
						predicted_ms: generationTimeMs,
						predicted_n: 1 // Representing 1 image generated
					};

					// Get current model name
					const { modelsStore } = await import('$lib/stores/models.svelte');
					const currentModelName = modelsStore.selectedModelName;
					const normalizedModel = currentModelName ? normalizeModelName(currentModelName) : null;

					const isUrl = base64Image.startsWith('http://') || base64Image.startsWith('https://');
					const base64Url = isUrl ? base64Image : `data:image/png;base64,${base64Image}`;

					const imageExtra: DatabaseMessageExtra = {
						type: 'imageFile',
						name: 'generated-image.png',
						base64Url: base64Url
					};

					// Find the message in activeMessages and update it
					const messageIndex = this.findMessageIndex(newAssistantMessage.id);
					this.updateMessageAtIndex(messageIndex, {
						content: '',
						type: 'text',
						extra: [imageExtra],
						timings: timings,
						model: normalizedModel ?? undefined
					});

					await DatabaseService.updateMessage(newAssistantMessage.id, {
						content: '',
						type: 'text',
						extra: [imageExtra],
						timings: timings,
						model: normalizedModel ?? undefined
					});

					this.setConversationLoading(this.activeConversation.id, false);
				} catch (error) {
					console.error('Image generation failed:', error);
					throw error;
				}
			} else {
				// Regular text chat completion
				await this.streamChatCompletion(conversationPath, newAssistantMessage);
			}
		} catch (error) {
			if (this.isAbortError(error)) return;

			console.error('Failed to regenerate message with branching:', error);
			this.setConversationLoading(this.activeConversation!.id, false);
		}
	}

	/**
	 * Generates a new assistant response for a given user message
	 * @param userMessageId - ID of user message to respond to
	 * @param forceImageGeneration - Optional: force image generation mode (used when editing messages)
	 */
	private async generateResponseForMessage(userMessageId: string, forceImageGeneration?: boolean): Promise<void> {
		if (!this.activeConversation) return;

		this.errorDialogState = null;
		this.setConversationLoading(this.activeConversation.id, true);
		this.clearConversationStreaming(this.activeConversation.id);

		try {
			// Get conversation path up to the user message
			const allMessages = await DatabaseService.getConversationMessages(this.activeConversation.id);
			const conversationPath = filterByLeafNodeId(
				allMessages,
				userMessageId,
				false
			) as DatabaseMessage[];

			// Check if this is an image generation conversation
			// If forceImageGeneration is provided, use that; otherwise check the conversation path
			let wasImageGeneration = forceImageGeneration ?? false;

			if (!forceImageGeneration) {
				// Check if any existing assistant messages have image attachments
				wasImageGeneration = conversationPath.some(
					(msg) =>
						msg.role === 'assistant' &&
						msg.extra &&
						msg.extra.some((extra: DatabaseMessageExtra) => extra.type === 'imageFile')
				);
			}

			// Create new assistant message branch
			const assistantMessage = await DatabaseService.createMessageBranch(
				{
					convId: this.activeConversation.id,
					type: 'text',
					timestamp: Date.now(),
					role: 'assistant',
					content: '',
					thinking: '',
					toolCalls: '',
					children: [],
					model: null
				},
				userMessageId
			);

			// Add assistant message to active messages immediately for UI reactivity
			this.activeMessages.push(assistantMessage);

			if (wasImageGeneration) {
				// Generate image instead of text
				try {
					const userMessage = [...conversationPath].reverse().find((msg) => msg.role === 'user');
					const prompt = userMessage?.content || '';

					if (!prompt) {
						throw new Error('No prompt found for image generation');
					}

					const startTime = Date.now();
					const base64Image = await chatService.generateImage(prompt);
					const endTime = Date.now();

					// Calculate timing for image generation
					const generationTimeMs = endTime - startTime;
					const timings: ChatMessageTimings = {
						predicted_ms: generationTimeMs,
						predicted_n: 1 // Representing 1 image generated
					};

					// Get current model name
					const { modelsStore } = await import('$lib/stores/models.svelte');
					const currentModelName = modelsStore.selectedModelName;
					const normalizedModel = currentModelName ? normalizeModelName(currentModelName) : null;

					const isUrl = base64Image.startsWith('http://') || base64Image.startsWith('https://');
					const base64Url = isUrl ? base64Image : `data:image/png;base64,${base64Image}`;

					const imageExtra: DatabaseMessageExtra = {
						type: 'imageFile',
						name: 'generated-image.png',
						base64Url: base64Url
					};

					// Find the message in activeMessages and update it
					const messageIndex = this.findMessageIndex(assistantMessage.id);
					this.updateMessageAtIndex(messageIndex, {
						content: '',
						type: 'text',
						extra: [imageExtra],
						timings: timings,
						model: normalizedModel ?? undefined
					});

					await DatabaseService.updateMessage(assistantMessage.id, {
						content: '',
						type: 'text',
						extra: [imageExtra],
						timings: timings,
						model: normalizedModel ?? undefined
					});

					this.setConversationLoading(this.activeConversation.id, false);
				} catch (error) {
					console.error('Image generation failed:', error);
					throw error;
				}
			} else {
				// Regular text chat completion
				await this.streamChatCompletion(conversationPath, assistantMessage);
			}
		} catch (error) {
			console.error('Failed to generate response:', error);
			this.setConversationLoading(this.activeConversation!.id, false);
		}
	}

	/**
	 * Continues generation for an existing assistant message
	 * @param messageId - The ID of the assistant message to continue
	 */
	async continueAssistantMessage(messageId: string): Promise<void> {
		if (!this.activeConversation || this.isLoading) return;

		try {
			const messageIndex = this.findMessageIndex(messageId);
			if (messageIndex === -1) {
				console.error('Message not found for continuation');
				return;
			}

			const messageToContinue = this.activeMessages[messageIndex];
			if (messageToContinue.role !== 'assistant') {
				console.error('Only assistant messages can be continued');
				return;
			}

			// Race condition protection: Check if this specific conversation is already loading
			// This prevents multiple rapid clicks on "Continue" from creating concurrent operations
			if (this.isConversationLoading(this.activeConversation.id)) {
				console.warn('Continuation already in progress for this conversation');
				return;
			}

			this.errorDialogState = null;
			this.setConversationLoading(this.activeConversation.id, true);
			this.clearConversationStreaming(this.activeConversation.id);

			// IMPORTANT: Fetch the latest content from the database to ensure we have
			// the most up-to-date content, especially after a stopped generation
			// This prevents issues where the in-memory state might be stale
			const allMessages = await DatabaseService.getConversationMessages(this.activeConversation.id);
			const dbMessage = allMessages.find((m) => m.id === messageId);

			if (!dbMessage) {
				console.error('Message not found in database for continuation');
				this.setConversationLoading(this.activeConversation.id, false);

				return;
			}

			// Use content from database as the source of truth
			const originalContent = dbMessage.content;
			const originalThinking = dbMessage.thinking || '';

			// Get conversation context up to (but not including) the message to continue
			const conversationContext = this.activeMessages.slice(0, messageIndex);

			const contextWithContinue = [
				...conversationContext.map((msg) => {
					if ('id' in msg && 'convId' in msg && 'timestamp' in msg) {
						return msg as DatabaseMessage & { extra?: DatabaseMessageExtra[] };
					}
					return msg as ApiChatMessageData;
				}),
				{
					role: 'assistant' as const,
					content: originalContent
				}
			];

			let appendedContent = '';
			let appendedThinking = '';
			let hasReceivedContent = false;

			await chatService.sendMessage(
				contextWithContinue,
				{
					...this.getApiOptions(),

					onChunk: (chunk: string) => {
						hasReceivedContent = true;
						appendedContent += chunk;
						// Preserve originalContent exactly as-is, including any trailing whitespace
						// The concatenation naturally preserves any whitespace at the end of originalContent
						const fullContent = originalContent + appendedContent;

						this.setConversationStreaming(
							messageToContinue.convId,
							fullContent,
							messageToContinue.id
						);

						this.updateMessageAtIndex(messageIndex, {
							content: fullContent
						});
					},

					onReasoningChunk: (reasoningChunk: string) => {
						hasReceivedContent = true;
						appendedThinking += reasoningChunk;

						const fullThinking = originalThinking + appendedThinking;

						this.updateMessageAtIndex(messageIndex, {
							thinking: fullThinking
						});
					},

					onComplete: async (
						finalContent?: string,
						reasoningContent?: string,
						timings?: ChatMessageTimings
					) => {
						const fullContent = originalContent + (finalContent || appendedContent);
						const fullThinking = originalThinking + (reasoningContent || appendedThinking);

						const updateData: {
							content: string;
							thinking: string;
							timestamp: number;
							timings?: ChatMessageTimings;
						} = {
							content: fullContent,
							thinking: fullThinking,
							timestamp: Date.now(),
							timings: timings
						};

						await DatabaseService.updateMessage(messageToContinue.id, updateData);

						this.updateMessageAtIndex(messageIndex, updateData);

						this.updateConversationTimestamp();

						this.setConversationLoading(messageToContinue.convId, false);
						this.clearConversationStreaming(messageToContinue.convId);
						slotsService.clearConversationState(messageToContinue.convId);
					},

					onError: async (error: Error) => {
						if (this.isAbortError(error)) {
							// User cancelled - save partial continuation if any content was received
							if (hasReceivedContent && appendedContent) {
								const partialContent = originalContent + appendedContent;
								const partialThinking = originalThinking + appendedThinking;

								await DatabaseService.updateMessage(messageToContinue.id, {
									content: partialContent,
									thinking: partialThinking,
									timestamp: Date.now()
								});

								this.updateMessageAtIndex(messageIndex, {
									content: partialContent,
									thinking: partialThinking,
									timestamp: Date.now()
								});
							}

							this.setConversationLoading(messageToContinue.convId, false);
							this.clearConversationStreaming(messageToContinue.convId);
							slotsService.clearConversationState(messageToContinue.convId);

							return;
						}

						// Non-abort error - rollback to original content
						console.error('Continue generation error:', error);

						// Rollback: Restore original content in UI
						this.updateMessageAtIndex(messageIndex, {
							content: originalContent,
							thinking: originalThinking
						});

						// Ensure database has original content (in case of partial writes)
						await DatabaseService.updateMessage(messageToContinue.id, {
							content: originalContent,
							thinking: originalThinking
						});

						this.setConversationLoading(messageToContinue.convId, false);
						this.clearConversationStreaming(messageToContinue.convId);
						slotsService.clearConversationState(messageToContinue.convId);

						const dialogType = error.name === 'TimeoutError' ? 'timeout' : 'server';
						this.showErrorDialog(dialogType, error.message);
					}
				},
				messageToContinue.convId
			);
		} catch (error) {
			if (this.isAbortError(error)) return;
			console.error('Failed to continue message:', error);
			if (this.activeConversation) {
				this.setConversationLoading(this.activeConversation.id, false);
			}
		}
	}

	/**
	 * Public methods for accessing per-conversation states
	 */
	public isConversationLoadingPublic(convId: string): boolean {
		return this.isConversationLoading(convId);
	}

	public getConversationStreamingPublic(
		convId: string
	): { response: string; messageId: string } | undefined {
		return this.getConversationStreaming(convId);
	}

	public getAllLoadingConversations(): string[] {
		return Array.from(this.conversationLoadingStates.keys());
	}

	public getAllStreamingConversations(): string[] {
		return Array.from(this.conversationStreamingStates.keys());
	}
}

export const chatStore = new ChatStore();

export const conversations = () => chatStore.conversations;
export const activeConversation = () => chatStore.activeConversation;
export const activeMessages = () => chatStore.activeMessages;
export const isLoading = () => chatStore.isLoading;
export const currentResponse = () => chatStore.currentResponse;
export const isInitialized = () => chatStore.isInitialized;
export const errorDialog = () => chatStore.errorDialogState;

export const createConversation = chatStore.createConversation.bind(chatStore);
export const downloadConversation = chatStore.downloadConversation.bind(chatStore);
export const exportAllConversations = chatStore.exportAllConversations.bind(chatStore);
export const importConversations = chatStore.importConversations.bind(chatStore);
export const deleteConversation = chatStore.deleteConversation.bind(chatStore);
export const deleteMultipleConversations = chatStore.deleteMultipleConversations.bind(chatStore);
export const sendMessage = chatStore.sendMessage.bind(chatStore);
export const dismissErrorDialog = chatStore.dismissErrorDialog.bind(chatStore);

export const gracefulStop = chatStore.gracefulStop.bind(chatStore);

// Branching operations
export const refreshActiveMessages = chatStore.refreshActiveMessages.bind(chatStore);
export const navigateToSibling = chatStore.navigateToSibling.bind(chatStore);
export const editAssistantMessage = chatStore.editAssistantMessage.bind(chatStore);
export const editMessageWithBranching = chatStore.editMessageWithBranching.bind(chatStore);
export const editUserMessagePreserveResponses =
	chatStore.editUserMessagePreserveResponses.bind(chatStore);
export const regenerateMessageWithBranching =
	chatStore.regenerateMessageWithBranching.bind(chatStore);
export const continueAssistantMessage = chatStore.continueAssistantMessage.bind(chatStore);
export const deleteMessage = chatStore.deleteMessage.bind(chatStore);
export const getDeletionInfo = chatStore.getDeletionInfo.bind(chatStore);
export const updateConversationName = chatStore.updateConversationName.bind(chatStore);
export const setTitleUpdateConfirmationCallback =
	chatStore.setTitleUpdateConfirmationCallback.bind(chatStore);

export function stopGeneration() {
	chatStore.stopGeneration();
}
export const messages = () => chatStore.activeMessages;

// Per-conversation state access
export const isConversationLoading = (convId: string) =>
	chatStore.isConversationLoadingPublic(convId);
export const getConversationStreaming = (convId: string) =>
	chatStore.getConversationStreamingPublic(convId);
export const getAllLoadingConversations = () => chatStore.getAllLoadingConversations();
export const getAllStreamingConversations = () => chatStore.getAllStreamingConversations();
