const modules = import.meta.glob("../../../../docs/{getting-started,architecture,workflows,statuses,customization,troubleshooting}/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const byFile = new Map<string, string>();
for (const [path, markdown] of Object.entries(modules)) {
  const file = path.split("/docs/")[1];
  if (file && typeof markdown === "string") byFile.set(file, markdown);
}

export function guideSource(file: string) {
  return byFile.get(file) ?? "";
}
