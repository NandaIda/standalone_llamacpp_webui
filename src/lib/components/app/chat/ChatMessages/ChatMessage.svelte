<script lang="ts">
	import { getDeletionInfo } from '$lib/stores/chat.svelte';
	import { copyToClipboard } from '$lib/utils/copy';
	import { isIMEComposing } from '$lib/utils/is-ime-composing';
	import type { ApiChatCompletionToolCall } from '$lib/types/api';
	import ChatMessageAssistant from './ChatMessageAssistant.svelte';
	import ChatMessageUser from './ChatMessageUser.svelte';

	interface Props {
		class?: string;
		message: DatabaseMessage;
		onCopy?: (message: DatabaseMessage) => void;
		onContinueAssistantMessage?: (message: DatabaseMessage) => void;
		onDelete?: (message: DatabaseMessage) => void;
		onEditWithBranching?: (message: DatabaseMessage, newContent: string) => void;
		onEditWithReplacement?: (
			message: DatabaseMessage,
			newContent: string,
			shouldBranch: boolean
		) => void;
		onEditUserMessagePreserveResponses?: (message: DatabaseMessage, newContent: string) => void;
		onNavigateToSibling?: (siblingId: string) => void;
		onRegenerateWithBranching?: (message: DatabaseMessage) => void;
		siblingInfo?: ChatMessageSiblingInfo | null;
	}

	let {
		class: className = '',
		message,
		onCopy,
		onContinueAssistantMessage,
		onDelete,
		onEditWithBranching,
		onEditWithReplacement,
		onEditUserMessagePreserveResponses,
		onNavigateToSibling,
		onRegenerateWithBranching,
		siblingInfo = null
	}: Props = $props();

	let deletionInfo = $state<{
		totalCount: number;
		userMessages: number;
		assistantMessages: number;
		messageTypes: string[];
	} | null>(null);
	let editedContent = $state(message.content);
	let isEditing = $state(false);
	let showDeleteDialog = $state(false);
	let shouldBranchAfterEdit = $state(false);
	let textareaElement: HTMLTextAreaElement | undefined = $state();

	let thinkingContent = $derived.by(() => {
		if (message.role === 'assistant') {
			const trimmedThinking = message.thinking?.trim();

			return trimmedThinking ? trimmedThinking : null;
		}
		return null;
	});

	// Check if this is an image generation message
	let isImageGenerationMessage = $derived.by(() => {
		if (message.role === 'assistant' && message.extra && message.extra.length > 0) {
			return message.extra.some((extra: DatabaseMessageExtra) => extra.type === 'imageFile');
		}
		return false;
	});

	let toolCallContent = $derived.by((): ApiChatCompletionToolCall[] | string | null => {
		if (message.role === 'assistant') {
			const trimmedToolCalls = message.toolCalls?.trim();

			if (!trimmedToolCalls) {
				return null;
			}

			try {
				const parsed = JSON.parse(trimmedToolCalls);

				if (Array.isArray(parsed)) {
					return parsed as ApiChatCompletionToolCall[];
				}
			} catch {
				// Harmony-only path: fall back to the raw string so issues surface visibly.
			}

			return trimmedToolCalls;
		}
		return null;
	});

	function handleCancelEdit() {
		isEditing = false;
		editedContent = message.content;
	}

	async function handleCopy() {
		// If it's an image generation message, copy the image
		if (isImageGenerationMessage && message.extra && message.extra.length > 0) {
			const imageExtra = message.extra.find((extra: DatabaseMessageExtra) => extra.type === 'imageFile');
			if (imageExtra && imageExtra.type === 'imageFile') {
				try {
					const base64Data = imageExtra.base64Url;

					// Create an image element and load the base64 data
					const img = new Image();

					// Wait for image to load
					await new Promise<void>((resolve, reject) => {
						img.onload = () => resolve();
						img.onerror = () => reject(new Error('Failed to load image'));
						img.src = base64Data;
					});

					// Create canvas and draw image
					const canvas = document.createElement('canvas');
					canvas.width = img.width;
					canvas.height = img.height;
					const ctx = canvas.getContext('2d');

					if (!ctx) {
						throw new Error('Failed to get canvas context');
					}

					ctx.drawImage(img, 0, 0);

					// Convert canvas to blob
					const blob = await new Promise<Blob>((resolve, reject) => {
						canvas.toBlob(
							(blob) => {
								if (blob) {
									resolve(blob);
								} else {
									reject(new Error('Failed to convert canvas to blob'));
								}
							},
							'image/png'
						);
					});

					// Copy to clipboard
					if (navigator.clipboard && navigator.clipboard.write) {
						await navigator.clipboard.write([
							new ClipboardItem({
								'image/png': blob
							})
						]);

						// Show success message
						const toast = await import('svelte-sonner');
						toast.toast.success('Image copied to clipboard');
					} else {
						throw new Error('Clipboard API not available');
					}
				} catch (error) {
					console.error('Failed to copy image:', error);
					// Fallback: copy the base64 URL as text
					await copyToClipboard(imageExtra.base64Url, 'Image data copied as text (paste in browser URL to view)');
				}
			}
		} else {
			// Regular text copy
			await copyToClipboard(message.content, 'Message copied to clipboard');
		}
		onCopy?.(message);
	}

	function handleConfirmDelete() {
		onDelete?.(message);
		showDeleteDialog = false;
	}

	async function handleDelete() {
		deletionInfo = await getDeletionInfo(message.id);
		showDeleteDialog = true;
	}

	function handleEdit() {
		isEditing = true;
		editedContent = message.content;

		setTimeout(() => {
			if (textareaElement) {
				textareaElement.focus();
				textareaElement.setSelectionRange(
					textareaElement.value.length,
					textareaElement.value.length
				);
			}
		}, 0);
	}

	function handleEditedContentChange(content: string) {
		editedContent = content;
	}

	function handleEditKeydown(event: KeyboardEvent) {
		// Check for IME composition using isComposing property and keyCode 229 (specifically for IME composition on Safari)
		// This prevents saving edit when confirming IME word selection (e.g., Japanese/Chinese input)
		if (event.key === 'Enter' && !event.shiftKey && !isIMEComposing(event)) {
			event.preventDefault();
			handleSaveEdit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			handleCancelEdit();
		}
	}

	function handleRegenerate() {
		onRegenerateWithBranching?.(message);
	}

	function handleContinue() {
		onContinueAssistantMessage?.(message);
	}

	function handleSaveEdit() {
		if (message.role === 'user') {
			// For user messages, trim to avoid accidental whitespace
			onEditWithBranching?.(message, editedContent.trim());
		} else {
			// For assistant messages, preserve exact content including trailing whitespace
			// This is important for the Continue feature to work properly
			onEditWithReplacement?.(message, editedContent, shouldBranchAfterEdit);
		}

		isEditing = false;
		shouldBranchAfterEdit = false;
	}

	function handleSaveEditOnly() {
		if (message.role === 'user') {
			// For user messages, trim to avoid accidental whitespace
			onEditUserMessagePreserveResponses?.(message, editedContent.trim());
		}

		isEditing = false;
	}

	function handleShowDeleteDialogChange(show: boolean) {
		showDeleteDialog = show;
	}
</script>

{#if message.role === 'user'}
	<ChatMessageUser
		bind:textareaElement
		class={className}
		{deletionInfo}
		{editedContent}
		{isEditing}
		{message}
		onCancelEdit={handleCancelEdit}
		onConfirmDelete={handleConfirmDelete}
		onCopy={handleCopy}
		onDelete={handleDelete}
		onEdit={handleEdit}
		onEditKeydown={handleEditKeydown}
		onEditedContentChange={handleEditedContentChange}
		{onNavigateToSibling}
		onSaveEdit={handleSaveEdit}
		onSaveEditOnly={handleSaveEditOnly}
		onShowDeleteDialogChange={handleShowDeleteDialogChange}
		{showDeleteDialog}
		{siblingInfo}
	/>
{:else}
	<ChatMessageAssistant
		bind:textareaElement
		class={className}
		{deletionInfo}
		{editedContent}
		{isEditing}
		{message}
		messageContent={message.content}
		onCancelEdit={handleCancelEdit}
		onConfirmDelete={handleConfirmDelete}
		onContinue={handleContinue}
		onCopy={handleCopy}
		onDelete={handleDelete}
		onEdit={handleEdit}
		onEditKeydown={handleEditKeydown}
		onEditedContentChange={handleEditedContentChange}
		{onNavigateToSibling}
		onRegenerate={handleRegenerate}
		onSaveEdit={handleSaveEdit}
		onShowDeleteDialogChange={handleShowDeleteDialogChange}
		{shouldBranchAfterEdit}
		onShouldBranchAfterEditChange={(value) => (shouldBranchAfterEdit = value)}
		{showDeleteDialog}
		{siblingInfo}
		{thinkingContent}
		{toolCallContent}
		{isImageGenerationMessage}
	/>
{/if}
