<script lang="ts">
	import {
		CollapsibleContentBlock,
		MarkdownContent,
		SyntaxHighlightedCode
	} from '$lib/components/app';
	import { config } from '$lib/stores/settings.svelte';
	import { Wrench, Loader2, AlertTriangle, Brain, ListChecks } from '@lucide/svelte';
	import { AgenticSectionType, AttachmentType, FileTypeText } from '$lib/enums';
	import { formatJsonPretty, linkifyUrls } from '$lib/utils';
	import { ATTACHMENT_SAVED_REGEX, NEWLINE_SEPARATOR } from '$lib/constants';
	import { parseAgenticContent, type AgenticSection } from '$lib/utils';
	import type { DatabaseMessage, DatabaseMessageExtraImageFile } from '$lib/types/database';
	import type { ChatMessageAgenticTurnStats } from '$lib/types/chat';

	interface Props {
		message?: DatabaseMessage;
		content: string;
		isStreaming?: boolean;
		highlightTurns?: boolean;
	}

	type ToolResultLine = {
		text: string;
		image?: DatabaseMessageExtraImageFile;
	};

	let { content, message, isStreaming = false, highlightTurns = false }: Props = $props();

	let expandedStates: Record<number, boolean> = $state({});
	let stepsExpanded = $state(false);

	const sections = $derived(parseAgenticContent(content));
	const showToolCallInProgress = $derived(config().showToolCallInProgress as boolean);
	const showThoughtInProgress = $derived(config().showThoughtInProgress as boolean);

	// Parse toolResults with images only when sections or message.extra change
	const sectionsParsed = $derived(
		sections.map((section) => ({
			...section,
			parsedLines: section.toolResult
				? parseToolResultWithImages(section.toolResult, message?.extra)
				: []
		}))
	);

	// Separate step sections (reasoning, tool calls) from final text content
	const stepSections = $derived(
		sectionsParsed.filter(
			(s) => s.type !== AgenticSectionType.TEXT
		)
	);

	const textSections = $derived(
		sectionsParsed.filter(
			(s) => s.type === AgenticSectionType.TEXT
		)
	);

	// Count completed steps for the summary label
	const completedStepCount = $derived(
		stepSections.filter(
			(s) =>
				s.type === AgenticSectionType.TOOL_CALL ||
				s.type === AgenticSectionType.REASONING
		).length
	);

	const pendingStepCount = $derived(
		stepSections.filter(
			(s) =>
				s.type === AgenticSectionType.TOOL_CALL_PENDING ||
				s.type === AgenticSectionType.TOOL_CALL_STREAMING ||
				s.type === AgenticSectionType.REASONING_PENDING
		).length
	);

	const hasSteps = $derived(stepSections.length > 0);
	const allStepsComplete = $derived(pendingStepCount === 0 && !isStreaming);

	const stepsLabel = $derived.by(() => {
		if (allStepsComplete) {
			return `Completed ${completedStepCount} step${completedStepCount !== 1 ? 's' : ''}`;
		}
		if (pendingStepCount > 0) {
			return `Working... (${completedStepCount} step${completedStepCount !== 1 ? 's' : ''} done)`;
		}
		return `Processing...`;
	});

	// Group flat sections into agentic turns
	// A new turn starts when a non-tool section follows a tool section
	const turnGroups = $derived.by(() => {
		const turns: { sections: (typeof sectionsParsed)[number][]; flatIndices: number[] }[] = [];
		let currentTurn: (typeof sectionsParsed)[number][] = [];
		let currentIndices: number[] = [];
		let prevWasTool = false;

		for (let i = 0; i < sectionsParsed.length; i++) {
			const section = sectionsParsed[i];
			const isTool =
				section.type === AgenticSectionType.TOOL_CALL ||
				section.type === AgenticSectionType.TOOL_CALL_PENDING ||
				section.type === AgenticSectionType.TOOL_CALL_STREAMING;

			if (!isTool && prevWasTool && currentTurn.length > 0) {
				turns.push({ sections: currentTurn, flatIndices: currentIndices });
				currentTurn = [];
				currentIndices = [];
			}

			currentTurn.push(section);
			currentIndices.push(i);
			prevWasTool = isTool;
		}

		if (currentTurn.length > 0) {
			turns.push({ sections: currentTurn, flatIndices: currentIndices });
		}

		return turns;
	});

	function getDefaultExpanded(section: AgenticSection): boolean {
		if (
			section.type === AgenticSectionType.TOOL_CALL_PENDING ||
			section.type === AgenticSectionType.TOOL_CALL_STREAMING
		) {
			return showToolCallInProgress;
		}

		if (section.type === AgenticSectionType.REASONING_PENDING) {
			return showThoughtInProgress;
		}

		return false;
	}

	function isExpanded(index: number, section: AgenticSection): boolean {
		if (expandedStates[index] !== undefined) {
			return expandedStates[index];
		}

		return getDefaultExpanded(section);
	}

	function toggleExpanded(index: number, section: AgenticSection) {
		const currentState = isExpanded(index, section);

		expandedStates[index] = !currentState;
	}

	function parseToolResultWithImages(
		toolResult: string,
		extras?: DatabaseMessage['extra']
	): ToolResultLine[] {
		const lines = toolResult.split(NEWLINE_SEPARATOR);

		return lines.map((line) => {
			const match = line.match(ATTACHMENT_SAVED_REGEX);
			if (!match || !extras) return { text: line };

			const attachmentName = match[1];
			const image = extras.find(
				(e): e is DatabaseMessageExtraImageFile =>
					e.type === AttachmentType.IMAGE && e.name === attachmentName
			);

			return { text: line, image };
		});
	}

	function getStepIcon(section: AgenticSection) {
		switch (section.type) {
			case AgenticSectionType.TOOL_CALL:
				return Wrench;
			case AgenticSectionType.TOOL_CALL_PENDING:
			case AgenticSectionType.TOOL_CALL_STREAMING:
				return Loader2;
			case AgenticSectionType.REASONING:
			case AgenticSectionType.REASONING_PENDING:
				return Brain;
			default:
				return Wrench;
		}
	}

	function getStepLabel(section: AgenticSection): string {
		switch (section.type) {
			case AgenticSectionType.TOOL_CALL:
			case AgenticSectionType.TOOL_CALL_PENDING:
			case AgenticSectionType.TOOL_CALL_STREAMING:
				return section.toolName || 'Tool call';
			case AgenticSectionType.REASONING:
			case AgenticSectionType.REASONING_PENDING:
				return 'Reasoning';
			default:
				return 'Step';
		}
	}

	function truncateArgs(args: string): string {
		try {
			const parsed = JSON.parse(args);
			const firstValue = Object.values(parsed)[0];
			if (typeof firstValue === 'string') {
				return firstValue.length > 40 ? firstValue.slice(0, 40) + '...' : firstValue;
			}
			return '';
		} catch {
			return '';
		}
	}

	function isStepPending(section: AgenticSection): boolean {
		return (
			section.type === AgenticSectionType.TOOL_CALL_PENDING ||
			section.type === AgenticSectionType.TOOL_CALL_STREAMING ||
			section.type === AgenticSectionType.REASONING_PENDING
		);
	}
</script>

{#snippet renderSection(section: (typeof sectionsParsed)[number], index: number)}
	{#if section.type === AgenticSectionType.TEXT}
		<div class="agentic-text">
			<MarkdownContent content={section.content} attachments={message?.extra} />
		</div>
	{:else if section.type === AgenticSectionType.TOOL_CALL_STREAMING}
		{@const streamingIcon = isStreaming ? Loader2 : AlertTriangle}
		{@const streamingIconClass = isStreaming ? 'h-4 w-4 animate-spin' : 'h-4 w-4 text-yellow-500'}
		{@const streamingSubtitle = isStreaming ? '' : 'incomplete'}

		<CollapsibleContentBlock
			open={isExpanded(index, section)}
			class="my-2"
			icon={streamingIcon}
			iconClass={streamingIconClass}
			title={section.toolName || 'Tool call'}
			subtitle={streamingSubtitle}
			{isStreaming}
			onToggle={() => toggleExpanded(index, section)}
		>
			<div class="pt-3">
				<div class="my-3 flex items-center gap-2 text-xs text-muted-foreground">
					<span>Arguments:</span>

					{#if isStreaming}
						<Loader2 class="h-3 w-3 animate-spin" />
					{/if}
				</div>
				{#if section.toolArgs}
					<SyntaxHighlightedCode
						code={formatJsonPretty(section.toolArgs)}
						language={FileTypeText.JSON}
						maxHeight="20rem"
						class="text-xs"
					/>
				{:else if isStreaming}
					<div class="rounded bg-muted/30 p-2 text-xs text-muted-foreground italic">
						Receiving arguments...
					</div>
				{:else}
					<div
						class="rounded bg-yellow-500/10 p-2 text-xs text-yellow-600 italic dark:text-yellow-400"
					>
						Response was truncated
					</div>
				{/if}
			</div>
		</CollapsibleContentBlock>
	{:else if section.type === AgenticSectionType.TOOL_CALL || section.type === AgenticSectionType.TOOL_CALL_PENDING}
		{@const isPending = section.type === AgenticSectionType.TOOL_CALL_PENDING}
		{@const toolIcon = isPending ? Loader2 : Wrench}
		{@const toolIconClass = isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}

		<CollapsibleContentBlock
			open={isExpanded(index, section)}
			class="my-2"
			icon={toolIcon}
			iconClass={toolIconClass}
			title={section.toolName || ''}
			subtitle={isPending ? 'executing...' : undefined}
			isStreaming={isPending}
			onToggle={() => toggleExpanded(index, section)}
		>
			{#if section.toolArgs && section.toolArgs !== '{}'}
				<div class="pt-3">
					<div class="my-3 text-xs text-muted-foreground">Arguments:</div>

					<SyntaxHighlightedCode
						code={formatJsonPretty(section.toolArgs)}
						language={FileTypeText.JSON}
						maxHeight="20rem"
						class="text-xs"
					/>
				</div>
			{/if}

			<div class="pt-3">
				<div class="my-3 flex items-center gap-2 text-xs text-muted-foreground">
					<span>Result:</span>

					{#if isPending}
						<Loader2 class="h-3 w-3 animate-spin" />
					{/if}
				</div>
				{#if section.toolResult}
					<div class="overflow-auto rounded-lg border border-border bg-muted p-4">
						{#each section.parsedLines as line, i (i)}
							<div class="font-mono text-xs leading-relaxed whitespace-pre-wrap">{@html linkifyUrls(line.text)}</div>
							{#if line.image}
								<img
									src={line.image.base64Url}
									alt={line.image.name}
									class="mt-2 mb-2 h-auto max-w-full rounded-lg"
									loading="lazy"
								/>
							{/if}
						{/each}
					</div>
				{:else if isPending}
					<div class="rounded bg-muted/30 p-2 text-xs text-muted-foreground italic">
						Waiting for result...
					</div>
				{/if}
			</div>
		</CollapsibleContentBlock>
	{:else if section.type === AgenticSectionType.REASONING}
		<CollapsibleContentBlock
			open={isExpanded(index, section)}
			class="my-2"
			icon={Brain}
			title="Reasoning"
			onToggle={() => toggleExpanded(index, section)}
		>
			<div class="pt-3">
				<div class="text-xs leading-relaxed break-words whitespace-pre-wrap">
					{section.content}
				</div>
			</div>
		</CollapsibleContentBlock>
	{:else if section.type === AgenticSectionType.REASONING_PENDING}
		{@const reasoningTitle = isStreaming ? 'Reasoning...' : 'Reasoning'}
		{@const reasoningSubtitle = isStreaming ? '' : 'incomplete'}

		<CollapsibleContentBlock
			open={isExpanded(index, section)}
			class="my-2"
			icon={Brain}
			title={reasoningTitle}
			subtitle={reasoningSubtitle}
			{isStreaming}
			onToggle={() => toggleExpanded(index, section)}
		>
			<div class="pt-3">
				<div class="text-xs leading-relaxed break-words whitespace-pre-wrap">
					{section.content}
				</div>
			</div>
		</CollapsibleContentBlock>
	{/if}
{/snippet}

{#snippet renderStepsSummary()}
	<div class="steps-summary">
		<button
			class="steps-summary-toggle"
			onclick={() => (stepsExpanded = !stepsExpanded)}
		>
			<div class="flex items-center gap-2">
				{#if !allStepsComplete}
					<Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
				{:else}
					<ListChecks class="h-4 w-4 text-muted-foreground" />
				{/if}
				<span class="text-sm font-medium text-muted-foreground">{stepsLabel}</span>
			</div>
			<svg
				class="chevron h-4 w-4 text-muted-foreground transition-transform"
				class:rotate-180={stepsExpanded}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
			>
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		</button>

		{#if stepsExpanded}
			<div class="steps-detail">
				{#each stepSections as section, index (index)}
					<div class="step-item">
						<div class="step-line"></div>
						<div class="step-dot" class:step-dot-pending={isStepPending(section)}>
							{#if isStepPending(section)}
								<Loader2 class="h-3 w-3 animate-spin" />
							{:else}
								<svelte:component this={getStepIcon(section)} class="h-3 w-3" />
							{/if}
						</div>
						<button
							class="step-content"
							onclick={() => toggleExpanded(index, section)}
						>
							<span class="step-label">{getStepLabel(section)}</span>
							{#if section.type === AgenticSectionType.TOOL_CALL && section.toolArgs && section.toolArgs !== '{}'}
								<span class="step-args">{truncateArgs(section.toolArgs)}</span>
							{/if}
							<svg
								class="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform"
								class:rotate-180={isExpanded(index, section)}
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<polyline points="6 9 12 15 18 9"></polyline>
							</svg>
						</button>
					</div>
					{#if isExpanded(index, section)}
						<div class="step-expanded-content">
							{#if section.type === AgenticSectionType.REASONING || section.type === AgenticSectionType.REASONING_PENDING}
								<div class="text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
									{section.content}
								</div>
							{:else}
								{#if section.toolArgs && section.toolArgs !== '{}'}
									<div class="mb-2">
										<div class="mb-1 text-xs text-muted-foreground">Arguments:</div>
										<SyntaxHighlightedCode
											code={formatJsonPretty(section.toolArgs)}
											language={FileTypeText.JSON}
											maxHeight="15rem"
											class="text-xs"
										/>
									</div>
								{/if}
								{#if section.toolResult}
									<div>
										<div class="mb-1 text-xs text-muted-foreground">Result:</div>
										<div class="overflow-auto rounded-lg border border-border bg-muted p-3 max-h-60">
											{#each section.parsedLines as line, i (i)}
												<div class="font-mono text-xs leading-relaxed whitespace-pre-wrap">{@html linkifyUrls(line.text)}</div>
												{#if line.image}
													<img
														src={line.image.base64Url}
														alt={line.image.name}
														class="mt-2 mb-2 h-auto max-w-full rounded-lg"
														loading="lazy"
													/>
												{/if}
											{/each}
										</div>
									</div>
								{/if}
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		{:else if !allStepsComplete}
			<!-- Show current active step inline when collapsed and still working -->
			{@const lastStep = stepSections[stepSections.length - 1]}
			{#if lastStep}
				<div class="steps-current">
					<div class="step-dot step-dot-pending">
						<Loader2 class="h-3 w-3 animate-spin" />
					</div>
					<span class="text-xs text-muted-foreground">{getStepLabel(lastStep)}</span>
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

<div class="agentic-content">
	{#if hasSteps}
		<!-- Perplexity-style: collapsed steps summary + text content below -->
		{@render renderStepsSummary()}
		{#each textSections as section, index (index)}
			<div class="agentic-text">
				<MarkdownContent content={section.content} attachments={message?.extra} />
			</div>
		{/each}
	{:else}
		{#each sectionsParsed as section, index (index)}
			{@render renderSection(section, index)}
		{/each}
	{/if}
</div>

<style>
	.agentic-content {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		max-width: 48rem;
	}

	.agentic-text {
		width: 100%;
	}

	.steps-summary {
		width: 100%;
	}

	.steps-summary-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.5rem 0;
		cursor: pointer;
		background: none;
		border: none;
	}

	.steps-summary-toggle:hover {
		opacity: 0.8;
	}

	.chevron {
		transition: transform 0.2s ease;
	}

	.steps-detail {
		position: relative;
		padding-left: 0.25rem;
		margin-top: 0.125rem;
		margin-bottom: 0.25rem;
	}

	.step-item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.1rem 0;
	}

	.step-line {
		position: absolute;
		left: 0.5rem;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--muted-foreground);
		opacity: 0.2;
	}

	.step-item:last-of-type .step-line {
		bottom: 50%;
	}

	.step-item:first-child .step-line {
		top: 50%;
	}

	.step-dot {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 50%;
		background: var(--muted);
		color: var(--muted-foreground);
		flex-shrink: 0;
	}

	.step-dot-pending {
		background: var(--muted);
		color: var(--muted-foreground);
	}

	.step-content {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0.5rem;
		border-radius: 0.375rem;
		cursor: pointer;
		background: none;
		border: none;
		text-align: left;
	}

	.step-content:hover {
		background: var(--muted);
	}

	.step-label {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
		color: var(--muted-foreground);
	}

	.step-args {
		font-size: 0.75rem;
		color: var(--muted-foreground);
		opacity: 0.6;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 20rem;
	}

	.step-expanded-content {
		margin-left: 2rem;
		margin-bottom: 0.5rem;
		padding: 0.5rem;
		border-radius: 0.375rem;
		background: var(--muted);
		opacity: 0.9;
	}

	.steps-current {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.25rem;
	}

	.agentic-turn {
		position: relative;
		border: 1.5px dashed var(--muted-foreground);
		border-radius: 0.75rem;
		padding: 1rem;
		transition: background 0.1s;
	}

	.agentic-turn-label {
		position: absolute;
		top: -1rem;
		left: 0.75rem;
		padding: 0 0.375rem;
		background: var(--background);
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
</style>
