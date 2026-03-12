/**
 * Built-in tools that run locally in the browser (no MCP server needed).
 * Provides arithmetic and date math capabilities.
 */

interface OpenAIToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

const BUILTIN_PREFIX = 'builtin_';

const builtinToolDefs: OpenAIToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: `${BUILTIN_PREFIX}calculator`,
			description:
				'Evaluate a mathematical expression. Supports +, -, *, /, **, %, sqrt, abs, sin, cos, tan, log, log2, log10, ceil, floor, round, min, max, PI, E. Examples: "2 + 3 * 4", "sqrt(144)", "2 ** 10", "max(5, 10, 3)".',
			parameters: {
				type: 'object',
				properties: {
					expression: {
						type: 'string',
						description: 'The math expression to evaluate'
					}
				},
				required: ['expression']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: `${BUILTIN_PREFIX}date_math`,
			description:
				'Perform date calculations. Operations: "now" (current date/time), "add" (add duration to a date), "subtract" (subtract duration from a date), "diff" (difference between two dates), "format" (format a date). Duration units: years, months, weeks, days, hours, minutes, seconds.',
			parameters: {
				type: 'object',
				properties: {
					operation: {
						type: 'string',
						enum: ['now', 'add', 'subtract', 'diff', 'format'],
						description: 'The date operation to perform'
					},
					date: {
						type: 'string',
						description: 'ISO date string or "now" (default: now)'
					},
					date2: {
						type: 'string',
						description: 'Second date for "diff" operation'
					},
					amount: {
						type: 'number',
						description: 'Amount to add/subtract'
					},
					unit: {
						type: 'string',
						enum: ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'],
						description: 'Unit for add/subtract'
					},
					format: {
						type: 'string',
						description: 'Output format: "iso", "date", "time", "datetime", "relative", "unix" (default: "datetime")'
					}
				},
				required: ['operation']
			}
		}
	}
];

// Safe math evaluator (no eval)
function safeCalc(expr: string): number {
	// Tokenize
	const tokens: (string | number)[] = [];
	let i = 0;
	const s = expr.replace(/\s+/g, '');

	const constants: Record<string, number> = {
		PI: Math.PI,
		E: Math.E,
		pi: Math.PI,
		e: Math.E
	};

	const funcs: Record<string, (...args: number[]) => number> = {
		sqrt: Math.sqrt,
		abs: Math.abs,
		sin: Math.sin,
		cos: Math.cos,
		tan: Math.tan,
		log: Math.log,
		log2: Math.log2,
		log10: Math.log10,
		ceil: Math.ceil,
		floor: Math.floor,
		round: Math.round,
		min: Math.min,
		max: Math.max,
		pow: Math.pow
	};

	// Simple recursive descent parser
	function parseExpr(): number {
		let left = parseTerm();
		while (i < s.length && (s[i] === '+' || s[i] === '-')) {
			const op = s[i++];
			const right = parseTerm();
			left = op === '+' ? left + right : left - right;
		}
		return left;
	}

	function parseTerm(): number {
		let left = parsePower();
		while (i < s.length && (s[i] === '*' || s[i] === '/' || s[i] === '%')) {
			const op = s[i++];
			const right = parsePower();
			if (op === '*') left *= right;
			else if (op === '/') left /= right;
			else left %= right;
		}
		return left;
	}

	function parsePower(): number {
		let base = parseUnary();
		while (i < s.length && s[i] === '*' && s[i + 1] === '*') {
			i += 2;
			const exp = parseUnary();
			base = Math.pow(base, exp);
		}
		return base;
	}

	function parseUnary(): number {
		if (s[i] === '-') {
			i++;
			return -parseAtom();
		}
		if (s[i] === '+') {
			i++;
		}
		return parseAtom();
	}

	function parseAtom(): number {
		// Number
		if ((s[i] >= '0' && s[i] <= '9') || s[i] === '.') {
			let num = '';
			while (i < s.length && ((s[i] >= '0' && s[i] <= '9') || s[i] === '.')) {
				num += s[i++];
			}
			return parseFloat(num);
		}

		// Parenthesized expression
		if (s[i] === '(') {
			i++; // skip (
			const val = parseExpr();
			if (s[i] === ')') i++; // skip )
			return val;
		}

		// Identifier (function or constant)
		let name = '';
		while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
			name += s[i++];
		}

		if (name in constants) {
			return constants[name];
		}

		if (name in funcs) {
			if (s[i] !== '(') throw new Error(`Expected '(' after function ${name}`);
			i++; // skip (
			const args: number[] = [parseExpr()];
			while (s[i] === ',') {
				i++;
				args.push(parseExpr());
			}
			if (s[i] === ')') i++;
			return funcs[name](...args);
		}

		throw new Error(`Unknown token: ${name || s[i]}`);
	}

	const result = parseExpr();
	if (i < s.length) throw new Error(`Unexpected character at position ${i}: ${s[i]}`);
	return result;
}

function parseDate(d?: string): Date {
	if (!d || d === 'now') return new Date();
	const parsed = new Date(d);
	if (isNaN(parsed.getTime())) throw new Error(`Invalid date: ${d}`);
	return parsed;
}

function formatDate(d: Date, fmt?: string): string {
	switch (fmt) {
		case 'iso':
			return d.toISOString();
		case 'date':
			return d.toLocaleDateString();
		case 'time':
			return d.toLocaleTimeString();
		case 'unix':
			return String(Math.floor(d.getTime() / 1000));
		case 'relative': {
			const diff = Date.now() - d.getTime();
			const absDiff = Math.abs(diff);
			const ago = diff > 0 ? 'ago' : 'from now';
			if (absDiff < 60000) return `${Math.round(absDiff / 1000)} seconds ${ago}`;
			if (absDiff < 3600000) return `${Math.round(absDiff / 60000)} minutes ${ago}`;
			if (absDiff < 86400000) return `${Math.round(absDiff / 3600000)} hours ${ago}`;
			return `${Math.round(absDiff / 86400000)} days ${ago}`;
		}
		default:
			return d.toLocaleString();
	}
}

function addDuration(date: Date, amount: number, unit: string): Date {
	const d = new Date(date);
	switch (unit) {
		case 'years':
			d.setFullYear(d.getFullYear() + amount);
			break;
		case 'months':
			d.setMonth(d.getMonth() + amount);
			break;
		case 'weeks':
			d.setDate(d.getDate() + amount * 7);
			break;
		case 'days':
			d.setDate(d.getDate() + amount);
			break;
		case 'hours':
			d.setHours(d.getHours() + amount);
			break;
		case 'minutes':
			d.setMinutes(d.getMinutes() + amount);
			break;
		case 'seconds':
			d.setSeconds(d.getSeconds() + amount);
			break;
		default:
			throw new Error(`Unknown unit: ${unit}`);
	}
	return d;
}

function executeDateMath(args: Record<string, unknown>): string {
	const { operation, date, date2, amount, unit, format } = args as {
		operation: string;
		date?: string;
		date2?: string;
		amount?: number;
		unit?: string;
		format?: string;
	};

	switch (operation) {
		case 'now':
			return formatDate(new Date(), (format as string) || 'datetime');

		case 'add':
		case 'subtract': {
			if (amount === undefined || !unit) throw new Error('add/subtract requires amount and unit');
			const d = parseDate(date);
			const mult = operation === 'subtract' ? -1 : 1;
			const result = addDuration(d, amount * mult, unit);
			return formatDate(result, (format as string) || 'datetime');
		}

		case 'diff': {
			if (!date2) throw new Error('diff requires date2');
			const d1 = parseDate(date);
			const d2 = parseDate(date2);
			const diffMs = d2.getTime() - d1.getTime();
			const diffDays = diffMs / 86400000;
			const diffHours = diffMs / 3600000;
			const diffMinutes = diffMs / 60000;
			return JSON.stringify({
				milliseconds: diffMs,
				seconds: Math.round(diffMs / 1000),
				minutes: Math.round(diffMinutes),
				hours: Math.round(diffHours),
				days: Math.round(diffDays),
				weeks: Math.round(diffDays / 7),
				description: `${Math.abs(Math.round(diffDays))} days ${diffMs >= 0 ? 'later' : 'earlier'}`
			});
		}

		case 'format':
			return formatDate(parseDate(date), (format as string) || 'datetime');

		default:
			throw new Error(`Unknown operation: ${operation}`);
	}
}

// --- Public API ---

export function getBuiltinToolDefinitions(): OpenAIToolDefinition[] {
	return builtinToolDefs;
}

export function isBuiltinTool(name: string): boolean {
	return name.startsWith(BUILTIN_PREFIX);
}

export function executeBuiltinTool(toolCall: ToolCall): string {
	const name = toolCall.function.name;
	const args = JSON.parse(toolCall.function.arguments);

	switch (name) {
		case `${BUILTIN_PREFIX}calculator`: {
			const result = safeCalc(args.expression);
			return String(result);
		}
		case `${BUILTIN_PREFIX}date_math`:
			return executeDateMath(args);
		default:
			throw new Error(`Unknown built-in tool: ${name}`);
	}
}
