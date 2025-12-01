<script lang="ts">
	import { Trash2, Pencil, MoreHorizontal, Download, Loader2, Sparkles, Image } from '@lucide/svelte';
	import { ActionDropdown } from '$lib/components/app';
	import { downloadConversation, getAllLoadingConversations } from '$lib/stores/chat.svelte';
	import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
	import { onMount } from 'svelte';

	interface Props {
		isActive?: boolean;
		conversation: DatabaseConversation;
		handleMobileSidebarItemClick?: () => void;
		onDelete?: (id: string) => void;
		onEdit?: (id: string) => void;
		onSelect?: (id: string) => void;
		onGenerateTitle?: (id: string) => void;
		isSelectionMode?: boolean;
		isSelected?: boolean;
		isImageGeneration?: boolean;
	}

	let {
		conversation,
		handleMobileSidebarItemClick,
		onDelete,
		onEdit,
		onSelect,
		onGenerateTitle,
		isActive = false,
		isSelectionMode = false,
		isSelected = false,
		isImageGeneration = false
	}: Props = $props();

	let renderActionsDropdown = $state(false);
	let dropdownOpen = $state(false);

	let isLoading = $derived(getAllLoadingConversations().includes(conversation.id));

	function handleEdit(event: Event) {
		event.stopPropagation();
		onEdit?.(conversation.id);
	}

	function handleDelete(event: Event) {
		event.stopPropagation();
		onDelete?.(conversation.id);
	}

	function handleGenerateTitle(event: Event) {
		event.stopPropagation();
		onGenerateTitle?.(conversation.id);
	}

	function handleGlobalEditEvent(event: Event) {
		const customEvent = event as CustomEvent<{ conversationId: string }>;
		if (customEvent.detail.conversationId === conversation.id && isActive) {
			handleEdit(event);
		}
	}

	function handleMouseLeave() {
		if (!dropdownOpen) {
			renderActionsDropdown = false;
		}
	}

	function handleMouseOver() {
		renderActionsDropdown = true;
	}

	function handleSelect() {
		onSelect?.(conversation.id);
	}

	$effect(() => {
		if (!dropdownOpen) {
			renderActionsDropdown = false;
		}
	});

	onMount(() => {
		document.addEventListener('edit-active-conversation', handleGlobalEditEvent as EventListener);

		return () => {
			document.removeEventListener(
				'edit-active-conversation',
				handleGlobalEditEvent as EventListener
			);
		};
	});
</script>

<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<button
	class="group flex min-h-9 w-full cursor-pointer items-center justify-between space-x-3 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-foreground/10 {isActive &&
	!isSelectionMode
		? 'bg-foreground/5 text-accent-foreground'
		: ''} {isSelected ? 'bg-accent' : ''}"
	onclick={handleSelect}
	onmouseover={handleMouseOver}
	onmouseleave={handleMouseLeave}
>
	<div class="flex min-w-0 flex-1 items-center gap-2">
		{#if isSelectionMode}
			<div class="pointer-events-none">
				<Checkbox checked={isSelected} />
			</div>
		{:else if isLoading}
			<Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
		{:else if isImageGeneration}
			<Image class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
		{/if}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<span class="truncate text-sm font-medium" onclick={handleMobileSidebarItemClick}>
			{conversation.name}
		</span>
	</div>

	{#if !isSelectionMode && renderActionsDropdown}
		<div class="actions flex items-center">
			<ActionDropdown
				triggerIcon={MoreHorizontal}
				triggerTooltip="More actions"
				bind:open={dropdownOpen}
				actions={[
					{
						icon: Pencil,
						label: 'Edit',
						onclick: handleEdit,
						shortcut: ['shift', 'cmd', 'e']
					},
					{
						icon: Sparkles,
						label: 'Generate Title',
						onclick: handleGenerateTitle
					},
					{
						icon: Download,
						label: 'Export',
						onclick: (e) => {
							e.stopPropagation();
							downloadConversation(conversation.id);
						},
						shortcut: ['shift', 'cmd', 's']
					},
					{
						icon: Trash2,
						label: 'Delete',
						onclick: handleDelete,
						variant: 'destructive',
						shortcut: ['shift', 'cmd', 'd'],
						separator: true
					}
				]}
			/>
		</div>
	{/if}
</button>

<style>
	button {
		:global([data-slot='dropdown-menu-trigger']:not([data-state='open'])) {
			opacity: 0;
		}

		&:is(:hover) :global([data-slot='dropdown-menu-trigger']) {
			opacity: 1;
		}
		@media (max-width: 768px) {
			:global([data-slot='dropdown-menu-trigger']) {
				opacity: 1 !important;
			}
		}
	}
</style>
