/**
 * Generates a Perplexity-style search slug from a query and conversation ID.
 * Example: "how to setting localhost" + "a1b2c3d4-..." → "how-to-setting-localhost-a1b2c3d4"
 */
export function generateSearchSlug(query: string, conversationId: string): string {
	const shortId = conversationId.slice(0, 8);
	const slug = query
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.slice(0, 60)
		.replace(/-$/, '');

	return slug ? `${slug}-${shortId}` : shortId;
}

/**
 * Extracts the short conversation ID from a search slug.
 * The short ID is always the last 8 characters after the final hyphen.
 */
export function extractShortIdFromSlug(slug: string): string {
	const lastHyphen = slug.lastIndexOf('-');
	if (lastHyphen === -1) return slug;
	return slug.slice(lastHyphen + 1);
}
