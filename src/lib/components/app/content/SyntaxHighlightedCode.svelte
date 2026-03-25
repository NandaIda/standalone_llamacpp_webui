<script lang="ts">
	import hljs from 'highlight.js';
	import { browser } from '$app/environment';
	import { mode } from 'mode-watcher';

	import githubDarkCss from 'highlight.js/styles/github-dark.css?inline';
	import githubLightCss from 'highlight.js/styles/github.css?inline';
	import { ColorMode } from '$lib/enums';
	import { theme } from '$lib/stores/settings.svelte';

	/**
	 * Post-process highlighted HTML to wrap URLs in clickable links.
	 * Operates on hljs output where & is &amp; — matches URLs in text nodes.
	 */
	function linkifyHighlightedHtml(html: string): string {
		// Match URLs in HTML text nodes. Allow &amp; for query params.
		// Stop at quotes, < (html tags), whitespace.
		return html.replace(
			/https?:\/\/(?:[^\s"'<>]|&amp;)+/g,
			(match) => {
				// Trim trailing punctuation (.,;:!?) and unbalanced )
				let url = match.replace(/[.,;:!?]+$/, '');
				// Balance parens (accounting for no actual parens in JSON URLs usually)
				let open = 0;
				let cut = url.length;
				for (let i = 0; i < url.length; i++) {
					if (url[i] === '(') open++;
					else if (url[i] === ')') {
						if (open > 0) open--;
						else { cut = i; break; }
					}
				}
				url = url.slice(0, cut);
				const rawUrl = url.replace(/&amp;/g, '&');
				return `<a href="${rawUrl}" target="_blank" rel="noopener noreferrer" class="underline hover:opacity-80" style="color: inherit; text-decoration: underline;">${url}</a>`;
			}
		);
	}

	interface Props {
		code: string;
		language?: string;
		class?: string;
		maxHeight?: string;
		maxWidth?: string;
	}

	let {
		code,
		language = 'text',
		class: className = '',
		maxHeight = '60vh',
		maxWidth = ''
	}: Props = $props();

	let highlightedHtml = $state('');

	function loadHighlightTheme(isDark: boolean) {
		if (!browser) return;

		const existingThemes = document.querySelectorAll('style[data-highlight-theme-preview]');
		existingThemes.forEach((style) => style.remove());

		const style = document.createElement('style');
		style.setAttribute('data-highlight-theme-preview', 'true');
		style.textContent = isDark ? githubDarkCss : githubLightCss;

		document.head.appendChild(style);
	}

	$effect(() => {
		const currentMode = mode.current;
		const isClaude = theme() === 'claude';
		const isDark = !isClaude && currentMode === ColorMode.DARK;

		loadHighlightTheme(isDark);
	});

	$effect(() => {
		if (!code) {
			highlightedHtml = '';
			return;
		}

		try {
			// Check if the language is supported
			const lang = language.toLowerCase();
			const isSupported = hljs.getLanguage(lang);

			if (isSupported) {
				const result = hljs.highlight(code, { language: lang });
				highlightedHtml = linkifyHighlightedHtml(result.value);
			} else {
				// Try auto-detection or fallback to plain text
				const result = hljs.highlightAuto(code);
				highlightedHtml = linkifyHighlightedHtml(result.value);
			}
		} catch {
			// Fallback to escaped plain text
			highlightedHtml = linkifyHighlightedHtml(
				code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			);
		}
	});
</script>

<div
	class="code-preview-wrapper rounded-lg border border-border bg-muted {className}"
	style="max-height: {maxHeight}; max-width: {maxWidth};"
>
	<!-- Needs to be formatted as single line for proper rendering -->
	<pre class="m-0"><code class="hljs text-sm leading-relaxed">{@html highlightedHtml}</code></pre>
</div>

<style>
	.code-preview-wrapper {
		font-family:
			ui-monospace, SFMono-Regular, 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas,
			'Liberation Mono', Menlo, monospace;
	}

	.code-preview-wrapper pre {
		background: transparent;
	}

	.code-preview-wrapper code {
		background: transparent;
	}
</style>
