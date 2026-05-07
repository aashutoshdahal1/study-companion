import React from 'react';
import DOMPurify from 'dompurify';
import { createLowlight } from 'lowlight';
import { detectLanguage } from '@/lib/tiptap-extensions';

const lowlight = createLowlight();

interface RichContentRendererProps {
  html: string;
  className?: string;
  source?: string;
  timestamp?: number;
}

/**
 * Component to safely render rich HTML content with syntax highlighting
 */
export function RichContentRenderer({ 
  html, 
  className = '', 
  source,
  timestamp 
}: RichContentRendererProps) {
  const [processedHtml, setProcessedHtml] = React.useState('');
  const [sourceInfo, setSourceInfo] = React.useState<{ source: string; timestamp: number } | null>(null);

  React.useEffect(() => {
    if (!html) {
      setProcessedHtml('');
      return;
    }

    // Create a temporary div to process the HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Process code blocks with syntax highlighting
    const codeBlocks = tempDiv.querySelectorAll('pre code');
    codeBlocks.forEach((codeBlock) => {
      const code = codeBlock.textContent || '';
      const language = codeBlock.getAttribute('data-language') || detectLanguage(code);
      
      // Apply syntax highlighting
      if (language && language !== 'plaintext') {
        try {
          const result = lowlight.highlight(language, code);
          codeBlock.innerHTML = result.toString();
          codeBlock.className = `hljs language-${language}`;
        } catch (error) {
          console.warn(`Failed to highlight ${language}:`, error);
          // Fallback to plain text
          codeBlock.textContent = code;
        }
      }
    });

    // Process links for safety
    const links = tempDiv.querySelectorAll('a[href]');
    links.forEach((link) => {
      const href = link.getAttribute('href');
      if (href) {
        // Only allow safe protocols
        const safeProtocols = ['http:', 'https:', 'mailto:', 'tel:', 'ftp:'];
        const isSafe = safeProtocols.some(protocol => href.startsWith(protocol));
        
        if (!isSafe) {
          // Convert unsafe links to plain text
          const text = link.textContent || href;
          const textNode = document.createTextNode(text);
          link.parentNode?.replaceChild(textNode, link);
        } else {
          // Add safety attributes
          link.setAttribute('rel', 'noopener noreferrer');
          link.setAttribute('target', '_blank');
        }
      }
    });

    // Process images for safety
    const images = tempDiv.querySelectorAll('img');
    images.forEach((img) => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('data:') && !src.startsWith('http:') && !src.startsWith('https:')) {
        // Remove unsafe images
        img.remove();
      } else {
        // Add responsive classes
        img.className = `${img.className} max-w-full h-auto rounded`;
      }
    });

    // Process tables for better styling
    const tables = tempDiv.querySelectorAll('table');
    tables.forEach((table) => {
      table.className = `${table.className} min-w-full border-collapse border border-gray-300`;
      
      // Style table headers
      const headers = table.querySelectorAll('th');
      headers.forEach((th) => {
        th.className = `${th.className} border border-gray-300 px-4 py-2 bg-gray-50 font-semibold`;
      });
      
      // Style table cells
      const cells = table.querySelectorAll('td');
      cells.forEach((td) => {
        td.className = `${td.className} border border-gray-300 px-4 py-2`;
      });
    });

    // Process blockquotes
    const blockquotes = tempDiv.querySelectorAll('blockquote');
    blockquotes.forEach((blockquote) => {
      blockquote.className = `${blockquote.className} border-l-4 border-blue-500 pl-4 py-2 my-4 bg-blue-50 italic`;
    });

    // Process lists
    const unorderedLists = tempDiv.querySelectorAll('ul');
    unorderedLists.forEach((ul) => {
      ul.className = `${ul.className} list-disc list-inside my-2`;
    });

    const orderedLists = tempDiv.querySelectorAll('ol');
    orderedLists.forEach((ol) => {
      ol.className = `${ol.className} list-decimal list-inside my-2`;
    });

    // Process headings
    const headings = tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach((heading) => {
      const level = heading.tagName.toLowerCase();
      const baseClasses = 'font-bold my-4';
      
      switch (level) {
        case 'h1':
          heading.className = `${heading.className} ${baseClasses} text-2xl`;
          break;
        case 'h2':
          heading.className = `${heading.className} ${baseClasses} text-xl`;
          break;
        case 'h3':
          heading.className = `${heading.className} ${baseClasses} text-lg`;
          break;
        default:
          heading.className = `${heading.className} ${baseClasses} text-base`;
      }
    });

    // Process paragraphs
    const paragraphs = tempDiv.querySelectorAll('p');
    paragraphs.forEach((p) => {
      p.className = `${p.className} my-2`;
    });

    // Process inline code
    const inlineCodes = tempDiv.querySelectorAll('code:not(pre code)');
    inlineCodes.forEach((code) => {
      code.className = `${code.className} bg-gray-100 px-1 py-0.5 rounded text-sm font-mono`;
    });

    // Process strong/bold and em/italic
    const boldElements = tempDiv.querySelectorAll('strong, b');
    boldElements.forEach((bold) => {
      bold.className = `${bold.className} font-bold`;
    });

    const italicElements = tempDiv.querySelectorAll('em, i');
    italicElements.forEach((em) => {
      em.className = `${em.className} italic`;
    });

    // Get the processed HTML
    const processed = tempDiv.innerHTML;
    
    // Sanitize the final HTML
    const sanitized = DOMPurify.sanitize(processed, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'strike', 'del', 'span',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'blockquote',
        'code', 'pre',
        'a',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'hr',
        'div', 'img'
      ],
      ALLOWED_ATTR: [
        'href', 'title', 'target', 'rel',
        'class', 'style',
        'data-language', 'data-source', 'data-paste-source', 'data-paste-timestamp',
        'src', 'alt', 'width', 'height'
      ],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    });

    setProcessedHtml(sanitized);
    
    // Extract source information if present
    const sourceElement = tempDiv.querySelector('[data-paste-source]');
    if (sourceElement) {
      const pasteSource = sourceElement.getAttribute('data-paste-source');
      const pasteTimestamp = sourceElement.getAttribute('data-paste-timestamp');
      
      if (pasteSource) {
        setSourceInfo({
          source: pasteSource,
          timestamp: pasteTimestamp ? parseInt(pasteTimestamp) : Date.now()
        });
      }
    } else if (source) {
      setSourceInfo({ source, timestamp: timestamp || Date.now() });
    }
  }, [html, source, timestamp]);

  if (!processedHtml) {
    return null;
  }

  return (
    <div className={`rich-content-renderer ${className}`}>
      {sourceInfo && (
        <div className="text-xs text-gray-500 mb-2 flex items-center gap-2">
          <span>Pasted from {getSourceDisplayName(sourceInfo.source)}</span>
          <span>•</span>
          <span>{new Date(sourceInfo.timestamp).toLocaleString()}</span>
        </div>
      )}
      <div 
        dangerouslySetInnerHTML={{ __html: processedHtml }}
        className="prose prose-sm max-w-none"
      />
    </div>
  );
}

/**
 * Get display name for content source
 */
function getSourceDisplayName(source: string): string {
  switch (source) {
    case 'chatgpt':
      return 'ChatGPT';
    case 'claude':
      return 'Claude';
    case 'notion':
      return 'Notion';
    case 'google-docs':
      return 'Google Docs';
    case 'github':
      return 'GitHub';
    case 'vscode':
      return 'VS Code';
    case 'website':
      return 'Website';
    default:
      return 'Unknown Source';
  }
}

/**
 * Component for rendering code blocks with copy functionality
 */
export function CodeBlockRenderer({ 
  code, 
  language, 
  className = '' 
}: { 
  code: string; 
  language?: string; 
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const [highlightedCode, setHighlightedCode] = React.useState('');

  React.useEffect(() => {
    if (!code) {
      setHighlightedCode('');
      return;
    }

    const lang = language || detectLanguage(code);
    
    if (lang && lang !== 'plaintext') {
      try {
        const result = lowlight.highlight(lang, code);
        setHighlightedCode(result.toString());
      } catch (error) {
        console.warn(`Failed to highlight ${lang}:`, error);
        setHighlightedCode(code);
      }
    } else {
      setHighlightedCode(code);
    }
  }, [code, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  return (
    <div className={`code-block-wrapper relative group ${className}`}>
      <div className="flex items-center justify-between bg-gray-800 text-white px-4 py-2 text-sm">
        <span className="font-mono">{language || detectLanguage(code)}</span>
        <button
          onClick={handleCopy}
          className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 p-4 overflow-x-auto">
        <code 
          className={`hljs language-${language || detectLanguage(code)}`}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>
    </div>
  );
}

/**
 * Component for rendering tables with responsive design
 */
export function TableRenderer({ 
  html, 
  className = '' 
}: { 
  html: string; 
  className?: string;
}) {
  return (
    <div className={`table-wrapper overflow-x-auto my-4 ${className}`}>
      <div 
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
        className="min-w-full"
      />
    </div>
  );
}
