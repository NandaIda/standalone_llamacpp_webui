<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { ChatSidebar, DialogConversationTitleUpdate } from '$lib/components/app';
	import {
		activeMessages,
		isLoading,
		setTitleUpdateConfirmationCallback
	} from '$lib/stores/chat.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { serverStore } from '$lib/stores/server.svelte';
	import { config, settingsStore } from '$lib/stores/settings.svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';
	import { goto } from '$app/navigation';

	let { children } = $props();

	let isChatRoute = $derived(page.route.id === '/chat/[id]');
	let isHomeRoute = $derived(page.route.id === '/');
	let isNewChatMode = $derived(page.url.searchParams.get('new_chat') === 'true');
	let showSidebarByDefault = $derived(activeMessages().length > 0 || isLoading());

	// Load persisted sidebar state from localStorage
	function loadSidebarState() {
		if (typeof window !== 'undefined') {
			const saved = localStorage.getItem('sidebarOpen');
			return saved ? saved === 'true' : false;
		}
		return false;
	}

	let sidebarOpen = $state(loadSidebarState());
	let userClosedSidebar = $state(!loadSidebarState()); // If sidebar was closed, user closed it
	let innerHeight = $state<number | undefined>();
	let chatSidebar:
		| { activateSearchMode?: () => void; editActiveConversation?: () => void }
		| undefined = $state();

	// Conversation title update dialog state
	let titleUpdateDialogOpen = $state(false);
	let titleUpdateCurrentTitle = $state('');
	let titleUpdateNewTitle = $state('');
	let titleUpdateResolve: ((value: boolean) => void) | null = null;

	// Global keyboard shortcuts
	function handleKeydown(event: KeyboardEvent) {
		const isCtrlOrCmd = event.ctrlKey || event.metaKey;

		if (isCtrlOrCmd && event.key === 'k') {
			event.preventDefault();
			if (chatSidebar?.activateSearchMode) {
				chatSidebar.activateSearchMode();
				sidebarOpen = true;
			}
		}

		if (isCtrlOrCmd && event.shiftKey && event.key === 'O') {
			event.preventDefault();
			goto('?new_chat=true#/');
		}

		if (event.shiftKey && isCtrlOrCmd && event.key === 'E') {
			event.preventDefault();

			if (chatSidebar?.editActiveConversation) {
				chatSidebar.editActiveConversation();
			}
		}
	}

	function handleTitleUpdateCancel() {
		titleUpdateDialogOpen = false;
		if (titleUpdateResolve) {
			titleUpdateResolve(false);
			titleUpdateResolve = null;
		}
	}

	function handleTitleUpdateConfirm() {
		titleUpdateDialogOpen = false;
		if (titleUpdateResolve) {
			titleUpdateResolve(true);
			titleUpdateResolve = null;
		}
	}

	let previousRoute = $state<string | null>(null);
	let isInitialized = $state(false);

	// Save sidebar state to localStorage whenever it changes
	$effect(() => {
		if (typeof window !== 'undefined' && isInitialized) {
			localStorage.setItem('sidebarOpen', String(sidebarOpen));
		}
	});

	$effect(() => {
		const currentRouteId = page.route.id;
		const routeChanged = previousRoute !== currentRouteId;

		if (!isInitialized) {
			// First load - just mark as initialized and respect the persisted state
			isInitialized = true;
			previousRoute = currentRouteId;
			return;
		}

		if (routeChanged) {
			// Route changed - apply automatic behavior based on route
			if (isHomeRoute && !isNewChatMode) {
				// Auto-collapse sidebar when navigating to home route (but not in new chat mode)
				sidebarOpen = false;
				userClosedSidebar = false; // Reset the flag when going to home
			} else if (isHomeRoute && isNewChatMode) {
				// Keep sidebar open in new chat mode only if user hasn't manually closed it
				if (!userClosedSidebar) {
					sidebarOpen = true;
				}
			} else if (isChatRoute) {
				// On chat routes, respect user's manual preference
				// Don't auto-open if user has explicitly closed the sidebar
				if (!userClosedSidebar) {
					sidebarOpen = true;
				}
			} else {
				// Other routes follow default behavior
				if (!userClosedSidebar) {
					sidebarOpen = showSidebarByDefault;
				}
			}

			previousRoute = currentRouteId;
		} else {
			// Route didn't change - this is a manual toggle by the user
			// Track user's preference
			if (!sidebarOpen) {
				userClosedSidebar = true;
			} else {
				userClosedSidebar = false;
			}
		}
	});

	// Initialize server properties on app load
	$effect(() => {
		serverStore.fetchServerProps();
	});

	// Sync settings when server props are loaded
	$effect(() => {
		const serverProps = serverStore.serverProps;

		if (serverProps?.default_generation_settings?.params) {
			settingsStore.syncWithServerDefaults();
		}
	});

	// Monitor API key changes and redirect to error page if removed or changed when required
	$effect(() => {
		const currentConfig = config();
		const apiKey = currentConfig.apiKey;
		const apiBaseUrl = currentConfig.apiBaseUrl?.toString().trim() || '.';

		// Check if using external API
		const isExternalApi = apiBaseUrl !== '.' && !apiBaseUrl.startsWith('/') &&
			(apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://'));

		// Skip API key check for external APIs
		if (isExternalApi) {
			return;
		}

		if (
			(page.route.id === '/' || page.route.id === '/chat/[id]') &&
			page.status !== 401 &&
			page.status !== 403
		) {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json'
			};

			if (apiKey && apiKey.trim() !== '') {
				headers.Authorization = `Bearer ${apiKey.trim()}`;
			}

			fetch(`./props`, { headers })
				.then((response) => {
					if (response.status === 401 || response.status === 403) {
						window.location.reload();
					}
				})
				.catch((e) => {
					console.error('Error checking API key:', e);
				});
		}
	});

	// Set up title update confirmation callback
	$effect(() => {
		setTitleUpdateConfirmationCallback(async (currentTitle: string, newTitle: string) => {
			return new Promise<boolean>((resolve) => {
				titleUpdateCurrentTitle = currentTitle;
				titleUpdateNewTitle = newTitle;
				titleUpdateResolve = resolve;
				titleUpdateDialogOpen = true;
			});
		});
	});
</script>

<ModeWatcher />

<Toaster richColors />

<DialogConversationTitleUpdate
	bind:open={titleUpdateDialogOpen}
	currentTitle={titleUpdateCurrentTitle}
	newTitle={titleUpdateNewTitle}
	onConfirm={handleTitleUpdateConfirm}
	onCancel={handleTitleUpdateCancel}
/>

<Sidebar.Provider bind:open={sidebarOpen}>
	<div class="flex h-screen w-full" style:height="{innerHeight}px">
		<Sidebar.Root class="h-full">
			<ChatSidebar bind:this={chatSidebar} />
		</Sidebar.Root>

		<Sidebar.Trigger
			class="transition-left absolute left-0 z-[900] h-8 w-8 duration-200 ease-linear {sidebarOpen
				? 'md:left-[var(--sidebar-width)]'
				: ''}"
			style="translate: 1rem 1rem;"
		/>

		<Sidebar.Inset class="flex flex-1 flex-col overflow-hidden">
			{@render children?.()}
		</Sidebar.Inset>
	</div>
</Sidebar.Provider>

<svelte:window onkeydown={handleKeydown} bind:innerHeight />
