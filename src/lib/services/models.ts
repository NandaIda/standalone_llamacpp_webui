import { base } from '$app/paths';
import { config } from '$lib/stores/settings.svelte';
import type { ApiModelListResponse } from '$lib/types/api';

export class ModelsService {
	static async list(): Promise<ApiModelListResponse> {
		const currentConfig = config();
		const apiKey = currentConfig.apiKey?.toString().trim();
		let apiBaseUrl = currentConfig.apiBaseUrl?.toString().trim() || '.';

		// Remove trailing slash to avoid double slashes
		if (apiBaseUrl !== '.' && apiBaseUrl.endsWith('/')) {
			apiBaseUrl = apiBaseUrl.slice(0, -1);
		}

		const modelsEndpoint = apiBaseUrl === '.' ? './v1/models' : `${apiBaseUrl}/models`;

		const response = await fetch(modelsEndpoint, {
			headers: {
				...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
			}
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch model list (status ${response.status})`);
		}

		return response.json() as Promise<ApiModelListResponse>;
	}
}
