<script lang="ts">
	import { SquarePen } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { goto } from '$app/navigation';
</script>

<div class="pointer-events-auto flex items-center space-x-2">
	<Button variant="ghost" size="sm" onclick={() => goto('?new_chat=true#/')}>
		<SquarePen class="h-4 w-4" />
	</Button>
</div>