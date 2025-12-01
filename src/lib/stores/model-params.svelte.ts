/**
 * ModelParamsStore - Model-specific parameter management
 *
 * This store manages parameter settings for each unique combination of API base URL and model name.
 * When switching between models, the store automatically loads and saves the appropriate parameters.
 *
 * **Key Features:**
 * - **Model-specific storage**: Parameters are saved per (API base URL + model name) combination
 * - **Automatic loading**: When a model is selected, its saved parameters are loaded
 * - **Automatic saving**: When parameters change, they're saved for the current model
 * - **Default fallback**: Uses global defaults for models without saved parameters
 *
 * **Storage Strategy:**
 * - Uses localStorage with keys: `model_params:${apiBaseUrl}:${modelName}`
 * - Stores all sampling parameters (temperature, top_k, top_p, etc.)
 * - Stores generation parameters (max_tokens, max_context, etc.)
 * - Does NOT store UI preferences or API credentials
 */

import { browser } from '$app/environment';
import { SETTING_CONFIG_DEFAULT } from '$lib/constants/settings-config';

// Parameters that should be saved per model
const MODEL_SPECIFIC_PARAMS = [
	'temperature',
	'dynatemp_range',
	'dynatemp_exponent',
	'top_k',
	'top_p',
	'min_p',
	'xtc_probability',
	'xtc_threshold',
	'typ_p',
	'repeat_last_n',
	'repeat_penalty',
	'presence_penalty',
	'frequency_penalty',
	'dry_multiplier',
	'dry_base',
	'dry_allowed_length',
	'dry_penalty_last_n',
	'max_tokens',
	'max_context',
	'samplers',
	'custom',
	'systemMessage',
	'imageGenerationMode'
] as const;

type ModelParamKey = (typeof MODEL_SPECIFIC_PARAMS)[number];
type ModelParams = Partial<Record<ModelParamKey, string | number | boolean>>;

interface ModelIdentifier {
	apiBaseUrl: string;
	modelName: string;
}

class ModelParamsStore {
	private currentModel: ModelIdentifier | null = null;

	/**
	 * Generate a unique key for a model based on API base URL and model name
	 */
	private getStorageKey(apiBaseUrl: string, modelName: string): string {
		// Normalize the URL to avoid duplicates
		const normalizedUrl = apiBaseUrl.trim().toLowerCase().replace(/\/$/, '');
		const normalizedModel = modelName.trim();
		return `model_params:${normalizedUrl}:${normalizedModel}`;
	}

	/**
	 * Load saved parameters for a specific model
	 */
	loadModelParams(apiBaseUrl: string, modelName: string): ModelParams | null {
		if (!browser || !apiBaseUrl || !modelName) return null;

		try {
			const key = this.getStorageKey(apiBaseUrl, modelName);
			const stored = localStorage.getItem(key);

			if (stored) {
				const params = JSON.parse(stored) as ModelParams;
				console.log(`Loaded parameters for model: ${modelName} at ${apiBaseUrl}`);
				return params;
			}
		} catch (error) {
			console.warn(`Failed to load parameters for ${modelName}:`, error);
		}

		return null;
	}

	/**
	 * Save parameters for a specific model
	 */
	saveModelParams(
		apiBaseUrl: string,
		modelName: string,
		config: Record<string, string | number | boolean>
	): void {
		if (!browser || !apiBaseUrl || !modelName) return;

		try {
			const key = this.getStorageKey(apiBaseUrl, modelName);

			// Extract only model-specific parameters
			const paramsToSave: ModelParams = {};
			for (const param of MODEL_SPECIFIC_PARAMS) {
				if (param in config) {
					paramsToSave[param] = config[param];
				}
			}

			localStorage.setItem(key, JSON.stringify(paramsToSave));
			console.log(`Saved parameters for model: ${modelName} at ${apiBaseUrl}`);
		} catch (error) {
			console.error(`Failed to save parameters for ${modelName}:`, error);
		}
	}

	/**
	 * Set the current active model
	 */
	setCurrentModel(apiBaseUrl: string, modelName: string): void {
		this.currentModel = { apiBaseUrl, modelName };
	}

	/**
	 * Get the current active model
	 */
	getCurrentModel(): ModelIdentifier | null {
		return this.currentModel;
	}

	/**
	 * Delete saved parameters for a specific model
	 */
	deleteModelParams(apiBaseUrl: string, modelName: string): void {
		if (!browser) return;

		try {
			const key = this.getStorageKey(apiBaseUrl, modelName);
			localStorage.removeItem(key);
			console.log(`Deleted parameters for model: ${modelName} at ${apiBaseUrl}`);
		} catch (error) {
			console.error(`Failed to delete parameters for ${modelName}:`, error);
		}
	}

	/**
	 * Get all saved model parameter keys
	 */
	getAllSavedModels(): string[] {
		if (!browser) return [];

		const models: string[] = [];
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				if (key && key.startsWith('model_params:')) {
					models.push(key);
				}
			}
		} catch (error) {
			console.error('Failed to get saved models:', error);
		}

		return models;
	}

	/**
	 * Clear all saved model parameters
	 */
	clearAllModelParams(): void {
		if (!browser) return;

		const keys = this.getAllSavedModels();
		for (const key of keys) {
			try {
				localStorage.removeItem(key);
			} catch (error) {
				console.error(`Failed to remove ${key}:`, error);
			}
		}
		console.log('Cleared all saved model parameters');
	}

	/**
	 * Get default parameters (for models without saved params)
	 */
	getDefaultParams(): ModelParams {
		const defaults: ModelParams = {};
		for (const param of MODEL_SPECIFIC_PARAMS) {
			if (param in SETTING_CONFIG_DEFAULT) {
				defaults[param] = SETTING_CONFIG_DEFAULT[param];
			}
		}
		return defaults;
	}

	/**
	 * Check if a parameter is model-specific
	 */
	isModelSpecificParam(key: string): boolean {
		return MODEL_SPECIFIC_PARAMS.includes(key as ModelParamKey);
	}
}

export const modelParamsStore = new ModelParamsStore();

// Export convenience methods
export const loadModelParams = modelParamsStore.loadModelParams.bind(modelParamsStore);
export const saveModelParams = modelParamsStore.saveModelParams.bind(modelParamsStore);
export const setCurrentModel = modelParamsStore.setCurrentModel.bind(modelParamsStore);
export const getCurrentModel = modelParamsStore.getCurrentModel.bind(modelParamsStore);
export const deleteModelParams = modelParamsStore.deleteModelParams.bind(modelParamsStore);
export const getAllSavedModels = modelParamsStore.getAllSavedModels.bind(modelParamsStore);
export const clearAllModelParams = modelParamsStore.clearAllModelParams.bind(modelParamsStore);
export const getDefaultParams = modelParamsStore.getDefaultParams.bind(modelParamsStore);
export const isModelSpecificParam = modelParamsStore.isModelSpecificParam.bind(modelParamsStore);
