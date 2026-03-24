<script lang="ts">
	import { ChatScreen } from '$lib/components/app';
	import { chatStore, isInitialized } from '$lib/stores/chat.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { generateSearchSlug } from '$lib/utils/search-slug';
	import { SEARCH_SYSTEM_PROMPT } from '$lib/constants/search-system-prompt';
	import { chatService } from '$lib/services';
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	let qParam = $derived(page.url.searchParams.get('q'));

	onDestroy(() => {
		chatService.systemPromptOverride = null;
	});

	onMount(async () => {
		if (!isInitialized) {
			await chatStore.initialize();
		}

		chatStore.clearActiveConversation();

		if (qParam !== null && qParam.length > 0) {
			// Create conversation and navigate directly to search slug URL
			const tempName = qParam.slice(0, 100);
			const convId = await chatStore.createConversation(
				tempName,
				(id) => `#/search/${generateSearchSlug(qParam!, id)}`
			);

			// Set search-specific system prompt for this conversation
			chatService.systemPromptOverride = SEARCH_SYSTEM_PROMPT;

			// Get the paste threshold setting
			const currentConfig = config();
			const pasteLongTextToFileLength = Number(currentConfig.pasteLongTextToFileLen) || 2500;

			// Check if text exceeds threshold - if so, convert to file
			if (pasteLongTextToFileLength > 0 && qParam.length > pasteLongTextToFileLength) {
				const { parseFilesToMessageExtras } = await import('$lib/utils/convert-files-to-extra');
				const { processFilesToChatUploaded } = await import('$lib/utils/process-uploaded-files');
				const { MimeTypeText } = await import('$lib/enums/files');

				const textFile = new File([qParam], 'Search Query', { type: MimeTypeText.PLAIN });
				const uploadedFiles = await processFilesToChatUploaded([textFile]);
				const result = await parseFilesToMessageExtras(uploadedFiles);
				await chatStore.sendMessage('', result?.extras);
			} else {
				await chatStore.sendMessage(qParam);
			}
		} else {
			// No query — redirect to home
			await goto('#/', { replaceState: true });
		}
	});
</script>

<svelte:head>
	<title>{qParam ? `${qParam} - Search` : 'Search'} - llama.cpp</title>
</svelte:head>

<ChatScreen showCenteredEmpty={true} />
