<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Trash2, CheckSquare } from '@lucide/svelte';
	import { ChatSidebarConversationItem, DialogConfirmation } from '$lib/components/app';
	import ScrollArea from '$lib/components/ui/scroll-area/scroll-area.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import Input from '$lib/components/ui/input/input.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import {
		conversations,
		deleteConversation,
		deleteMultipleConversations,
		updateConversationName
	} from '$lib/stores/chat.svelte';
	import { DatabaseStore } from '$lib/stores/database';
	import { chatService } from '$lib/services';
	import ChatSidebarActions from './ChatSidebarActions.svelte';

	const sidebar = Sidebar.useSidebar();

	let currentChatId = $derived(page.params.id);
	let isSearchModeActive = $state(false);
	let searchQuery = $state('');
	let showDeleteDialog = $state(false);
	let showEditDialog = $state(false);
	let showGenerateTitleDialog = $state(false);
	let selectedConversation = $state<DatabaseConversation | null>(null);
	let editedName = $state('');
	let generatedTitle = $state('');
	let isGeneratingTitle = $state(false);
	let isSelectionMode = $state(false);
	let selectedConversationIds = $state<Set<string>>(new Set());

	let filteredConversations = $derived.by(() => {
		if (searchQuery.trim().length > 0) {
			return conversations().filter((conversation: { name: string }) =>
				conversation.name.toLowerCase().includes(searchQuery.toLowerCase())
			);
		}

		return conversations();
	});

	function toggleSelectionMode() {
		isSelectionMode = !isSelectionMode;
		if (!isSelectionMode) {
			selectedConversationIds.clear();
		}
	}

	function toggleConversationSelection(id: string) {
		const newSet = new Set(selectedConversationIds);
		if (newSet.has(id)) {
			newSet.delete(id);
		} else {
			newSet.add(id);
		}
		selectedConversationIds = newSet; // Trigger reactivity by creating new Set
	}

	function handleDeleteMultiple() {
		if (selectedConversationIds.size > 0) {
			showDeleteDialog = true;
		}
	}

	async function handleDeleteConversation(id: string) {
		const conversation = conversations().find((conv) => conv.id === id);
		if (conversation) {
			selectedConversation = conversation;
			showDeleteDialog = true;
		}
	}

	async function handleEditConversation(id: string) {
		const conversation = conversations().find((conv) => conv.id === id);
		if (conversation) {
			selectedConversation = conversation;
			editedName = conversation.name;
			showEditDialog = true;
		}
	}

	async function handleGenerateTitle(id: string) {
		const conversation = conversations().find((conv) => conv.id === id);
		if (!conversation) return;

		try {
			selectedConversation = conversation;
			isGeneratingTitle = true;
			showGenerateTitleDialog = true;
			generatedTitle = 'Generating...';

			// Get all messages from the conversation
			const messages = await DatabaseStore.getConversationMessages(id);

			// Filter to only user and assistant messages (exclude root messages)
			const chatMessages = messages.filter(
				(m) => m.role === 'user' || m.role === 'assistant'
			);

			if (chatMessages.length === 0) {
				generatedTitle = conversation.name;
				isGeneratingTitle = false;
				return;
			}

			// Extract context for title generation
			let contextMessages: typeof chatMessages = [];

			if (chatMessages.length <= 6) {
				// If conversation is short, use all messages
				contextMessages = chatMessages;
			} else {
				// For longer conversations, sample from beginning, middle, and end
				const firstTwo = chatMessages.slice(0, 2);
				const middleIndex = Math.floor(chatMessages.length / 2);
				const middleTwo = chatMessages.slice(middleIndex - 1, middleIndex + 1);
				const lastTwo = chatMessages.slice(-2);
				contextMessages = [...firstTwo, ...middleTwo, ...lastTwo];
			}

			// Format messages for the prompt
			const conversationContext = contextMessages
				.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 500)}`)
				.join('\n');

			// Create the title generation prompt
			const titlePrompt = [
				{
					role: 'user' as const,
					content: `Based on the following conversation, generate a concise and descriptive title (maximum 60 characters).

IMPORTANT: Start the title with a single relevant emoji that represents the topic or theme of the conversation.

Examples:
- "💻 Python debugging techniques"
- "🍕 Italian recipe recommendations"
- "📊 Data analysis best practices"
- "🚀 Space exploration facts"
- "💡 Creative writing tips"

Only respond with the title (emoji + text), nothing else.

Conversation:
${conversationContext}

Title:`
				}
			];

			// Call LLM to generate title
			const response = await chatService.sendMessage(titlePrompt, {
				stream: false,
				temperature: 0.7,
				max_tokens: 50
			});

			if (typeof response === 'string') {
				// Clean up the response
				let title = response.trim();
				// Remove quotes if present
				title = title.replace(/^["']|["']$/g, '');
				// Truncate to 60 characters if needed
				title = title.slice(0, 60);
				generatedTitle = title || conversation.name;
			} else {
				generatedTitle = conversation.name;
			}

			isGeneratingTitle = false;
		} catch (error) {
			console.error('Failed to generate title:', error);
			generatedTitle = conversation.name;
			isGeneratingTitle = false;
		}
	}

	async function handleConfirmDelete() {
		if (selectedConversationIds.size > 0) {
			// Bulk delete
			showDeleteDialog = false;

			setTimeout(async () => {
				try {
					await deleteMultipleConversations(Array.from(selectedConversationIds));
					selectedConversationIds.clear();
					isSelectionMode = false;
				} catch (error) {
					console.error('Failed to delete multiple conversations:', error);
				}
			}, 100); // Wait for animation to finish
		} else if (selectedConversation) {
			// Single delete
			showDeleteDialog = false;

			setTimeout(() => {
				deleteConversation(selectedConversation.id);
				selectedConversation = null;
			}, 100); // Wait for animation to finish
		}
	}

	function handleConfirmEdit() {
		if (!editedName.trim() || !selectedConversation) return;

		showEditDialog = false;

		updateConversationName(selectedConversation.id, editedName);
		selectedConversation = null;
	}

	function handleConfirmGeneratedTitle() {
		if (!generatedTitle.trim() || !selectedConversation) return;

		showGenerateTitleDialog = false;

		updateConversationName(selectedConversation.id, generatedTitle);
		selectedConversation = null;
		generatedTitle = '';
	}

	export function handleMobileSidebarItemClick() {
		if (sidebar.isMobile) {
			sidebar.toggle();
		}
	}

	export function activateSearchMode() {
		isSearchModeActive = true;
	}

	export function editActiveConversation() {
		if (currentChatId) {
			const activeConversation = filteredConversations.find((conv) => conv.id === currentChatId);

			if (activeConversation) {
				const event = new CustomEvent('edit-active-conversation', {
					detail: { conversationId: currentChatId }
				});
				document.dispatchEvent(event);
			}
		}
	}

	async function selectConversation(id: string) {
		if (isSelectionMode) {
			toggleConversationSelection(id);
			return;
		}

		if (isSearchModeActive) {
			isSearchModeActive = false;
			searchQuery = '';
		}

		await goto(`#/chat/${id}`);
	}

	function handleCancelDelete() {
		showDeleteDialog = false;
		if (selectedConversationIds.size === 0) {
			selectedConversation = null;
		}
	}
</script>

<ScrollArea class="h-[100vh]">
	<Sidebar.Header class=" top-0 z-10 gap-6 bg-sidebar/50 px-4 pt-4 pb-2 backdrop-blur-lg md:sticky">
		<a href="#/" onclick={handleMobileSidebarItemClick}>
			<div class="px-2">
				<h1 class="text-xl font-semibold">WebUI</h1>
				<p class="text-[10px] text-muted-foreground">modified from llama.cpp</p>
			</div>
		</a>

		<ChatSidebarActions {handleMobileSidebarItemClick} bind:isSearchModeActive bind:searchQuery />
	</Sidebar.Header>

	{#if isSelectionMode}
		<div
			class="sticky top-[72px] z-10 mx-4 mb-2 flex items-center justify-between rounded-lg bg-accent p-3"
		>
			<span class="text-sm font-medium">
				{selectedConversationIds.size} selected
			</span>
			<div class="flex gap-2">
				<Button
					variant="destructive"
					size="sm"
					onclick={handleDeleteMultiple}
					disabled={selectedConversationIds.size === 0}
				>
					<Trash2 class="h-4 w-4" />
					Delete
				</Button>
				<Button variant="outline" size="sm" onclick={toggleSelectionMode}>Cancel</Button>
			</div>
		</div>
	{/if}

	<Sidebar.Group class="mt-4 space-y-2 p-0 px-4">
		{#if (filteredConversations.length > 0 && isSearchModeActive) || !isSearchModeActive}
			<div class="mb-2 flex items-center justify-between px-2">
				<Sidebar.GroupLabel class="mb-0">
					{isSearchModeActive ? 'Search results' : 'Conversations'}
				</Sidebar.GroupLabel>
				{#if !isSelectionMode && conversations().length > 0}
					<Button
						variant="ghost"
						size="sm"
						onclick={toggleSelectionMode}
						class="h-7 px-2 text-xs"
					>
						<CheckSquare class="mr-1 h-3.5 w-3.5" />
						Select
					</Button>
				{/if}
			</div>
		{/if}

		<Sidebar.GroupContent>
			<Sidebar.Menu>
				{#each filteredConversations as conversation (conversation.id)}
					<Sidebar.MenuItem class="mb-1">
						<ChatSidebarConversationItem
							conversation={{
								id: conversation.id,
								name: conversation.name,
								lastModified: conversation.lastModified,
								currNode: conversation.currNode
							}}
							{handleMobileSidebarItemClick}
							isActive={currentChatId === conversation.id}
							onSelect={selectConversation}
							onEdit={handleEditConversation}
							onDelete={handleDeleteConversation}
							onGenerateTitle={handleGenerateTitle}
							{isSelectionMode}
							isSelected={selectedConversationIds.has(conversation.id)}
						/>
					</Sidebar.MenuItem>
				{/each}

				{#if filteredConversations.length === 0}
					<div class="px-2 py-4 text-center">
						<p class="mb-4 p-4 text-sm text-muted-foreground">
							{searchQuery.length > 0
								? 'No results found'
								: isSearchModeActive
									? 'Start typing to see results'
									: 'No conversations yet'}
						</p>
					</div>
				{/if}
			</Sidebar.Menu>
		</Sidebar.GroupContent>
	</Sidebar.Group>

	<div class="bottom-0 z-10 bg-sidebar bg-sidebar/50 px-4 py-4 backdrop-blur-lg md:sticky"></div>
</ScrollArea>

<DialogConfirmation
	bind:open={showDeleteDialog}
	title={selectedConversationIds.size > 0
		? `Delete ${selectedConversationIds.size} Conversations`
		: 'Delete Conversation'}
	description={selectedConversationIds.size > 0
		? `Are you sure you want to delete ${selectedConversationIds.size} conversation${selectedConversationIds.size > 1 ? 's' : ''}? This action cannot be undone and will permanently remove all messages in these conversations.`
		: selectedConversation
			? `Are you sure you want to delete "${selectedConversation.name}"? This action cannot be undone and will permanently remove all messages in this conversation.`
			: ''}
	confirmText="Delete"
	cancelText="Cancel"
	variant="destructive"
	icon={Trash2}
	onConfirm={handleConfirmDelete}
	onCancel={handleCancelDelete}
/>

<AlertDialog.Root bind:open={showEditDialog}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Edit Conversation Name</AlertDialog.Title>
			<AlertDialog.Description>
				<Input
					class="mt-4 text-foreground"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							handleConfirmEdit();
						}
					}}
					placeholder="Enter a new name"
					type="text"
					bind:value={editedName}
				/>
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				onclick={() => {
					showEditDialog = false;
					selectedConversation = null;
				}}>Cancel</AlertDialog.Cancel
			>
			<AlertDialog.Action onclick={handleConfirmEdit}>Save</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={showGenerateTitleDialog}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Generated Title</AlertDialog.Title>
			<AlertDialog.Description>
				<Input
					class="mt-4 text-foreground"
					onkeydown={(e) => {
						if (e.key === 'Enter' && !isGeneratingTitle) {
							e.preventDefault();
							handleConfirmGeneratedTitle();
						}
					}}
					placeholder="Generated title"
					type="text"
					bind:value={generatedTitle}
					disabled={isGeneratingTitle}
				/>
				{#if isGeneratingTitle}
					<p class="mt-2 text-sm text-muted-foreground">Generating title...</p>
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				onclick={() => {
					showGenerateTitleDialog = false;
					selectedConversation = null;
					generatedTitle = '';
				}}>Cancel</AlertDialog.Cancel
			>
			<AlertDialog.Action onclick={handleConfirmGeneratedTitle} disabled={isGeneratingTitle}
				>Save</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
