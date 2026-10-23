import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawnProcess } from "./child-process.ts";

export interface TodoItem {
	/** Path relative to the scanned directory, using forward slashes. */
	file: string;
	/** 1-based line number. */
	line: number;
	/** Marker found on the line. */
	marker: "TODO" | "FIXME";
	/** Trimmed line text. */
	text: string;
}

const MARKER_PATTERN = /\b(TODO|FIXME)\b/;
const MAX_LINE_LENGTH = 200;
const MAX_FILE_BYTES = 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "coverage"]);

function toTodoItem(file: string, line: number, rawText: string): TodoItem | undefined {
	const marker = MARKER_PATTERN.exec(rawText)?.[1];
	if (marker !== "TODO" && marker !== "FIXME") return undefined;
	let text = rawText.trim();
	if (text.length > MAX_LINE_LENGTH) text = `${text.slice(0, MAX_LINE_LENGTH - 3)}...`;
	return { file, line, marker, text };
}

/**
 * Parse `git grep -n --null` output. Each line is `path\0lineno:text`.
 */
export function parseGitGrepOutput(output: string): TodoItem[] {
	const items: TodoItem[] = [];
	for (const entry of output.split("\n")) {
		const separator = entry.indexOf("\0");
		if (separator < 0) continue;
		const match = /^(\d+):(.*)$/.exec(entry.slice(separator + 1));
		if (!match) continue;
		const item = toTodoItem(entry.slice(0, separator), Number(match[1]), match[2] ?? "");
		if (item) items.push(item);
	}
	return items;
}

function runGitGrep(cwd: string): Promise<TodoItem[] | undefined> {
	return new Promise((resolve) => {
		const args = ["grep", "-n", "-I", "--null", "--untracked", "-E", "\\b(TODO|FIXME)\\b"];
		const child = spawnProcess("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		const chunks: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
		child.on("error", () => resolve(undefined));
		child.on("close", (code) => {
			// Exit code 1 means no matches; anything else but 0 means git could not scan (for example, not a repo).
			if (code === 0 || code === 1) resolve(parseGitGrepOutput(Buffer.concat(chunks).toString("utf-8")));
			else resolve(undefined);
		});
	});
}

async function walkDirectory(root: string, directory: string, items: TodoItem[]): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(directory, { withFileTypes: true });
	} catch {
		return;
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!SKIPPED_DIRECTORIES.has(entry.name)) await walkDirectory(root, fullPath, items);
			continue;
		}
		if (!entry.isFile()) continue;
		try {
			const stats = await fs.stat(fullPath);
			if (stats.size > MAX_FILE_BYTES) continue;
			const content = await fs.readFile(fullPath, "utf-8");
			if (content.includes("\0")) continue;
			const relative = path.relative(root, fullPath).split(path.sep).join("/");
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const item = toTodoItem(relative, i + 1, lines[i] ?? "");
				if (item) items.push(item);
			}
		} catch {
			// Unreadable file: skip.
		}
	}
}

/**
 * Find TODO and FIXME comments under cwd. Uses `git grep` (respects .gitignore) inside a git
 * repository and falls back to walking the directory tree otherwise.
 */
export async function scanTodos(cwd: string): Promise<TodoItem[]> {
	const gitItems = await runGitGrep(cwd);
	const items = gitItems ?? [];
	if (!gitItems) await walkDirectory(cwd, cwd, items);
	return items.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Format todos as `file:line: text` lines grouped under a summary header.
 */
export function formatTodos(items: TodoItem[], limit = 200): string {
	if (items.length === 0) return "No TODO or FIXME comments found.";
	const shown = items.slice(0, limit);
	const lines = [`${items.length} outstanding TODO/FIXME comment${items.length === 1 ? "" : "s"}:`, ""];
	for (const item of shown) lines.push(`${item.file}:${item.line}: ${item.text}`);
	if (items.length > shown.length) lines.push("", `... and ${items.length - shown.length} more`);
	return lines.join("\n");
}
