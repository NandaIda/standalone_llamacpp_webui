<script lang="ts">
	import autoResizeTextarea from '$lib/utils/autoresize-textarea';
	import { onMount } from 'svelte';

	interface Props {
		class?: string;
		disabled?: boolean;
		onKeydown?: (event: KeyboardEvent) => void;
		onPaste?: (event: ClipboardEvent) => void;
		onPasteDetected?: (pastedText: string) => boolean; // Returns true if handled (text should be removed)
		placeholder?: string;
		value?: string;
	}

	let {
		class: className = '',
		disabled = false,
		onKeydown,
		onPaste,
		onPasteDetected,
		placeholder = 'Ask anything...',
		value = $bindable('')
	}: Props = $props();

	let textareaElement: HTMLTextAreaElement | undefined;
	let previousValue = '';

	onMount(() => {
		if (textareaElement) {
			textareaElement.focus();
			previousValue = value || '';
		}
	});

	function handleInput(event: Event & { inputType?: string }) {
		const target = event.currentTarget as HTMLTextAreaElement;
		autoResizeTextarea(target);

		// Fallback for Android: detect paste via inputType or large text insertion
		if (onPasteDetected && textareaElement) {
			const currentValue = textareaElement.value;
			const valueDiff = currentValue.length - previousValue.length;

			// Check if this was a paste operation via inputType (supported in modern browsers)
			// or if a large amount of text was added (likely a paste)
			const isPasteOperation = event.inputType === 'insertFromPaste' ||
			                        event.inputType === 'insertFromPasteAsQuotation' ||
			                        valueDiff > 50;

			if (isPasteOperation && valueDiff > 0) {
				// Get the pasted text
				const pastedText = currentValue.substring(
					Math.max(0, previousValue.length),
					previousValue.length + valueDiff
				);

				// Call the paste detection handler
				const wasHandled = onPasteDetected(pastedText);

				if (wasHandled) {
					// If the paste was handled (converted to file), remove the pasted text
					value = previousValue;
					textareaElement.value = previousValue;
					return; // Don't update previousValue since we reverted
				}
			}

			previousValue = currentValue;
		} else {
			// Update previous value even if no paste detection
			if (textareaElement) {
				previousValue = textareaElement.value;
			}
		}
	}

	// Expose the textarea element for external access
	export function getElement() {
		return textareaElement;
	}

	export function focus() {
		textareaElement?.focus();
	}

	export function resetHeight() {
		if (textareaElement) {
			textareaElement.style.height = '1rem';
		}
	}
</script>

<div class="flex-1 {className}">
	<textarea
		bind:this={textareaElement}
		bind:value
		class="text-md max-h-32 min-h-12 w-full resize-none border-0 bg-transparent p-0 leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
		class:cursor-not-allowed={disabled}
		{disabled}
		onkeydown={onKeydown}
		oninput={handleInput}
		onpaste={onPaste}
		{placeholder}
	></textarea>
</div>
