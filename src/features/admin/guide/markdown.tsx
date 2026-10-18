import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { headingId, markdownHeadings, resolveDocHref } from "../../../domain/guide";
import { cn } from "../../../lib/utils";

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; language: string; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "rule" };

export function MarkdownDoc({ markdown, fromFile }: { markdown: string; fromFile: string }) {
  const blocks = parseMarkdown(markdown);
  const headings = markdownHeadings(markdown);
  let headingIndex = 0;
  return (
    <div className="max-w-3xl">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const id = headings[headingIndex]?.id ?? headingId(block.text, new Set());
          headingIndex += 1;
          const Tag = `h${block.level}` as "h1" | "h2" | "h3";
          return (
            <Tag
              key={index}
              id={id}
              className={cn(
                "scroll-mt-20 font-semibold tracking-tight text-ink",
                block.level === 1 && "text-[1.65rem] leading-8",
                block.level === 2 && "mt-9 border-b border-slate-200 pb-1.5 text-[1.05rem]",
                block.level === 3 && "mt-6 text-[15px]",
              )}
            >
              <a href={`#${id}`} className="hover:underline">
                {renderInline(block.text, fromFile)}
              </a>
            </Tag>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={index} className="mt-3 text-[14px] leading-6 text-slate-700">
              {renderInline(block.text, fromFile)}
            </p>
          );
        }
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index} className={cn("mt-3 space-y-1.5 pl-5 text-[14px] leading-6 text-slate-700", block.ordered ? "list-decimal" : "list-disc")}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, fromFile)}</li>
              ))}
            </List>
          );
        }
        if (block.type === "quote") {
          const status = /^Status:\s*(.+)$/.exec(block.text.trim());
          if (status) return <StatusMark key={index} label={status[1]} />;
          return (
            <blockquote key={index} className="mt-3 border-l-2 border-slate-300 pl-3 text-[14px] leading-6 text-slate-600">
              {renderInline(block.text, fromFile)}
            </blockquote>
          );
        }
        if (block.type === "code") return <CodeBlock key={index} language={block.language} text={block.text} />;
        if (block.type === "rule") return <hr key={index} className="my-8 border-slate-200" />;
        return (
          <div key={index} className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-left text-[13px] leading-5">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  {block.header.map((cell) => (
                    <th key={cell} className="px-2 py-1.5 font-medium">
                      {renderInline(cell, fromFile)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-slate-100 align-top">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-2 py-1.5 text-slate-700">
                        {renderInline(cell, fromFile)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function StatusMark({ label }: { label: string }) {
  const tone = label.startsWith("Partially") ? "bg-amber-50 text-amber-800 ring-amber-600/20" : label.startsWith("Planned") ? "bg-slate-100 text-slate-600 ring-slate-500/15" : "bg-emerald-50 text-emerald-800 ring-emerald-600/15";
  return (
    <p className="mt-3">
      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset", tone)}>{label}</span>
    </p>
  );
}

function CodeBlock({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-3">
      <button
        type="button"
        className="absolute top-2 right-2 rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/20"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto rounded-lg bg-slate-950 px-4 py-3 text-[12px] leading-5 text-slate-100">
        <code data-language={language || undefined}>{text}</code>
      </pre>
    </div>
  );
}

function renderInline(text: string, fromFile: string): ReactNode[] {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|\*[^*]+\*)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) nodes.push(<code key={key} className="rounded bg-slate-100 px-1 font-mono text-[12px] text-ink">{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) nodes.push(<strong key={key} className="font-semibold text-ink">{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const parsed = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      nodes.push(<DocLink key={key} href={parsed?.[2] ?? ""} fromFile={fromFile}>{parsed?.[1] ?? token}</DocLink>);
    }
    key += 1;
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function DocLink({ href, fromFile, children }: { href: string; fromFile: string; children: ReactNode }) {
  const resolved = resolveDocHref(fromFile, href);
  const className = "font-medium text-ink underline decoration-slate-300 underline-offset-2 hover:decoration-ink";
  if (resolved.kind === "external") {
    return (
      <a className={className} href={resolved.href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  if (resolved.kind === "hash") return <a className={className} href={`#${resolved.hash}`}>{children}</a>;
  if (resolved.kind === "guide") {
    return (
      <Link className={className} to={`/admin/guide/${resolved.slug}${resolved.hash ? `#${resolved.hash}` : ""}`}>
        {children}
      </Link>
    );
  }
  return <span>{children}</span>;
}

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", language, text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      const header = splitRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        body.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: body.join(" ") });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }
    const body: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      body.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: body.join(" ") });
  }
  return blocks;
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index];
  if (/^(#{1,3})\s+/.test(line) || line.startsWith("```") || line.startsWith(">") || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^---+$/.test(line.trim())) return true;
  return line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function splitRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}
