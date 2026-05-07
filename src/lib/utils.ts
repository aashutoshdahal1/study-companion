import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function escapeHtmlChars(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(text: string): string {
  return escapeHtmlChars(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

const isTableRow = (line: string) => {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|");
};
const isTableSeparator = (line: string) => /^\|[\s|:\-]+\|$/.test(line.trim());

function parseTableRow(line: string): string[] {
  return line.trim().slice(1, -1).split("|").map((c) => c.trim());
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Markdown table: header row followed by separator row
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableRow(trimmed);
      i += 2; // skip header + separator
      const bodyRows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        bodyRows.push(parseTableRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headers.map((h) => `<th>${inlineMarkdown(h)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${bodyRows
        .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
      result.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const code = escapeHtmlChars(codeLines.join("\n"));
      result.push(`<pre><code class="language-${lang}">${code}</code></pre>`);
      continue;
    }

    // Headings
    const h3 = trimmed.match(/^### (.+)$/);
    if (h3) { result.push(`<h3>${inlineMarkdown(h3[1])}</h3>`); i++; continue; }
    const h2 = trimmed.match(/^## (.+)$/);
    if (h2) { result.push(`<h2>${inlineMarkdown(h2[1])}</h2>`); i++; continue; }
    const h1 = trimmed.match(/^# (.+)$/);
    if (h1) { result.push(`<h1>${inlineMarkdown(h1[1])}</h1>`); i++; continue; }

    // Horizontal rule
    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) {
      result.push("<hr>");
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      result.push(`<blockquote><p>${inlineMarkdown(trimmed.slice(2))}</p></blockquote>`);
      i++;
      continue;
    }

    // Unordered list — collect consecutive items
    if (/^[-*+] /.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+] /.test(lines[i].trim())) {
        items.push(`<li>${inlineMarkdown(lines[i].trim().slice(2))}</li>`);
        i++;
      }
      result.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list — collect consecutive items
    if (/^\d+\. /.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
        const match = lines[i].trim().match(/^\d+\. (.+)$/);
        items.push(`<li>${inlineMarkdown(match ? match[1] : "")}</li>`);
        i++;
      }
      result.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    result.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    i++;
  }

  return result.join("");
}
