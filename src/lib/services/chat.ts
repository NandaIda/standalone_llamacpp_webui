import { config } from '$lib/stores/settings.svelte';
import { selectedModelName } from '$lib/stores/models.svelte';
import { slotsService } from './slots';
import type {
	ApiChatCompletionRequest,
	ApiChatCompletionResponse,
	ApiChatCompletionStreamChunk,
	ApiChatCompletionToolCall,
	ApiChatCompletionToolCallDelta,
	ApiChatMessageData
} from '$lib/types/api';
import type {
	DatabaseMessage,
	DatabaseMessageExtra,
	DatabaseMessageExtraAudioFile,
	DatabaseMessageExtraImageFile,
	DatabaseMessageExtraLegacyContext,
	DatabaseMessageExtraPdfFile,
	DatabaseMessageExtraTextFile
} from '$lib/types/database';
import type { ChatMessagePromptProgress, ChatMessageTimings } from '$lib/types/chat';
import type { SettingsChatServiceOptions } from '$lib/types/settings';
/**
 * ChatService - Low-level API communication layer for llama.cpp server interactions
 *
 * This service handles direct communication with the llama.cpp server's chat completion API.
 * It provides the network layer abstraction for AI model interactions while remaining
 * stateless and focused purely on API communication.
 *
 * **Architecture & Relationship with ChatStore:**
 * - **ChatService** (this class): Stateless API communication layer
 *   - Handles HTTP requests/responses with llama.cpp server
 *   - Manages streaming and non-streaming response parsing
 *   - Provides request abortion capabilities
 *   - Converts database messages to API format
 *   - Handles error translation for server responses
 *
 * - **ChatStore**: Stateful orchestration and UI state management
 *   - Uses ChatService for all AI model communication
 *   - Manages conversation state, message history, and UI reactivity
 *   - Coordinates with DatabaseStore for persistence
 *   - Handles complex workflows like branching and regeneration
 *
 * **Key Responsibilities:**
 * - Message format conversion (DatabaseMessage → API format)
 * - Streaming response handling with real-time callbacks
 * - Reasoning content extraction and processing
 * - File attachment processing (images, PDFs, audio, text)
 * - Request lifecycle management (abort, cleanup)
 */
export class ChatService {
	private abortControllers: Map<string, AbortController> = new Map();

	/**
	 * Extracts reasoning content from <think> tags in the message content
	 * @param content - The message content that may contain <think> tags
	 * @returns Object with separated content and reasoning
	 */
	private static parseThinkTags(content: string): { content: string; reasoning: string | null } {
		const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
		const matches = content.match(thinkRegex);

		if (!matches || matches.length === 0) {
			return { content, reasoning: null };
		}

		// Extract all thinking content
		const reasoning = matches
			.map(match => match.replace(/<\/?think>/g, '').trim())
			.join('\n\n');

		// Remove <think> tags from content
		const cleanContent = content.replace(thinkRegex, '').trim();

		return { content: cleanContent, reasoning };
	}

	/**
	 * Sends a chat completion request to the llama.cpp server.
	 * Supports both streaming and non-streaming responses with comprehensive parameter configuration.
	 * Automatically converts database messages with attachments to the appropriate API format.
	 *
	 * @param messages - Array of chat messages to send to the API (supports both ApiChatMessageData and DatabaseMessage with attachments)
	 * @param options - Configuration options for the chat completion request. See `SettingsChatServiceOptions` type for details.
	 * @returns {Promise<string | void>} that resolves to the complete response string (non-streaming) or void (streaming)
	 * @throws {Error} if the request fails or is aborted
	 */
	async sendMessage(
		messages: ApiChatMessageData[] | (DatabaseMessage & { extra?: DatabaseMessageExtra[] })[],
		options: SettingsChatServiceOptions = {},
		conversationId?: string
	): Promise<string | void> {
		const {
			stream,
			onChunk,
			onComplete,
			onError,
			onReasoningChunk,
			onToolCallChunk,
			onModel,
			onFirstValidChunk,
			// Generation parameters
			temperature,
			max_tokens,
			max_completion_tokens,
			reasoning_effort,
			max_context,
			// Sampling parameters
			dynatemp_range,
			dynatemp_exponent,
			top_k,
			top_p,
			min_p,
			xtc_probability,
			xtc_threshold,
			typ_p,
			// Penalty parameters
			repeat_last_n,
			repeat_penalty,
			presence_penalty,
			frequency_penalty,
			dry_multiplier,
			dry_base,
			dry_allowed_length,
			dry_penalty_last_n,
			// Other parameters
			samplers,
			custom,
			timings_per_token
		} = options;

		const currentConfig = config();

		const requestId = conversationId || 'default';

		if (this.abortControllers.has(requestId)) {
			this.abortControllers.get(requestId)?.abort();
		}

		const abortController = new AbortController();
		this.abortControllers.set(requestId, abortController);

		const normalizedMessages: ApiChatMessageData[] = messages
			.map((msg) => {
				if ('id' in msg && 'convId' in msg && 'timestamp' in msg) {
					const dbMsg = msg as DatabaseMessage & { extra?: DatabaseMessageExtra[] };
					return ChatService.convertMessageToChatServiceData(dbMsg);
				} else {
					return msg as ApiChatMessageData;
				}
			})
			.filter((msg) => {
				if (msg.role === 'system') {
					const content = typeof msg.content === 'string' ? msg.content : '';

					return content.trim().length > 0;
				}

				return true;
			});

		const processedMessages = this.injectSystemMessage(normalizedMessages);

		const requestBody: ApiChatCompletionRequest = {
			messages: processedMessages.map((msg: ApiChatMessageData) => ({
				role: msg.role,
				content: msg.content
			})),
			stream
		};

		const modelSelectorEnabled = Boolean(currentConfig.modelSelectorEnabled);
		const activeModel = modelSelectorEnabled ? selectedModelName() : null;

		if (modelSelectorEnabled && activeModel) {
			requestBody.model = activeModel;
		}

		requestBody.reasoning_format = currentConfig.disableReasoningFormat ? 'none' : 'auto';

		if (temperature !== undefined) requestBody.temperature = temperature;

		// Initial logic: Prefer max_tokens as requested, unless explicitly set otherwise
		if (max_tokens !== undefined) {
			requestBody.max_tokens = max_tokens !== null && max_tokens !== 0 ? max_tokens : -1;
		} else if (max_completion_tokens !== undefined && max_completion_tokens !== null && max_completion_tokens !== 0 && max_completion_tokens !== -1) {
			requestBody.max_completion_tokens = max_completion_tokens;
		}

		if (reasoning_effort !== undefined && reasoning_effort !== 'none') {
			requestBody.reasoning_effort = reasoning_effort;
		}

		if (max_context !== undefined) requestBody.max_context = max_context;

		if (dynatemp_range !== undefined) requestBody.dynatemp_range = dynatemp_range;
		if (dynatemp_exponent !== undefined) requestBody.dynatemp_exponent = dynatemp_exponent;
		if (top_k !== undefined) requestBody.top_k = top_k;
		if (top_p !== undefined) requestBody.top_p = top_p;
		if (min_p !== undefined) requestBody.min_p = min_p;
		if (xtc_probability !== undefined) requestBody.xtc_probability = xtc_probability;
		if (xtc_threshold !== undefined) requestBody.xtc_threshold = xtc_threshold;
		if (typ_p !== undefined) requestBody.typ_p = typ_p;

		if (repeat_last_n !== undefined) requestBody.repeat_last_n = repeat_last_n;
		if (repeat_penalty !== undefined) requestBody.repeat_penalty = repeat_penalty;
		if (presence_penalty !== undefined) requestBody.presence_penalty = presence_penalty;
		if (frequency_penalty !== undefined) requestBody.frequency_penalty = frequency_penalty;
		if (dry_multiplier !== undefined) requestBody.dry_multiplier = dry_multiplier;
		if (dry_base !== undefined) requestBody.dry_base = dry_base;
		if (dry_allowed_length !== undefined) requestBody.dry_allowed_length = dry_allowed_length;
		if (dry_penalty_last_n !== undefined) requestBody.dry_penalty_last_n = dry_penalty_last_n;

		if (samplers !== undefined) {
			requestBody.samplers =
				typeof samplers === 'string'
					? samplers.split(';').filter((s: string) => s.trim())
					: samplers;
		}

		if (timings_per_token !== undefined) requestBody.timings_per_token = timings_per_token;

		if (custom) {
			try {
				const customParams = typeof custom === 'string' ? JSON.parse(custom) : custom;
				Object.assign(requestBody, customParams);
			} catch (error) {
				console.warn('Failed to parse custom parameters:', error);
			}
		}

		const requestStartTime = Date.now();

		try {
			const apiKey = currentConfig.apiKey?.toString().trim();
			let apiBaseUrl = currentConfig.apiBaseUrl?.toString().trim() || '.';

			// Remove trailing slash to avoid double slashes
			if (apiBaseUrl !== '.' && apiBaseUrl.endsWith('/')) {
				apiBaseUrl = apiBaseUrl.slice(0, -1);
			}

			const isExternalApi = apiBaseUrl !== '.' && !apiBaseUrl.startsWith('/') &&
				(apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://'));

			const chatEndpoint = apiBaseUrl === '.' ? './v1/chat/completions' : `${apiBaseUrl}/chat/completions`;

			// Filter out llama.cpp-specific parameters for external APIs
			if (isExternalApi) {
				// Keep only standard OpenAI parameters
				const standardParams = {
					messages: requestBody.messages,
					model: requestBody.model,
					stream: requestBody.stream,
					temperature: requestBody.temperature,
					top_p: requestBody.top_p,
					presence_penalty: requestBody.presence_penalty,
					max_tokens: requestBody.max_tokens,
					max_completion_tokens: requestBody.max_completion_tokens,
					reasoning_effort: requestBody.reasoning_effort,
					stop: requestBody.stop,
					tools: requestBody.tools,
					tool_choice: requestBody.tool_choice,
					response_format: requestBody.response_format,
					n: requestBody.n,
					logit_bias: requestBody.logit_bias,
					user: requestBody.user
				};

				// Remove undefined values
				Object.keys(standardParams).forEach(key => {
					if ((standardParams as any)[key] === undefined) {
						delete (standardParams as any)[key];
					}
				});

				// Overwrite requestBody with filtered standard parameters
				Object.keys(requestBody).forEach(key => delete (requestBody as any)[key]);
				Object.assign(requestBody, standardParams);

				// Remove max_tokens if it's -1 (infinite in llama.cpp, invalid for external APIs)
				if (requestBody.max_tokens === -1) {
					delete requestBody.max_tokens;
				}

				console.log('Sending to external API:', chatEndpoint);
				console.log('Request body:', JSON.stringify(requestBody, null, 2));
			}

			let response: Response | undefined;
			let attempts = 0;
			const maxAttempts = 3;

			while (attempts < maxAttempts) {
				attempts++;
				
				response = await fetch(chatEndpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
					},
					body: JSON.stringify(requestBody),
					signal: abortController.signal
				});

				if (response.ok) break;

				// If request failed with 400, check for known compatibility issues and retry
				if (response.status === 400) {
					try {
						const errorClone = response.clone();
						const errorText = await errorClone.text();
						let retrying = false;

						// Case 1: Reasoning effort not supported
						if ((errorText.includes("Thinking is not enabled") || 
							 errorText.includes("reasoning_effort") ||
							 errorText.includes("INVALID_ARGUMENT")) && 
							 requestBody.reasoning_effort) {
							
							console.warn("Server rejected reasoning_effort, retrying without it.");
							delete requestBody.reasoning_effort;
							retrying = true;
						}

						// Case 2: max_tokens not supported (e.g. o1 models require max_completion_tokens)
						// Check for "unknown name" or explicit mention of max_tokens/max_completion_tokens
						if ((errorText.includes("max_tokens") || 
							 errorText.includes("max_completion_tokens") ||
							 errorText.includes("unknown name \"max_tokens\"")) && 
							 requestBody.max_tokens !== undefined) {
							
							console.warn("Server rejected max_tokens, swapping to max_completion_tokens.");
							requestBody.max_completion_tokens = requestBody.max_tokens;
							delete requestBody.max_tokens;
							retrying = true;
						}

						if (retrying) {
							continue; // Retry the loop
						}
					} catch (e) {
						console.warn("Error checking retry conditions:", e);
					}
				}

				// If not retryable or unknown error, break
				break;
			}

			if (!response || !response.ok) {
				const error = await this.parseErrorResponse(response || new Response(null, { status: 500 }));
				if (onError) {
					onError(error);
				}
				throw error;
			}

			if (stream) {
				await this.handleStreamResponse(
					response,
					onChunk,
					onComplete,
					onError,
					onReasoningChunk,
					onToolCallChunk,
					onModel,
					onFirstValidChunk,
					conversationId,
					abortController.signal
				);
				return;
			} else {
				return this.handleNonStreamResponse(
					response,
					onComplete,
					onError,
					onToolCallChunk,
					onModel,
					requestStartTime
				);
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				console.log('Chat completion request was aborted');
				return;
			}

			let userFriendlyError: Error;

			if (error instanceof Error) {
				if (error.name === 'TypeError' && error.message.includes('fetch')) {
					userFriendlyError = new Error(
						'Unable to connect to server - please check if the server is running'
					);
					userFriendlyError.name = 'NetworkError';
				} else if (error.message.includes('ECONNREFUSED')) {
					userFriendlyError = new Error('Connection refused - server may be offline');
					userFriendlyError.name = 'NetworkError';
				} else if (error.message.includes('ETIMEDOUT')) {
					userFriendlyError = new Error('Request timed out - the server took too long to respond');
					userFriendlyError.name = 'TimeoutError';
				} else {
					userFriendlyError = error;
				}
			} else {
				userFriendlyError = new Error('Unknown error occurred while sending message');
			}

			console.error('Error in sendMessage:', error);
			if (onError) {
				onError(userFriendlyError);
			}
			throw userFriendlyError;
		} finally {
			this.abortControllers.delete(requestId);
		}
	}

	/**
	 * Handles streaming response from the chat completion API
	 * @param response - The Response object from the fetch request
	 * @param onChunk - Optional callback invoked for each content chunk received
	 * @param onComplete - Optional callback invoked when the stream is complete with full response
	 * @param onError - Optional callback invoked if an error occurs during streaming
	 * @param onReasoningChunk - Optional callback invoked for each reasoning content chunk
	 * @param conversationId - Optional conversation ID for per-conversation state tracking
	 * @returns {Promise<void>} Promise that resolves when streaming is complete
	 * @throws {Error} if the stream cannot be read or parsed
	 */
	private async handleStreamResponse(
		response: Response,
		onChunk?: (chunk: string) => void,
		onComplete?: (
			response: string,
			reasoningContent?: string,
			timings?: ChatMessageTimings,
			toolCalls?: string
		) => void,
		onError?: (error: Error) => void,
		onReasoningChunk?: (chunk: string) => void,
		onToolCallChunk?: (chunk: string) => void,
		onModel?: (model: string) => void,
		onFirstValidChunk?: () => void,
		conversationId?: string,
		abortSignal?: AbortSignal
	): Promise<void> {
		const reader = response.body?.getReader();

		if (!reader) {
			throw new Error('No response body');
		}

		const decoder = new TextDecoder();
		let aggregatedContent = '';
		let fullReasoningContent = '';
		let aggregatedToolCalls: ApiChatCompletionToolCall[] = [];
		let lastTimings: ChatMessageTimings | undefined;
		let streamFinished = false;
		let modelEmitted = false;
		let firstValidChunkEmitted = false;
		let toolCallIndexOffset = 0;
		let hasOpenToolCallBatch = false;
		let thinkBuffer = '';
		let insideThinkTag = false;

		// Track timing for external APIs
		const startTime = Date.now();
		let firstTokenTime: number | undefined;
		let usageData: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

		const finalizeOpenToolCallBatch = () => {
			if (!hasOpenToolCallBatch) {
				return;
			}

			toolCallIndexOffset = aggregatedToolCalls.length;
			hasOpenToolCallBatch = false;
		};

		const processToolCallDelta = (toolCalls?: ApiChatCompletionToolCallDelta[]) => {
			if (!toolCalls || toolCalls.length === 0) {
				return;
			}

			aggregatedToolCalls = this.mergeToolCallDeltas(
				aggregatedToolCalls,
				toolCalls,
				toolCallIndexOffset
			);

			if (aggregatedToolCalls.length === 0) {
				return;
			}

			hasOpenToolCallBatch = true;

			const serializedToolCalls = JSON.stringify(aggregatedToolCalls);

			if (!serializedToolCalls) {
				return;
			}

			if (!abortSignal?.aborted) {
				onToolCallChunk?.(serializedToolCalls);
			}
		};

		try {
			let chunk = '';
			while (true) {
				if (abortSignal?.aborted) break;

				const { done, value } = await reader.read();
				if (done) break;

				if (abortSignal?.aborted) break;

				chunk += decoder.decode(value, { stream: true });
				const lines = chunk.split('\n');
				chunk = lines.pop() || '';

				for (const line of lines) {
					if (abortSignal?.aborted) break;

					if (line.startsWith('data: ')) {
						const data = line.slice(6);
						if (data === '[DONE]') {
							streamFinished = true;
							continue;
						}

						try {
							const parsed: ApiChatCompletionStreamChunk = JSON.parse(data);

							if (!firstValidChunkEmitted && parsed.object === 'chat.completion.chunk') {
								firstValidChunkEmitted = true;

								if (!abortSignal?.aborted) {
									onFirstValidChunk?.();
								}
							}

							const content = parsed.choices[0]?.delta?.content;
							// Support both OpenRouter format (reasoning) and OpenAI format (reasoning_content)
							const reasoningContent = parsed.choices[0]?.delta?.reasoning || parsed.choices[0]?.delta?.reasoning_content;
							const toolCalls = parsed.choices[0]?.delta?.tool_calls;
							const timings = parsed.timings;
							const promptProgress = parsed.prompt_progress;
							const usage = parsed.usage;
							const finishReason = parsed.choices[0]?.finish_reason;

							const chunkModel = this.extractModelName(parsed);
							if (chunkModel && !modelEmitted) {
								modelEmitted = true;
								onModel?.(chunkModel);
							}

							// Track first token time for tokens/sec calculation
							if ((content || reasoningContent) && !firstTokenTime) {
								firstTokenTime = Date.now();
							}

							// Extract usage data from final chunk (external APIs like DeepInfra)
							if (usage && finishReason) {
								usageData = usage;
							}

							if (timings || promptProgress) {
								this.updateProcessingState(timings, promptProgress, conversationId);
								if (timings) {
									lastTimings = timings;
								}
							}

							if (content) {
								finalizeOpenToolCallBatch();

								// Parse <think> tags from streaming content
								let processedContent = content;
								thinkBuffer += content;

								// Check for <think> opening tag
								if (thinkBuffer.includes('<think>') && !insideThinkTag) {
									insideThinkTag = true;
									const parts = thinkBuffer.split('<think>');
									// Send any content before <think>
									if (parts[0] && !abortSignal?.aborted) {
										onChunk?.(parts[0]);
										aggregatedContent += parts[0];
									}
									thinkBuffer = parts[1] || '';
									processedContent = '';
								}

								// Check for </think> closing tag
								if (insideThinkTag && thinkBuffer.includes('</think>')) {
									const parts = thinkBuffer.split('</think>');
									const thinkContent = parts[0];

									// Send reasoning content
									if (thinkContent && !abortSignal?.aborted) {
										onReasoningChunk?.(thinkContent);
										fullReasoningContent += thinkContent;
									}

									// Send any content after </think>
									processedContent = parts[1] || '';
									thinkBuffer = '';
									insideThinkTag = false;

									if (processedContent && !abortSignal?.aborted) {
										onChunk?.(processedContent);
										aggregatedContent += processedContent;
									}
								} else if (insideThinkTag) {
									// Still inside think tag, don't send as regular content
									processedContent = '';
								} else {
									// Regular content, not in think tags
									aggregatedContent += content;
									if (!abortSignal?.aborted) {
										onChunk?.(content);
									}
								}
							}

							if (reasoningContent) {
								finalizeOpenToolCallBatch();
								fullReasoningContent += reasoningContent;
								if (!abortSignal?.aborted) {
									onReasoningChunk?.(reasoningContent);
								}
							}

							processToolCallDelta(toolCalls);
						} catch (e) {
							console.error('Error parsing JSON chunk:', e);
						}
					}
				}

				if (abortSignal?.aborted) break;
			}

			if (abortSignal?.aborted) return;

			if (streamFinished) {
				finalizeOpenToolCallBatch();

				const finalToolCalls =
					aggregatedToolCalls.length > 0 ? JSON.stringify(aggregatedToolCalls) : undefined;

				// Convert external API usage data to timings format
				if (usageData && !lastTimings) {
					const endTime = Date.now();
					const totalMs = endTime - startTime;
					const promptMs = firstTokenTime ? firstTokenTime - startTime : Math.floor(totalMs * 0.1);
					const predictedMs = firstTokenTime ? endTime - firstTokenTime : Math.floor(totalMs * 0.9);

					lastTimings = {
						prompt_n: usageData.prompt_tokens,
						prompt_ms: promptMs,
						predicted_n: usageData.completion_tokens,
						predicted_ms: predictedMs
					};

					console.log('Generated timings from usage data:', lastTimings);
				}

				onComplete?.(
					aggregatedContent,
					fullReasoningContent || undefined,
					lastTimings,
					finalToolCalls
				);
			}
		} catch (error) {
			const err = error instanceof Error ? error : new Error('Stream error');

			onError?.(err);

			throw err;
		} finally {
			reader.releaseLock();
		}
	}

	private mergeToolCallDeltas(
		existing: ApiChatCompletionToolCall[],
		deltas: ApiChatCompletionToolCallDelta[],
		indexOffset = 0
	): ApiChatCompletionToolCall[] {
		const result = existing.map((call) => ({
			...call,
			function: call.function ? { ...call.function } : undefined
		}));

		for (const delta of deltas) {
			const index =
				typeof delta.index === 'number' && delta.index >= 0
					? delta.index + indexOffset
					: result.length;

			while (result.length <= index) {
				result.push({ function: undefined });
			}

			const target = result[index]!;

			if (delta.id) {
				target.id = delta.id;
			}

			if (delta.type) {
				target.type = delta.type;
			}

			if (delta.function) {
				const fn = target.function ? { ...target.function } : {};

				if (delta.function.name) {
					fn.name = delta.function.name;
				}

				if (delta.function.arguments) {
					fn.arguments = (fn.arguments ?? '') + delta.function.arguments;
				}

				target.function = fn;
			}
		}

		return result;
	}

	/**
	 * Handles non-streaming response from the chat completion API.
	 * Parses the JSON response and extracts the generated content.
	 *
	 * @param response - The fetch Response object containing the JSON data
	 * @param onComplete - Optional callback invoked when response is successfully parsed
	 * @param onError - Optional callback invoked if an error occurs during parsing
	 * @returns {Promise<string>} Promise that resolves to the generated content string
	 * @throws {Error} if the response cannot be parsed or is malformed
	 */
	private async handleNonStreamResponse(
		response: Response,
		onComplete?: (
			response: string,
			reasoningContent?: string,
			timings?: ChatMessageTimings,
			toolCalls?: string
		) => void,
		onError?: (error: Error) => void,
		onToolCallChunk?: (chunk: string) => void,
		onModel?: (model: string) => void,
		startTime?: number
	): Promise<string> {
		try {
			const responseText = await response.text();

			if (!responseText.trim()) {
				const noResponseError = new Error('No response received from server. Please try again.');
				throw noResponseError;
			}

			const data: ApiChatCompletionResponse = JSON.parse(responseText);
			const endTime = Date.now();

			const responseModel = this.extractModelName(data);
			if (responseModel) {
				onModel?.(responseModel);
			}

			let content = data.choices[0]?.message?.content || '';
			// Support both OpenRouter format (reasoning) and OpenAI format (reasoning_content)
			let reasoningContent = data.choices[0]?.message?.reasoning || data.choices[0]?.message?.reasoning_content;
			const toolCalls = data.choices[0]?.message?.tool_calls;

			// Parse <think> tags if present
			if (content && !reasoningContent) {
				const parsed = ChatService.parseThinkTags(content);
				content = parsed.content;
				reasoningContent = parsed.reasoning || reasoningContent;
			}

			if (reasoningContent) {
				console.log('Full reasoning content:', reasoningContent);
			}

			let serializedToolCalls: string | undefined;

			if (toolCalls && toolCalls.length > 0) {
				const mergedToolCalls = this.mergeToolCallDeltas([], toolCalls);

				if (mergedToolCalls.length > 0) {
					serializedToolCalls = JSON.stringify(mergedToolCalls);
					if (serializedToolCalls) {
						onToolCallChunk?.(serializedToolCalls);
					}
				}
			}

			if (!content.trim() && !serializedToolCalls) {
				const noResponseError = new Error('No response received from server. Please try again.');
				throw noResponseError;
			}

			// Extract usage data and convert to timings format for external APIs
			let timings: ChatMessageTimings | undefined;
			const usage = data.usage;
			if (usage && startTime) {
				const totalMs = endTime - startTime;
				// Estimate 10% for prompt processing, 90% for generation
				const promptMs = Math.floor(totalMs * 0.1);
				const predictedMs = Math.floor(totalMs * 0.9);

				timings = {
					prompt_n: usage.prompt_tokens,
					prompt_ms: promptMs,
					predicted_n: usage.completion_tokens,
					predicted_ms: predictedMs
				};

				console.log('Generated timings from usage data (non-streaming):', timings);
			}

			onComplete?.(content, reasoningContent, timings, serializedToolCalls);

			return content;
		} catch (error) {
			const err = error instanceof Error ? error : new Error('Parse error');

			onError?.(err);

			throw err;
		}
	}

	/**
	 * Converts a database message with attachments to API chat message format.
	 * Processes various attachment types (images, text files, PDFs) and formats them
	 * as content parts suitable for the chat completion API.
	 *
	 * @param message - Database message object with optional extra attachments
	 * @param message.content - The text content of the message
	 * @param message.role - The role of the message sender (user, assistant, system)
	 * @param message.extra - Optional array of message attachments (images, files, etc.)
	 * @returns {ApiChatMessageData} object formatted for the chat completion API
	 * @static
	 */
	static convertMessageToChatServiceData(
		message: DatabaseMessage & { extra?: DatabaseMessageExtra[] }
	): ApiChatMessageData {
		if (!message.extra || message.extra.length === 0) {
			return {
				role: message.role as 'user' | 'assistant' | 'system',
				content: message.content
			};
		}

		const contentParts: ApiChatMessageContentPart[] = [];

		if (message.content) {
			contentParts.push({
				type: 'text',
				text: message.content
			});
		}

		const imageFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraImageFile =>
				extra.type === 'imageFile'
		);

		for (const image of imageFiles) {
			contentParts.push({
				type: 'image_url',
				image_url: { url: image.base64Url }
			});
		}

		const textFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraTextFile =>
				extra.type === 'textFile'
		);

		for (const textFile of textFiles) {
			contentParts.push({
				type: 'text',
				text: `\n\n--- File: ${textFile.name} ---\n${textFile.content}`
			});
		}

		// Handle legacy 'context' type from old webui (pasted content)
		const legacyContextFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraLegacyContext =>
				extra.type === 'context'
		);

		for (const legacyContextFile of legacyContextFiles) {
			contentParts.push({
				type: 'text',
				text: `\n\n--- File: ${legacyContextFile.name} ---\n${legacyContextFile.content}`
			});
		}

		const audioFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraAudioFile =>
				extra.type === 'audioFile'
		);

		for (const audio of audioFiles) {
			contentParts.push({
				type: 'input_audio',
				input_audio: {
					data: audio.base64Data,
					format: audio.mimeType.includes('wav') ? 'wav' : 'mp3'
				}
			});
		}

		const pdfFiles = message.extra.filter(
			(extra: DatabaseMessageExtra): extra is DatabaseMessageExtraPdfFile =>
				extra.type === 'pdfFile'
		);

		for (const pdfFile of pdfFiles) {
			if (pdfFile.processedAsImages && pdfFile.images) {
				for (let i = 0; i < pdfFile.images.length; i++) {
					contentParts.push({
						type: 'image_url',
						image_url: { url: pdfFile.images[i] }
					});
				}
			} else {
				contentParts.push({
					type: 'text',
					text: `\n\n--- PDF File: ${pdfFile.name} ---\n${pdfFile.content}`
				});
			}
		}

		return {
			role: message.role as 'user' | 'assistant' | 'system',
			content: contentParts
		};
	}

	/**
	 * Get server properties - static method for API compatibility
	 */
	static async getServerProps(): Promise<ApiLlamaCppServerProps> {
		try {
			const currentConfig = config();
			const apiKey = currentConfig.apiKey?.toString().trim();
			const apiBaseUrl = currentConfig.apiBaseUrl?.toString().trim() || '.';

			const response = await fetch(`${apiBaseUrl}/props`, {
				headers: {
					'Content-Type': 'application/json',
					...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
				}
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch server props: ${response.status}`);
			}

			const data = await response.json();
			return data;
		} catch (error) {
			console.error('Error fetching server props:', error);
			throw error;
		}
	}

	/**
	 * Aborts any ongoing chat completion request.
	 * Cancels the current request and cleans up the abort controller.
	 *
	 * @public
	 */
	public abort(conversationId?: string): void {
		if (conversationId) {
			const abortController = this.abortControllers.get(conversationId);
			if (abortController) {
				abortController.abort();
				this.abortControllers.delete(conversationId);
			}
		} else {
			for (const controller of this.abortControllers.values()) {
				controller.abort();
			}
			this.abortControllers.clear();
		}
	}

	/**
	 * Injects a system message at the beginning of the conversation if configured in settings.
	 * Checks for existing system messages to avoid duplication and retrieves the system message
	 * from the current configuration settings.
	 *
	 * @param messages - Array of chat messages to process
	 * @returns Array of messages with system message injected at the beginning if configured
	 * @private
	 */
	private injectSystemMessage(messages: ApiChatMessageData[]): ApiChatMessageData[] {
		const currentConfig = config();
		const systemMessage = currentConfig.systemMessage?.toString().trim();

		if (!systemMessage) {
			return messages;
		}

		if (messages.length > 0 && messages[0].role === 'system') {
			if (messages[0].content !== systemMessage) {
				const updatedMessages = [...messages];
				updatedMessages[0] = {
					role: 'system',
					content: systemMessage
				};
				return updatedMessages;
			}

			return messages;
		}

		const systemMsg: ApiChatMessageData = {
			role: 'system',
			content: systemMessage
		};

		return [systemMsg, ...messages];
	}

	/**
	 * Parses error response and creates appropriate error with context information
	 * @param response - HTTP response object
	 * @returns Promise<Error> - Parsed error with context info if available
	 */
	private async parseErrorResponse(response: Response): Promise<Error> {
		try {
			const errorText = await response.text();
			console.error('Error response text:', errorText);
			const errorData: ApiErrorResponse = JSON.parse(errorText);

			const message = errorData.error?.message || errorData.message || errorText || 'Unknown server error';
			const error = new Error(message);
			error.name = response.status === 400 ? 'ServerError' : 'HttpError';

			return error;
		} catch (e) {
			console.error('Failed to parse error response:', e);
			const fallback = new Error(`Server error (${response.status}): ${response.statusText}`);
			fallback.name = 'HttpError';
			return fallback;
		}
	}

	private extractModelName(data: unknown): string | undefined {
		const asRecord = (value: unknown): Record<string, unknown> | undefined => {
			return typeof value === 'object' && value !== null
				? (value as Record<string, unknown>)
				: undefined;
		};

		const getTrimmedString = (value: unknown): string | undefined => {
			return typeof value === 'string' && value.trim() ? value.trim() : undefined;
		};

		const root = asRecord(data);
		if (!root) return undefined;

		// 1) root (some implementations provide `model` at the top level)
		const rootModel = getTrimmedString(root.model);
		if (rootModel) return rootModel;

		// 2) streaming choice (delta) or final response (message)
		const firstChoice = Array.isArray(root.choices) ? asRecord(root.choices[0]) : undefined;
		if (!firstChoice) return undefined;

		// priority: delta.model (first chunk) else message.model (final response)
		const deltaModel = getTrimmedString(asRecord(firstChoice.delta)?.model);
		if (deltaModel) return deltaModel;

		const messageModel = getTrimmedString(asRecord(firstChoice.message)?.model);
		if (messageModel) return messageModel;

		// avoid guessing from non-standard locations (metadata, etc.)
		return undefined;
	}

	private updateProcessingState(
		timings?: ChatMessageTimings,
		promptProgress?: ChatMessagePromptProgress,
		conversationId?: string
	): void {
		const tokensPerSecond =
			timings?.predicted_ms && timings?.predicted_n
				? (timings.predicted_n / timings.predicted_ms) * 1000
				: 0;

		slotsService
			.updateFromTimingData(
				{
					prompt_n: timings?.prompt_n || 0,
					predicted_n: timings?.predicted_n || 0,
					predicted_per_second: tokensPerSecond,
					cache_n: timings?.cache_n || 0,
					prompt_progress: promptProgress
				},
				conversationId
			)
			.catch((error) => {
				console.warn('Failed to update processing state:', error);
			});
	}

	/**
	 * Generates an image using the /v1/openai/images/generations endpoint
	 * @param prompt - The text prompt for image generation
	 * @param options - Image generation options (size, n, model)
	 * @returns Promise<string> - Base64 encoded image data
	 */
	async generateImage(
		prompt: string,
		options: {
			size?: string;
			n?: number;
			model?: string;
		} = {}
	): Promise<string> {
		const currentConfig = config();
		const apiKey = currentConfig.apiKey?.toString().trim();
		let apiBaseUrl = currentConfig.apiBaseUrl?.toString().trim() || '.';

		// Remove trailing slash
		if (apiBaseUrl !== '.' && apiBaseUrl.endsWith('/')) {
			apiBaseUrl = apiBaseUrl.slice(0, -1);
		}

		const isExternalApi = apiBaseUrl !== '.' && !apiBaseUrl.startsWith('/') &&
			(apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://'));

		// Build the image generation endpoint
		const imageEndpoint = isExternalApi
			? `${apiBaseUrl}/images/generations`
			: './v1/openai/images/generations';

		const requestBody: any = {
			prompt,
			size: options.size || '1024x1024',
			n: options.n || 1
		};

		const modelSelectorEnabled = Boolean(currentConfig.modelSelectorEnabled);
		const activeModel = modelSelectorEnabled ? selectedModelName() : null;

		if (options.model) {
			requestBody.model = options.model;
		} else if (modelSelectorEnabled && activeModel) {
			requestBody.model = activeModel;
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};

		if (apiKey && apiKey.length > 0) {
			headers.Authorization = `Bearer ${apiKey}`;
		}

		try {
			const response = await fetch(imageEndpoint, {
				method: 'POST',
				headers,
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				const errorText = await response.text();
				let errorMessage = `Image generation failed: ${response.status} ${response.statusText}`;

				try {
					const errorData = JSON.parse(errorText);
					if (errorData.error?.message) {
						errorMessage = errorData.error.message;
					} else if (errorData.message) {
						errorMessage = errorData.message;
					}
				} catch {
					// If error is not JSON, use the text directly
					if (errorText) {
						errorMessage = errorText;
					}
				}

				throw new Error(errorMessage);
			}

			const data = await response.json();

			// Extract base64 image from response
			if (data.data && data.data.length > 0 && data.data[0].b64_json) {
				return data.data[0].b64_json;
			} else if (data.data && data.data.length > 0 && data.data[0].url) {
				// Some APIs return URLs instead of base64
				return data.data[0].url;
			} else {
				throw new Error('No image data in response');
			}
		} catch (error) {
			console.error('Image generation error:', error);
			throw error;
		}
	}
}

export const chatService = new ChatService();
