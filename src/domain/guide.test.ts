import { GUIDE, guideBySlug, markdownHeadings, markdownLinks, resolveDocHref } from "./guide";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const docsRoot = join(process.cwd(), "docs");
const folders = ["getting-started", "architecture", "workflows", "statuses", "customization", "troubleshooting"];

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesIn(path).map((child) => `${name}/${child}`);
    return name.endsWith(".md") ? [name] : [];
  });
}

describe("developer guide", () => {
  it("lists every markdown file in the guide folders once", () => {
    const onDisk = folders.flatMap((folder) => filesIn(join(docsRoot, folder)).map((file) => `${folder}/${file}`)).sort();
    const listed = GUIDE.map((entry) => entry.file).sort();
    expect(listed).toEqual(onDisk);
    expect(new Set(GUIDE.map((entry) => entry.slug)).size).toBe(GUIDE.length);
  });

  it("resolves every relative link and heading anchor", () => {
    const sources = new Map(GUIDE.map((entry) => [entry.file, readFileSync(join(docsRoot, entry.file), "utf8")]));
    sources.set("guide.md", readFileSync(join(docsRoot, "guide.md"), "utf8"));
    const problems: string[] = [];
    for (const [file, markdown] of sources) {
      const ownHeadings = new Set(markdownHeadings(markdown).map((heading) => heading.id));
      for (const link of markdownLinks(markdown)) {
        const resolved = resolveDocHref(file, link.href);
        if (resolved.kind === "external") continue;
        if (resolved.kind === "hash") {
          if (!ownHeadings.has(resolved.hash)) problems.push(`${file} -> #${resolved.hash}`);
          continue;
        }
        if (resolved.kind !== "guide") {
          problems.push(`${file} -> ${link.href}`);
          continue;
        }
        const target = guideBySlug(resolved.slug);
        const body = target ? sources.get(target.file) : undefined;
        if (!body) {
          problems.push(`${file} -> ${link.href}`);
          continue;
        }
        if (resolved.hash && !markdownHeadings(body).some((heading) => heading.id === resolved.hash)) {
          problems.push(`${file} -> ${link.href}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
