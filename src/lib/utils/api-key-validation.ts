import { error } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { config } from '$lib/stores/settings.svelte';

/**
 * Validates API key by making a request to the server props endpoint
 * Throws SvelteKit errors for authentication failures or server issues
 */
export async function validateApiKey(fetch: typeof globalThis.fetch): Promise<void> {
	if (!browser) {
		return;
	}

	try {
		const currentConfig = config();
		const apiKey = currentConfig.apiKey;
		const apiBaseUrl = currentConfig.apiBaseUrl?.toString().trim() || '.';

		// Check if using external API
		const isExternalApi = apiBaseUrl !== '.' && !apiBaseUrl.startsWith('/') &&
			(apiBaseUrl.startsWith('http://') || apiBaseUrl.startsWith('https://'));

		// Skip validation for external APIs - they'll validate on first actual request
		if (isExternalApi) {
			console.log('Using external API, skipping API key validation');
			return;
		}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};

		if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`;
		}

		const response = await fetch(`./props`, { headers });

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				throw error(401, 'Access denied');
			}

			console.warn(`Server responded with status ${response.status} during API key validation`);
			return;
		}
	} catch (err) {
		// If it's already a SvelteKit error, re-throw it
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}

		// Network or other errors
		console.warn('Cannot connect to server for API key validation:', err);
	}
}
