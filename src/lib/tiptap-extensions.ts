import { Extension } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Link } from '@tiptap/extension-link';
import { createLowlight } from 'lowlight';

const lowlight = createLowlight();

// Import common language syntax highlighting
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import html from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';
import plaintext from 'highlight.js/lib/languages/plaintext';

// Register languages with lowlight
lowlight.register('javascript', javascript);
lowlight.register('typescript', typescript);
lowlight.register('python', python);
lowlight.register('java', java);
lowlight.register('cpp', cpp);
lowlight.register('css', css);
lowlight.register('html', html);
lowlight.register('xml', html);
lowlight.register('json', json);
lowlight.register('markdown', markdown);
lowlight.register('sql', sql);
lowlight.register('bash', bash);
lowlight.register('plaintext', plaintext);

/**
 * Custom extension for enhanced code blocks with syntax highlighting
 */
export const EnhancedCodeBlock = CodeBlockLowlight.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      lowlight,
      defaultLanguage: 'plaintext',
      HTMLAttributes: {
        class: 'enhanced-code-block',
      },
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: null,
        parseHTML: element => element.getAttribute('data-language') || this.options.defaultLanguage,
        renderHTML: attributes => {
          if (!attributes.language) {
            return {};
          }
          return {
            'data-language': attributes.language,
            class: `language-${attributes.language}`,
          };
        },
      },
      source: {
        default: null,
        parseHTML: element => element.getAttribute('data-source'),
        renderHTML: attributes => {
          if (!attributes.source) {
            return {};
          }
          return {
            'data-source': attributes.source,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
      },
      {
        tag: 'code',
        preserveWhitespace: 'full',
        priority: 100,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      HTMLAttributes,
      [
        'code',
        {
          class: HTMLAttributes.class || '',
          'data-language': HTMLAttributes['data-language'],
          'data-source': HTMLAttributes['data-source'],
        },
        0,
      ],
    ];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setCodeBlock: attributes => ({ commands }) => {
        return commands.toggleWrap(this.name, attributes);
      },
    };
  },
});

/**
 * Custom extension for enhanced links with safety and metadata
 */
export const EnhancedLink = Link.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      openOnClick: true,
      linkOnPaste: true,
      autolink: true,
      protocols: ['http', 'https', 'mailto', 'tel', 'ftp', 'file'],
      HTMLAttributes: {
        class: 'enhanced-link',
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      source: {
        default: null,
        parseHTML: element => element.getAttribute('data-source'),
        renderHTML: attributes => {
          if (!attributes.source) {
            return {};
          }
          return {
            'data-source': attributes.source,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[href]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Only allow safe protocols
    const href = HTMLAttributes.href;
    if (href && !this.options.protocols.some(protocol => href.startsWith(protocol + ':'))) {
      return ['span', { class: 'unsafe-link' }, 0];
    }

    return [
      'a',
      {
        ...HTMLAttributes,
        'data-source': HTMLAttributes['data-source'],
      },
      0,
    ];
  },
});

/**
 * Custom extension for enhanced tables with paste support
 */
export const EnhancedTable = Table.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      HTMLAttributes: {
        class: 'enhanced-table',
      },
      cellMinWidth: 100,
      cellMaxWidth: 'auto',
      handleWidth: 5,
      resizeObserver: true,
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      source: {
        default: null,
        parseHTML: element => element.getAttribute('data-source'),
        renderHTML: attributes => {
          if (!attributes.source) {
            return {};
          }
          return {
            'data-source': attributes.source,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'table',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'table',
      {
        ...HTMLAttributes,
        'data-source': HTMLAttributes['data-source'],
      },
      [
        'tbody',
        0,
      ],
    ];
  },
});

/**
 * Custom extension for enhanced highlighting with source tracking
 */
export const EnhancedHighlight = Highlight.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      multicolor: true,
      HTMLAttributes: {
        class: 'enhanced-highlight',
      },
    };
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      source: {
        default: null,
        parseHTML: element => element.getAttribute('data-source'),
        renderHTML: attributes => {
          if (!attributes.source) {
            return {};
          }
          return {
            'data-source': attributes.source,
          };
        },
      },
    };
  },
});

/**
 * Extension for paste metadata tracking
 */
export const PasteMetadata = Extension.create({
  name: 'pasteMetadata',

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'pasted-content',
      },
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: [
          'heading',
          'paragraph',
          'bulletList',
          'orderedList',
          'listItem',
          'blockquote',
          'codeBlock',
          'table',
          'image',
          'link',
        ],
        attributes: {
          pasteSource: {
            default: null,
            parseHTML: element => element.getAttribute('data-paste-source'),
            renderHTML: attributes => {
              if (!attributes.pasteSource) {
                return {};
              }
              return {
                'data-paste-source': attributes.pasteSource,
              };
            },
          },
          pasteTimestamp: {
            default: null,
            parseHTML: element => element.getAttribute('data-paste-timestamp'),
            renderHTML: attributes => {
              if (!attributes.pasteTimestamp) {
                return {};
              }
              return {
                'data-paste-timestamp': attributes.pasteTimestamp,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setPasteMetadata: (source: string, timestamp?: number) => ({ tr, state }) => {
        const { from, to } = state.selection;
        const nodes = [];
        
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.isInline || node.isBlock) {
            nodes.push({ node, pos });
          }
        });

        nodes.forEach(({ node, pos }) => {
          tr.setNodeMarkup(pos + 1, undefined, {
            ...node.attrs,
            pasteSource: source,
            pasteTimestamp: timestamp || Date.now(),
          });
        });

        return true;
      },
    } as any;
  },
});

/**
 * Export all enhanced extensions
 */
export const enhancedExtensions = [
  EnhancedCodeBlock,
  EnhancedLink,
  EnhancedTable,
  EnhancedHighlight,
  PasteMetadata,
  TableRow,
  TableCell,
  TableHeader,
];

/**
 * Utility function to detect and set language for code blocks
 */
export function detectLanguage(code: string): string {
  const trimmed = code.trim();
  
  // Simple language detection patterns
  if (trimmed.includes('def ') && trimmed.includes(':')) return 'python';
  if (trimmed.includes('function ') || trimmed.includes('const ') || trimmed.includes('let ')) return 'javascript';
  if (trimmed.includes('interface ') || trimmed.includes('type ') || trimmed.includes('as ')) return 'typescript';
  if (trimmed.includes('public class ') || trimmed.includes('import java')) return 'java';
  if (trimmed.includes('#include') || trimmed.includes('std::')) return 'cpp';
  if (trimmed.includes('{') && trimmed.includes('}') && trimmed.includes(';')) return 'css';
  if (trimmed.includes('<!DOCTYPE') || trimmed.includes('<html>')) return 'html';
  if (trimmed.includes('{') && trimmed.includes('"')) return 'json';
  if (trimmed.includes('# ') || trimmed.includes('## ')) return 'markdown';
  if (trimmed.includes('SELECT ') || trimmed.includes('FROM ')) return 'sql';
  if (trimmed.includes('#!/bin/bash') || trimmed.includes('echo ')) return 'bash';
  
  return 'plaintext';
}
