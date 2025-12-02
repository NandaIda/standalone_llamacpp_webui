<script lang="ts">
	import { Square, ArrowUp, Image as ImageIcon } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		ChatFormActionFileAttachments,
		ChatFormActionRecord,
		ChatFormModelSelector
	} from '$lib/components/app';
	import { config, updateConfig, saveCurrentModelParams } from '$lib/stores/settings.svelte';
	import { toast } from 'svelte-sonner';
	import type { FileTypeCategory } from '$lib/enums/files';

	interface Props {
		canSend?: boolean;
		class?: string;
		disabled?: boolean;
		isLoading?: boolean;
		isRecording?: boolean;
		onFileUpload?: (fileType?: FileTypeCategory) => void;
		onMicClick?: () => void;
		onStop?: () => void;
	}

	let {
		canSend = false,
		class: className = '',
		disabled = false,
		isLoading = false,
		isRecording = false,
		onFileUpload,
		onMicClick,
		onStop
	}: Props = $props();

	let currentConfig = $derived(config());
	let imageGenerationMode = $derived(currentConfig.imageGenerationMode || false);

	function toggleImageGenerationMode() {
		const newMode = !imageGenerationMode;
		updateConfig('imageGenerationMode', newMode);
		saveCurrentModelParams();

		// Show toast notification when image generation mode is toggled
		if (newMode) {
			toast.success('Image Generation Mode enabled', {
				duration: 3000
			});
		} else {
			toast.success('Image Generation Mode disabled', {
				duration: 3000
			});
		}
	}
</script>

<div class="flex w-full items-center gap-2 {className}">
	<ChatFormActionFileAttachments class="mr-auto" {disabled} {onFileUpload} />

	<Button
		type="button"
		variant="ghost"
		size="icon"
		class="h-8 w-8 shrink-0 {imageGenerationMode ? 'bg-accent text-accent-foreground' : ''}"
		onclick={toggleImageGenerationMode}
		disabled={disabled || isLoading}
		title={imageGenerationMode ? 'Image Generation Mode (ON)' : 'Image Generation Mode (OFF)'}
	>
		<ImageIcon class="h-4 w-4" />
	</Button>

	{#if currentConfig.modelSelectorEnabled}
		<ChatFormModelSelector class="shrink-0" />
	{/if}

	{#if isLoading}
		<Button
			type="button"
			onclick={onStop}
			class="h-8 w-8 bg-transparent p-0 hover:bg-destructive/20"
		>
			<span class="sr-only">Stop</span>
			<Square class="h-8 w-8 fill-destructive stroke-destructive" />
		</Button>
	{:else}
		<ChatFormActionRecord {disabled} {isLoading} {isRecording} {onMicClick} />

		<Button
			type="submit"
			disabled={!canSend || disabled || isLoading}
			class="h-8 w-8 rounded-full p-0"
		>
			<span class="sr-only">Send</span>
			<ArrowUp class="h-12 w-12" />
		</Button>
	{/if}
</div>
