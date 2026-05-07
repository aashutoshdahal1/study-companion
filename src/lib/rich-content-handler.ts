import DOMPurify from 'dompurify';

export interface PastedContent {
  html: string;
  text: string;
  source: 'chatgpt' | 'claude' | 'notion' | 'google-docs' | 'github' | 'vscode' | 'website' | 'unknown';
  metadata: {
    hasFormatting: boolean;
    hasCode: boolean;
    hasTables: boolean;
    hasImages: boolean;
    hasLinks: boolean;
    elementCount: number;
  };
}

/**
 * Detects the source of pasted content based on HTML structure and metadata
 */
function detectContentSource(html: string, text: string): PastedContent['source'] {
  // ChatGPT detection
  if (html.includes('data-message-author-role="assistant"') || 
      html.includes('markdown prose') ||
      html.includes('dark:bg-gray-800')) {
    return 'chatgpt';
  }
  
  // Claude detection
  if (html.includes('claude-message') || 
      html.includes('font-claude') ||
      html.includes('prose-prose')) {
    return 'claude';
  }
  
  // Notion detection
  if (html.includes('notion') || 
      html.includes('data-block-id') ||
      html.includes('notion-link')) {
    return 'notion';
  }
  
  // Google Docs detection
  if (html.includes('docs-') || 
      html.includes('google-sheets') ||
      html.includes('docs-content')) {
    return 'google-docs';
  }
  
  // GitHub detection
  if (html.includes('github') || 
      html.includes('markdown-body') ||
      html.includes('highlight')) {
    return 'github';
  }
  
  // VS Code detection
  if (html.includes('vscode') || 
      html.includes('monaco') ||
      html.includes('code-editor')) {
    return 'vscode';
  }
  
  return 'unknown';
}

/**
 * Analyzes pasted content to extract metadata
 */
function analyzeContent(html: string): PastedContent['metadata'] {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  
  return {
    hasFormatting: /<(strong|b|em|i|u|strike|del|span|font)[^>]*>/.test(html) ||
                   /style="[^"]*"/.test(html),
    hasCode: /<(code|pre)[^>]*>/.test(html) || /```/.test(html),
    hasTables: /<table[^>]*>/.test(html),
    hasImages: /<img[^>]*>/.test(html),
    hasLinks: /<a[^>]*href=/.test(html),
    elementCount: tempDiv.querySelectorAll('*').length
  };
}

/**
 * Sanitizes HTML content while preserving formatting
 */
function sanitizeHtml(html: string): string {
  const config = {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'strike', 'del', 'span',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'blockquote',
      'code', 'pre',
      'a',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr',
      'div'
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'target', 'rel',
      'class', 'style',
      'data-language', 'data-theme'
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_DOM_IMPORT: false,
    SANITIZE_DOM: true,
    SANITIZE_NAMED_PROPS: true,
    WHOLE_DOCUMENT: false,
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: null,
      attributeNameCheck: null,
      allowCustomizedBuiltInElements: false
    }
  };

  return DOMPurify.sanitize(html, config);
}

/**
 * Converts HTML to TipTap-compatible format
 */
function convertToTipTapFormat(html: string): string {
  const sanitized = sanitizeHtml(html);
  
  // Convert common patterns to TipTap-compatible format
  let processed = sanitized;
  
  // Convert code blocks with language info
  processed = processed.replace(
    /<pre[^>]*><code[^>]*data-language="([^"]*)"[^>]*>([\s\S]*?)<\/code><\/pre>/g,
    (match, language, code) => {
      const cleanCode = code.replace(/<br\s*\/?>/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return `<pre><code class="language-${language}">${cleanCode}</code></pre>`;
    }
  );
  
  // Convert inline code
  processed = processed.replace(/<code[^>]*>([^<]*)<\/code>/g, '<code>$1</code>');
  
  // Convert tables to ensure proper structure
  processed = processed.replace(/<table([^>]*)>/g, '<table$1>');
  processed = processed.replace(/<thead>/g, '<thead>');
  processed = processed.replace(/<tbody>/g, '<tbody>');
  
  // Ensure proper list structure
  processed = processed.replace(/<li>\s*<p>(.*?)<\/p>\s*<\/li>/g, '<li>$1</li>');
  
  // Convert blockquotes
  processed = processed.replace(/<blockquote>\s*<p>(.*?)<\/p>\s*<\/blockquote>/g, '<blockquote>$1</blockquote>');
  
  return processed;
}

/**
 * Extracts plain text from HTML
 */
function extractPlainText(html: string): string {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  
  // Replace line breaks with spaces temporarily
  tempDiv.querySelectorAll('br').forEach(br => br.replaceWith(' '));
  tempDiv.querySelectorAll('p, div, li, th, td').forEach(el => {
    if (el.nextSibling && el.nextSibling.nodeType === Node.ELEMENT_NODE) {
      el.appendChild(document.createTextNode(' '));
    }
  });
  
  return tempDiv.textContent || tempDiv.innerText || '';
}

/**
 * Main function to handle clipboard paste events
 */
export async function handleRichPaste(event: ClipboardEvent): Promise<PastedContent | null> {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return null;
  
  // Try to get HTML content first
  let html = clipboardData.getData('text/html');
  let text = clipboardData.getData('text/plain');
  
  // If no HTML, try RTF (some applications use this)
  if (!html) {
    const rtf = clipboardData.getData('text/rtf');
    if (rtf) {
      // Basic RTF to HTML conversion (simplified)
      html = rtf
        .replace(/\\par/g, '<br>')
        .replace(/\\b/g, '<strong>')
        .replace(/\\b0/g, '</strong>')
        .replace(/\\i/g, '<em>')
        .replace(/\\i0/g, '</em>')
        .replace(/\\u([0-9]+)\??/g, (match, unicode) => String.fromCharCode(parseInt(unicode)))
        .replace(/\{[^}]*\\[^}]*\}/g, '') // Remove RTF commands
        .replace(/\\[^a-zA-Z]/g, ''); // Remove lone backslashes
    }
  }
  
  // If still no HTML, create basic HTML from plain text
  if (!html && text) {
    html = text
      .split('\n')
      .map(line => line.trim() ? `<p>${line}</p>` : '<br>')
      .join('');
  }
  
  if (!html && !text) return null;
  
  // Ensure we have both HTML and text
  if (!text) text = extractPlainText(html);
  if (!html) html = text;
  
  const source = detectContentSource(html, text);
  const metadata = analyzeContent(html);
  const processedHtml = convertToTipTapFormat(html);
  
  return {
    html: processedHtml,
    text,
    source,
    metadata
  };
}

/**
 * Validates if pasted content should be processed as rich content
 */
export function shouldProcessAsRichContent(content: PastedContent): boolean {
  return content.metadata.hasFormatting || 
         content.metadata.hasCode || 
         content.metadata.hasTables || 
         content.metadata.hasImages || 
         content.metadata.hasLinks ||
         content.metadata.elementCount > 3;
}

/**
 * Creates a fallback plain text version for unsupported content
 */
export function createPlainTextFallback(content: PastedContent): string {
  return content.text
    .split('\n')
    .map(line => line.trim() ? `<p>${line}</p>` : '')
    .join('');
}
