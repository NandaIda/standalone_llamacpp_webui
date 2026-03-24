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
	import { extractShortIdFromSlug } from '$lib/utils/search-slug';
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

				const shortId = extractShortIdFromSlug(slug);

				// If this conversation is already active and matches, skip loading
				if (activeConversation()?.id.startsWith(shortId)) {
					return;
				}

				// Find conversation by short ID prefix
				const conversation = await findConversationByShortId(shortId);

				if (conversation) {
					const success = await chatStore.loadConversation(conversation.id);
					if (!success) {
						await goto('#/');
					}
				} else {
					await goto('#/');
				}
			})();
		}
	});

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
