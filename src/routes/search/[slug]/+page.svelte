<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ChatScreen } from '$lib/components/app';
	import {
		chatStore,
		activeConversation,
		isLoading,
		stopGeneration,
		isInitialized
	} from '$lib/stores/chat.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { extractShortIdFromSlug, generateSearchSlug } from '$lib/utils/search-slug';
	import { DatabaseService } from '$lib/services/database.service';
	import { chatService } from '$lib/services';
	import { SEARCH_SYSTEM_PROMPT } from '$lib/constants/search-system-prompt';
	import { onDestroy } from 'svelte';

	// Keep search system prompt active while on this route
	chatService.systemPromptOverride = SEARCH_SYSTEM_PROMPT;
	onDestroy(() => {
		chatService.systemPromptOverride = null;
	});

	let slug = $derived(page.params.slug);
	let currentSlug: string | undefined = undefined;

	$effect(() => {
		if (slug && slug !== currentSlug) {
			currentSlug = slug;

			(async () => {
				if (!isInitialized) {
					await chatStore.initialize();
				}

				// Try to find an existing conversation by short ID (last 8 chars of slug)
				const shortId = extractShortIdFromSlug(slug);
				const existingConversation = await findConversationByShortId(shortId);

				if (existingConversation) {
					// Existing search conversation — load it
					if (activeConversation()?.id === existingConversation.id) {
						return;
					}
					const success = await chatStore.loadConversation(existingConversation.id);
					if (!success) {
						await goto('#/');
					}
				} else {
					// New search query — decode slug back to query text
					const query = decodeSearchQuery(slug);
					if (!query) {
						await goto('#/');
						return;
					}

					chatStore.clearActiveConversation();

					// Create conversation and navigate to the final slug URL
					const convId = await chatStore.createConversation(
						query.slice(0, 100),
						(id) => `#/search/${generateSearchSlug(query, id)}`
					);

					// Update currentSlug to the new one so we don't re-trigger
					currentSlug = generateSearchSlug(query, convId);

					// Send the query
					const currentConfig = config();
					const threshold = Number(currentConfig.pasteLongTextToFileLen) || 2500;

					if (threshold > 0 && query.length > threshold) {
						const { parseFilesToMessageExtras } = await import(
							'$lib/utils/convert-files-to-extra'
						);
						const { processFilesToChatUploaded } = await import(
							'$lib/utils/process-uploaded-files'
						);
						const { MimeTypeText } = await import('$lib/enums/files');

						const textFile = new File([query], 'Search Query', {
							type: MimeTypeText.PLAIN
						});
						const uploadedFiles = await processFilesToChatUploaded([textFile]);
						const result = await parseFilesToMessageExtras(uploadedFiles);
						await chatStore.sendMessage('', result?.extras);
					} else {
						await chatStore.sendMessage(query);
					}
				}
			})();
		}
	});

	/**
	 * Decode a slug back to a human-readable query.
	 * "trump-ultimatum" → "trump ultimatum"
	 */
	function decodeSearchQuery(slug: string): string {
		return decodeURIComponent(slug)
			.replace(/-/g, ' ')
			.trim();
	}

	async function findConversationByShortId(shortId: string): Promise<{ id: string } | null> {
		const conversations = await DatabaseService.getAllConversations();
		return conversations.find((c) => c.id.startsWith(shortId)) || null;
	}

	$effect(() => {
		if (typeof window !== 'undefined') {
			const handleBeforeUnload = () => {
				if (isLoading()) {
					stopGeneration();
				}
			};

			window.addEventListener('beforeunload', handleBeforeUnload);

			return () => {
				window.removeEventListener('beforeunload', handleBeforeUnload);
			};
		}
	});
</script>

<svelte:head>
	<title>{activeConversation()?.name || 'Search'} - llama.cpp</title>
</svelte:head>

<ChatScreen />
