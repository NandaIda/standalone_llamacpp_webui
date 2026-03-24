<script lang="ts">
	import { ChatScreen } from '$lib/components/app';
	import { isInitialized, chatStore } from '$lib/stores/chat.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	let qParam = $derived(page.url.searchParams.get('q'));

	onMount(async () => {
		if (!isInitialized) {
			await chatStore.initialize();
		}

		if (qParam !== null && qParam.length > 0) {
			// Redirect to slug route which handles both new queries and existing conversations
			const slug = qParam
				.toLowerCase()
				.trim()
				.replace(/[^a-z0-9\s-]/g, '')
				.replace(/\s+/g, '-')
				.replace(/-+/g, '-')
				.slice(0, 60)
				.replace(/-$/, '');
			await goto(`#/search/${slug || 'query'}`, { replaceState: true });
		} else {
			await goto('#/', { replaceState: true });
		}
	});
</script>

<svelte:head>
	<title>Search - llama.cpp</title>
</svelte:head>

<ChatScreen showCenteredEmpty={true} />
