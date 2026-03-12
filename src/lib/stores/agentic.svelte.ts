/**
 * agenticStore - Reactive State Store for Agentic Content Sections
 *
 * Manages agentic sections (reasoning, tool calls) for display in chat messages.
 * Provides a simplified interface for storing and retrieving parsed agentic content.
 */

import { AgenticSectionType } from '$lib/enums';
import type { AgenticSection } from '$lib/utils/agentic';

class AgenticStore {
	private _sections = $state<AgenticSection[]>([]);

	/**
	 * Get all agentic sections
	 */
	get sections(): AgenticSection[] {
		return this._sections;
	}

	/**
	 * Set agentic sections
	 */
	setSections(sections: AgenticSection[]): void {
		this._sections = sections;
	}

	/**
	 * Clear all sections
	 */
	clear(): void {
		this._sections = [];
	}

	/**
	 * Add a single section
	 */
	addSection(section: AgenticSection): void {
		this._sections.push(section);
	}

	/**
	 * Check if there are any agentic sections
	 */
	hasSections(): boolean {
		return this._sections.length > 0;
	}

	/**
	 * Get reasoning sections only
	 */
	getReasoningSections(): AgenticSection[] {
		return this._sections.filter(
			(s) => s.type === AgenticSectionType.REASONING || s.type === AgenticSectionType.REASONING_PENDING
		);
	}

	/**
	 * Get tool call sections only
	 */
	getToolCallSections(): AgenticSection[] {
		return this._sections.filter(
			(s) =>
				s.type === AgenticSectionType.TOOL_CALL ||
				s.type === AgenticSectionType.TOOL_CALL_PENDING ||
				s.type === AgenticSectionType.TOOL_CALL_STREAMING
		);
	}
}

export const agenticStore = new AgenticStore();
