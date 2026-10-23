import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { formatTodos, parseGitGrepOutput, scanTodos } from "../src/utils/todos.ts";

describe("parseGitGrepOutput", () => {
	test("parses null-separated git grep lines and ignores non-markers", () => {
		const output = [
			"src/a.ts\x0012\x00// TODO: fix me",
			"src/b.ts\x003\x00  FIXME handle error  ",
			"src/c.ts\x001\x00TODOS",
		].join("\n");

		expect(parseGitGrepOutput(output)).toEqual([
			{ file: "src/a.ts", line: 12, marker: "TODO", text: "// TODO: fix me" },
			{ file: "src/b.ts", line: 3, marker: "FIXME", text: "FIXME handle error" },
		]);
	});
});

describe("formatTodos", () => {
	test("reports when nothing is found", () => {
		expect(formatTodos([])).toBe("No TODO or FIXME comments found.");
	});

	test("lists file:line: text and truncates past the limit", () => {
		const items = [
			{ file: "a.ts", line: 1, marker: "TODO" as const, text: "// TODO one" },
			{ file: "b.ts", line: 2, marker: "FIXME" as const, text: "// FIXME two" },
		];

		expect(formatTodos(items, 1)).toBe(
			["2 outstanding TODO/FIXME comments:", "", "a.ts:1: // TODO one", "", "... and 1 more"].join("\n"),
		);
	});
});

describe("scanTodos", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-todos-"));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function writeFixture(): void {
		fs.mkdirSync(path.join(dir, "src"));
		fs.mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true });
		fs.writeFileSync(path.join(dir, "src", "a.ts"), "const a = 1;\n// TODO: first\n// FIXME: second\n");
		fs.writeFileSync(path.join(dir, "src", "b.ts"), "// nothing here\n");
		fs.writeFileSync(path.join(dir, "node_modules", "pkg", "index.js"), "// TODO: dependency\n");
		fs.writeFileSync(path.join(dir, "ignored.txt"), "TODO: ignored by gitignore\n");
		fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.txt\nnode_modules\n");
	}

	test("finds markers in a git repository and respects .gitignore", async () => {
		writeFixture();
		execFileSync("git", ["init", "-q"], { cwd: dir });

		const items = await scanTodos(dir);

		expect(items.map((item) => `${item.file}:${item.line}:${item.marker}`)).toEqual([
			"src/a.ts:2:TODO",
			"src/a.ts:3:FIXME",
		]);
	});

	test("falls back to walking the tree outside a git repository", async () => {
		writeFixture();

		const items = await scanTodos(dir);

		// The fallback skips node_modules but has no .gitignore support.
		expect(items.map((item) => `${item.file}:${item.line}`)).toEqual(["ignored.txt:1", "src/a.ts:2", "src/a.ts:3"]);
	});
});
