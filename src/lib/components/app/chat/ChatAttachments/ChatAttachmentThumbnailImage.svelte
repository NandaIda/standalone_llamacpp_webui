<script lang="ts">
	import { RemoveButton } from '$lib/components/app';
	import { Download } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		id: string;
		name: string;
		preview: string;
		readonly?: boolean;
		onRemove?: (id: string) => void;
		onClick?: (event?: MouseEvent) => void;
		class?: string;
		// Customizable size props
		width?: string;
		height?: string;
		imageClass?: string;
	}

	let {
		id,
		name,
		preview,
		readonly = false,
		onRemove,
		onClick,
		class: className = '',
		// Default to small size for form previews
		width = 'w-auto',
		height = 'h-16',
		imageClass = ''
	}: Props = $props();

	function downloadImage(event: MouseEvent) {
		event.stopPropagation();
		event.preventDefault();

		// Create a temporary link element
		const link = document.createElement('a');
		link.href = preview;
		link.download = name || 'generated-image.png';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}
</script>

<div class="group relative overflow-hidden rounded-lg border border-border bg-muted {className}">
	{#if onClick}
		<button
			type="button"
			class="block h-full w-full rounded-lg focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:outline-none"
			onclick={onClick}
			aria-label="Preview {name}"
		>
			<img
				src={preview}
				alt={name}
				class="{height} {width} cursor-pointer object-cover {imageClass}"
			/>
		</button>
	{:else}
		<img
			src={preview}
			alt={name}
			class="{height} {width} cursor-pointer object-cover {imageClass}"
		/>
	{/if}

	<div
		class="absolute top-1 right-1 flex items-center gap-1 transition-opacity {readonly
			? 'opacity-100'
			: 'opacity-0 group-hover:opacity-100'}"
	>
		{#if readonly}
			<Button
				type="button"
				size="icon"
				variant="secondary"
				class="h-7 w-7 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background"
				onclick={downloadImage}
				aria-label="Download {name}"
			>
				<Download class="h-4 w-4" />
			</Button>
		{/if}

		{#if !readonly}
			<RemoveButton {id} {onRemove} class="text-white" />
		{/if}
	</div>
</div>
