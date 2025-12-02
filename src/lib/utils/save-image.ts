import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

export interface SaveImageResult {
	success: true;
	platform: 'web' | 'android' | 'ios';
	message: string;
}

/**
 * Saves an image to the device's storage.
 * Works on both web (using download link) and mobile (using Filesystem API).
 *
 * @param base64Data - The base64 data URL of the image
 * @param fileName - The name to save the file as
 * @returns Promise that resolves with save result info
 */
export async function saveImage(base64Data: string, fileName: string): Promise<SaveImageResult> {
	const platform = Capacitor.getPlatform();

	if (platform === 'web') {
		// Web: Use traditional download method
		const link = document.createElement('a');
		link.href = base64Data;
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);

		return {
			success: true,
			platform: 'web',
			message: 'Image downloaded'
		};
	} else {
		// Mobile (Android/iOS): Use Filesystem API
		try {
			// Extract base64 data from data URL
			let base64 = base64Data;
			if (base64Data.includes(',')) {
				base64 = base64Data.split(',')[1];
			}

			// Ensure fileName has extension
			if (!fileName.match(/\.(png|jpg|jpeg|webp)$/i)) {
				fileName = `${fileName}.png`;
			}

			// Generate unique filename with timestamp to avoid conflicts
			const timestamp = new Date().getTime();
			const uniqueFileName = `${timestamp}_${fileName}`;

			console.log('Attempting to save image:', uniqueFileName);
			console.log('Platform:', platform);

			// Check permissions first
			const checkResult = await Filesystem.checkPermissions();
			console.log('Permission check result:', checkResult);

			if (checkResult.publicStorage !== 'granted') {
				console.log('Requesting permissions...');
				const requestResult = await Filesystem.requestPermissions();
				console.log('Permission request result:', requestResult);

				if (requestResult.publicStorage !== 'granted') {
					throw new Error(
						'Storage permission denied. Please grant storage permission in app settings.'
					);
				}
			}

			// Try to save to External Storage
			console.log('Writing file to external storage...');
			const result = await Filesystem.writeFile({
				path: `Download/AIChatImages/${uniqueFileName}`,
				data: base64,
				directory: Directory.ExternalStorage,
				recursive: true
			});

			console.log('File write result:', result);
			console.log(`Image saved successfully to: Download/AIChatImages/${uniqueFileName}`);

			return {
				success: true,
				platform: platform as 'android' | 'ios',
				message: 'Image saved to Download/AIChatImages folder'
			};
		} catch (error) {
			console.error('Error saving image (full error):', error);
			console.error('Error type:', typeof error);
			console.error('Error message:', error instanceof Error ? error.message : String(error));
			throw new Error(`Failed to save image: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
