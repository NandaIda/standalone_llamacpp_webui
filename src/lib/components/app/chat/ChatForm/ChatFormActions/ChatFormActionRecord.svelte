<script lang="ts">
	import { Mic } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';

	interface Props {
		class?: string;
		disabled?: boolean;
		isLoading?: boolean;
		isRecording?: boolean;
		onMicClick?: () => void;
	}

	let {
		class: className = '',
		disabled = false,
		isLoading = false,
		isRecording = false,
		onMicClick
	}: Props = $props();
</script>

<div class="flex items-center gap-1 {className}">
	<Tooltip.Root delayDuration={100}>
		<Tooltip.Trigger>
			<Button
				class="h-8 w-8 rounded-full p-0 {isRecording
					? 'animate-pulse bg-red-500 text-white hover:bg-red-600'
					: 'bg-transparent text-muted-foreground hover:bg-foreground/10 hover:text-foreground'}"
				disabled={disabled || isLoading}
				onclick={onMicClick}
				type="button"
			>
				<span class="sr-only">{isRecording ? 'Stop speech recognition' : 'Start speech recognition'}</span>

				<Mic class="h-4 w-4" />
			</Button>
		</Tooltip.Trigger>

		<Tooltip.Content>
			<p>{isRecording ? 'Stop speech recognition' : 'Start speech-to-text'}</p>
		</Tooltip.Content>
	</Tooltip.Root>
</div>
