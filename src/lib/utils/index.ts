/**
 * Unified exports for all utility functions
 * Import utilities from '$lib/utils' for cleaner imports
 */

// CORS Proxy
export { buildProxiedUrl, getProxiedUrlString } from './cors-proxy';

// MCP utilities
export {
	detectMcpTransportFromUrl,
	parseMcpServerSettings,
	getMcpLogLevelIcon,
	getMcpLogLevelClass,
	isImageMimeType,
	parseResourcePath,
	getDisplayName,
	getResourceDisplayName,
	isCodeResource,
	isImageResource,
	getResourceIcon,
	getResourceTextContent,
	getResourceBlobContent,
	downloadResourceContent
} from './mcp';

// URI Template utilities
export {
	extractTemplateVariables,
	expandTemplate,
	isTemplateComplete,
	normalizeResourceUri,
	type UriTemplateVariable
} from './uri-template';

// Data URL utilities
export { createBase64DataUrl } from './data-url';

// Favicon utilities
export { getFaviconUrl } from './favicon';

// Formatting utilities
export {
	formatFileSize,
	formatParameters,
	formatNumber,
	formatJsonPretty,
	linkifyUrls,
	formatTime,
	formatPerformanceTime,
	formatAttachmentText
} from './formatters';

// Header utilities
export { parseHeadersToArray, serializeHeaders } from './headers';

// Sanitization utilities
export { sanitizeKeyValuePairKey, sanitizeKeyValuePairValue } from './sanitize';

// Abort signal utilities
export {
	throwIfAborted,
	isAbortError,
	createLinkedController,
	createTimeoutSignal,
	withAbortSignal
} from './abort';

// Clipboard utilities
export {
	copyToClipboard,
	copyCodeToClipboard,
	formatMessageForClipboard,
	parseClipboardContent,
	hasClipboardAttachments
} from './clipboard';

// Debounce utilities
export { debounce } from './debounce';

// Textarea utilities
export { default as autoResizeTextarea } from './autoresize-textarea';

// Text utilities
export { getPreviewText } from './text';

// Syntax highlighting utilities
export { getLanguageFromFilename } from './syntax-highlight-language';

// Code utilities
export { highlightCode, detectIncompleteCodeBlock } from './code';

// Image error fallback utilities
export { getImageErrorFallbackHtml } from './image-error-fallback';

// Cryptography utilities
export { uuid } from './uuid';

// Agentic utilities
export { parseAgenticContent, type AgenticSection } from './agentic';
