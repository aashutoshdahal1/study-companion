import React, { useState, useRef, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { createLowlight } from 'lowlight';
import { detectLanguage } from '@/lib/tiptap-extensions';

const lowlight = createLowlight();

interface EditableRichContentProps {
  html: string;
  onChange: (html: string) => void;
  className?: string;
  source?: string;
  timestamp?: number;
  editMode?: 'inline' | 'block' | 'both';
  placeholder?: string;
}

/**
 * Component that provides Notion-like inline editing for rich content
 */
export function EditableRichContent({ 
  html, 
  onChange, 
  className = '', 
  source,
  timestamp,
  editMode = 'both',
  placeholder = 'Start typing...'
}: EditableRichContentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingElement, setEditingElement] = useState<HTMLElement | null>(null);
  const [sourceInfo, setSourceInfo] = useState<{ source: string; timestamp: number } | null>(null);
  const [processedHtml, setProcessedHtml] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const [lastValidHtml, setLastValidHtml] = useState(html);

  // Process HTML on mount and when source changes
  useEffect(() => {
    if (!html) {
      setProcessedHtml('');
      return;
    }

    const processed = processHtmlForEditing(html);
    setProcessedHtml(processed);
    setLastValidHtml(html);

    // Extract source information
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
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

  // Handle double-click to edit
  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    const editableElement = findEditableParent(target);
    
    if (editableElement && shouldAllowEditing(editableElement)) {
      startEditing(editableElement);
    }
  }, []);

  // Find the nearest editable parent element
  const findEditableParent = (element: HTMLElement): HTMLElement | null => {
    const editableTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'DIV'];
    let current = element;
    
    while (current && current !== contentRef.current) {
      if (editableTags.includes(current.tagName)) {
        return current;
      }
      current = current.parentElement;
    }
    
    return null;
  };

  // Check if element should be editable
  const shouldAllowEditing = (element: HTMLElement): boolean => {
    const tagName = element.tagName.toLowerCase();
    
    // Don't allow editing of code blocks, images, or special elements
    if (tagName === 'code' || tagName === 'pre' || tagName === 'img') {
      return false;
    }
    
    // Check for no-edit class
    if (element.classList.contains('no-edit') || element.classList.contains('code-block')) {
      return false;
    }
    
    return true;
  };

  // Start editing an element
  const startEditing = (element: HTMLElement) => {
    if (isEditing) return;
    
    setIsEditing(true);
    setEditingElement(element);
    
    // Make content editable
    element.contentEditable = 'true';
    element.classList.add('editing');
    element.focus();
    
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    
    // Add event listeners
    element.addEventListener('blur', handleBlur);
    element.addEventListener('keydown', handleKeyDown);
    element.addEventListener('input', handleInput);
  };

  // Stop editing
  const stopEditing = useCallback(() => {
    if (!editingElement) return;
    
    // Remove content editable
    editingElement.contentEditable = 'false';
    editingElement.classList.remove('editing');
    
    // Remove event listeners
    editingElement.removeEventListener('blur', handleBlur);
    editingElement.removeEventListener('keydown', handleKeyDown);
    editingElement.removeEventListener('input', handleInput);
    
    setIsEditing(false);
    setEditingElement(null);
  }, [editingElement]);

  // Handle blur event
  const handleBlur = useCallback(() => {
    // Small delay to allow other interactions
    setTimeout(() => {
      if (editingElement && document.activeElement !== editingElement) {
        stopEditing();
      }
    }, 100);
  }, [editingElement, stopEditing]);

  // Handle key events
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!editingElement) return;
    
    switch (event.key) {
      case 'Enter':
        if (editingElement.tagName !== 'LI' && editingElement.tagName !== 'TD' && editingElement.tagName !== 'TH') {
          event.preventDefault();
          // Create new paragraph
          const newParagraph = document.createElement('p');
          newParagraph.textContent = '';
          newParagraph.contentEditable = 'true';
          newParagraph.classList.add('editing');
          
          editingElement.parentNode?.insertBefore(newParagraph, editingElement.nextSibling);
          stopEditing();
          startEditing(newParagraph);
        }
        break;
        
      case 'Escape':
        event.preventDefault();
        stopEditing();
        break;
        
      case 'Tab':
        event.preventDefault();
        // Handle tab navigation
        const nextEditable = findNextEditable(editingElement);
        if (nextEditable) {
          stopEditing();
          startEditing(nextEditable);
        }
        break;
    }
  }, [editingElement, stopEditing]);

  // Handle input changes
  const handleInput = useCallback(() => {
    if (!contentRef.current) return;
    
    const newHtml = contentRef.current.innerHTML;
    const sanitized = DOMPurify.sanitize(newHtml, {
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
        'data-language', 'data-source', 'data-paste-source', 'data-paste-timestamp'
      ],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    });
    
    onChange(sanitized);
  }, [onChange]);

  // Find next editable element
  const findNextEditable = (current: HTMLElement): HTMLElement | null => {
    const allElements = contentRef.current?.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, div');
    if (!allElements) return null;
    
    const elements = Array.from(allElements);
    const currentIndex = elements.indexOf(current);
    
    for (let i = currentIndex + 1; i < elements.length; i++) {
      if (shouldAllowEditing(elements[i])) {
        return elements[i];
      }
    }
    
    return null;
  };

  // Process HTML for editing
  const processHtmlForEditing = (html: string): string => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Add edit indicators to editable elements
    const editableElements = tempDiv.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, div');
    editableElements.forEach((element) => {
      const htmlElement = element as HTMLElement;
      if (shouldAllowEditing(htmlElement)) {
        htmlElement.classList.add('editable-content');
        htmlElement.setAttribute('title', 'Double-click to edit');
      }
    });

    // Process code blocks with syntax highlighting
    const codeBlocks = tempDiv.querySelectorAll('pre code');
    codeBlocks.forEach((codeBlock) => {
      const code = codeBlock.textContent || '';
      const language = codeBlock.getAttribute('data-language') || detectLanguage(code);
      
      if (language && language !== 'plaintext') {
        try {
          const result = lowlight.highlight(language, code);
          codeBlock.innerHTML = result.toString();
          codeBlock.className = `hljs language-${language}`;
        } catch (error) {
          console.warn(`Failed to highlight ${language}:`, error);
        }
      }
    });

    return tempDiv.innerHTML;
  };

  return (
    <div className={`editable-rich-content ${className}`}>
      {sourceInfo && (
        <div className="text-xs text-gray-500 mb-2 flex items-center gap-2">
          <span>Pasted from {getSourceDisplayName(sourceInfo.source)}</span>
          <span>•</span>
          <span>{new Date(sourceInfo.timestamp).toLocaleString()}</span>
          {isEditing && (
            <>
              <span>•</span>
              <span className="text-blue-600">Editing mode</span>
            </>
          )}
        </div>
      )}
      
      <div 
        ref={contentRef}
        className="rich-content-container prose prose-sm max-w-none"
        onDoubleClick={handleDoubleClick}
        dangerouslySetInnerHTML={{ __html: processedHtml }}
        style={{ minHeight: processedHtml ? 'auto' : '100px' }}
      />
      
      {!processedHtml && (
        <div className="text-gray-400 text-center py-8" onDoubleClick={handleDoubleClick}>
          {placeholder}
        </div>
      )}
      
          </div>
  );
}

/**
 * Component for editable code blocks
 */
export function EditableCodeBlock({ 
  code, 
  language, 
  onChange, 
  className = '' 
}: { 
  code: string; 
  language?: string; 
  onChange: (code: string) => void;
  className?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedCode, setEditedCode] = useState(code);
  const [highlightedCode, setHighlightedCode] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditedCode(code);
    updateHighlight(code);
  }, [code]);

  const updateHighlight = (text: string) => {
    const lang = language || detectLanguage(text);
    
    if (lang && lang !== 'plaintext') {
      try {
        const result = lowlight.highlight(lang, text);
        setHighlightedCode(result.toString());
      } catch (error) {
        setHighlightedCode(text);
      }
    } else {
      setHighlightedCode(text);
    }
  };

  const handleDoubleClick = () => {
    setIsEditing(true);
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }, 0);
  };

  const handleBlur = () => {
    setIsEditing(false);
    onChange(editedCode);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    setEditedCode(newCode);
    updateHighlight(newCode);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditedCode(code); // Reset to original
      onChange(code);
    }
  };

  return (
    <div className={`editable-code-block relative group ${className}`}>
      <div className="flex items-center justify-between bg-gray-800 text-white px-4 py-2 text-sm">
        <span className="font-mono">{language || detectLanguage(code)}</span>
        <span className="text-xs text-gray-400">
          {isEditing ? 'Editing...' : 'Double-click to edit'}
        </span>
      </div>
      
      <div className="relative bg-gray-900">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editedCode}
            onChange={handleInputChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-full h-auto min-h-[100px] bg-transparent text-gray-100 p-4 font-mono text-sm resize-none outline-none"
            style={{ 
              fontFamily: "'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace",
              lineHeight: '1.5',
              tabSize: 2
            }}
            spellCheck={false}
            autoFocus
          />
        ) : (
          <pre 
            className="bg-gray-900 text-gray-100 p-4 overflow-x-auto cursor-pointer"
            onDoubleClick={handleDoubleClick}
          >
            <code 
              className={`hljs language-${language || detectLanguage(code)}`}
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * Component for editable tables
 */
export function EditableTable({ 
  html, 
  onChange, 
  className = '' 
}: { 
  html: string; 
  onChange: (html: string) => void;
  className?: string;
}) {
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [tableData, setTableData] = useState<string[][]>([]);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    parseTableHtml(html);
  }, [html]);

  const parseTableHtml = (tableHtml: string) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = tableHtml;
    const table = tempDiv.querySelector('table');
    
    if (!table) return;
    
    const rows = Array.from(table.querySelectorAll('tr'));
    const data = rows.map(row => 
      Array.from(row.querySelectorAll('td, th')).map(cell => cell.textContent || '')
    );
    
    setTableData(data);
  };

  const handleCellDoubleClick = (rowIndex: number, colIndex: number) => {
    setEditingCell({ row: rowIndex, col: colIndex });
  };

  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    const newData = [...tableData];
    newData[rowIndex][colIndex] = value;
    setTableData(newData);
  };

  const handleCellBlur = () => {
    if (editingCell) {
      generateTableHtml();
      setEditingCell(null);
    }
  };

  const generateTableHtml = () => {
    const tempDiv = document.createElement('div');
    const table = document.createElement('table');
    table.className = 'min-w-full border-collapse border border-gray-300';
    
    tableData.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      
      row.forEach((cell, colIndex) => {
        const cellElement = rowIndex === 0 ? document.createElement('th') : document.createElement('td');
        cellElement.textContent = cell;
        cellElement.className = rowIndex === 0 
          ? 'border border-gray-300 px-4 py-2 bg-gray-50 font-semibold'
          : 'border border-gray-300 px-4 py-2';
        tr.appendChild(cellElement);
      });
      
      table.appendChild(tr);
    });
    
    tempDiv.appendChild(table);
    onChange(tempDiv.innerHTML);
  };

  return (
    <div className={`editable-table-wrapper overflow-x-auto my-4 ${className}`}>
      <table className="min-w-full border-collapse border border-gray-300">
        {tableData.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, colIndex) => (
              <Cell
                key={`${rowIndex}-${colIndex}`}
                isHeader={rowIndex === 0}
                content={cell}
                isEditing={editingCell?.row === rowIndex && editingCell?.col === colIndex}
                onDoubleClick={() => handleCellDoubleClick(rowIndex, colIndex)}
                onChange={(value) => handleCellChange(rowIndex, colIndex, value)}
                onBlur={handleCellBlur}
              />
            ))}
          </tr>
        ))}
      </table>
    </div>
  );
}

function Cell({ 
  isHeader, 
  content, 
  isEditing, 
  onDoubleClick, 
  onChange, 
  onBlur 
}: {
  isHeader: boolean;
  content: string;
  isEditing: boolean;
  onDoubleClick: () => void;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const [value, setValue] = useState(content);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(content);
  }, [content]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    onDoubleClick();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    onChange(e.target.value);
  };

  const handleBlur = () => {
    onBlur();
  };

  const CellComponent = isHeader ? 'th' : 'td';

  return (
    <CellComponent
      className={`
        border border-gray-300 px-4 py-2
        ${isHeader ? 'bg-gray-50 font-semibold' : ''}
        ${isEditing ? 'outline-2 outline-blue-500 outline-offset-[-2px]' : ''}
        cursor-pointer hover:bg-gray-100 transition-colors
      `}
      onDoubleClick={handleDoubleClick}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          className="w-full bg-transparent outline-none"
          style={{ minWidth: '50px' }}
        />
      ) : (
        <span>{content}</span>
      )}
    </CellComponent>
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
