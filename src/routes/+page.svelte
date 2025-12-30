<script lang="ts">
	import { ChatScreen } from '$lib/components/app';
	import { chatStore, isInitialized } from '$lib/stores/chat.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	let qParam = $derived(page.url.searchParams.get('q'));

	onMount(async () => {
		if (!isInitialized) {
			await chatStore.initialize();
		}

		chatStore.clearActiveConversation();

		if (qParam !== null) {
			await chatStore.createConversation();

			// Get the paste threshold setting
			const currentConfig = config();
			const pasteLongTextToFileLength = Number(currentConfig.pasteLongTextToFileLen) || 2500;

			// Check if text exceeds threshold - if so, convert to file
			if (
				qParam.length > 0 &&
				pasteLongTextToFileLength > 0 &&
				qParam.length > pasteLongTextToFileLength
			) {
				// Import required utilities dynamically
				const { parseFilesToMessageExtras } = await import('$lib/utils/convert-files-to-extra');
				const { processFilesToChatUploaded } = await import('$lib/utils/process-uploaded-files');
				const { MimeTypeText } = await import('$lib/enums/files');

				// Create a file from the summarize text
				const textFile = new File([qParam], 'Summarize Request', {
					type: MimeTypeText.PLAIN
				});

				// Process the file to ChatUploadedFile format
				const uploadedFiles = await processFilesToChatUploaded([textFile]);

				// Convert to message extras
				const result = await parseFilesToMessageExtras(uploadedFiles);

				// Send as file attachment with empty message
				await chatStore.sendMessage('', result?.extras);
			} else {
				// Text is below threshold - send normally
				await chatStore.sendMessage(qParam);
			}
		}
	});
</script>

<svelte:head>
	<title>llama.cpp - AI Chat Interface</title>
</svelte:head>

<ChatScreen showCenteredEmpty={true} />
