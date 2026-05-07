import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TipTapImage from "@tiptap/extension-image";
import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Code,
  Undo,
  Redo,
  Hash,
  Sparkles,
  Check,
  X,
  Image,
} from "lucide-react";
import { handleRichPaste, shouldProcessAsRichContent, createPlainTextFallback } from "@/lib/rich-content-handler";
import { enhancedExtensions, detectLanguage } from "@/lib/tiptap-extensions";
import { EditableRichContent, EditableCodeBlock, EditableTable } from "@/components/EditableRichContent";

interface GrammarCorrection {
  id: string;
  text: string;
  corrections: Array<{
    type: string;
    description: string;
    corrections: Array<{
      text: string;
      explanation?: string;
    }>;
  }>;
}

async function correctGrammar(text: string): Promise<string> {
  try {
    const res = await fetch('https://orthographe.reverso.net/api/v1/Spelling/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        language: 'eng',
        text,
        getCorrectionDetails: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`Reverso API returned an error: ${res.status}`);
    }

    const data = await res.json();
    console.log('Reverso response:', data);
    
    // Extract corrected text from the response
    if (data.text && data.text !== text) {
      return data.text;
    }
    
    // If no direct correction, check if there are corrections to apply
    if (data.corrections && data.corrections.length > 0) {
      let correctedText = text;
      data.corrections.forEach((correction: any) => {
        if (correction.corrections && correction.corrections.length > 0) {
          const bestCorrection = correction.corrections[0];
          if (bestCorrection.text) {
            correctedText = correctedText.replace(
              new RegExp(correction.type || '', 'gi'),
              bestCorrection.text
            );
          }
        }
      });
      return correctedText;
    }
    
    return text;
  } catch (err) {
    console.error('Grammar correction failed:', err);
    return text;
  }
}

function normalizeEditorHtml(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html || "";

  const blocks: string[] = [];

  Array.from(container.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        blocks.push(`<p>${text}</p>`);
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (tag === "p" && /<br\s*\/?>/i.test(element.innerHTML)) {
      element.innerHTML
        .split(/<br\s*\/?>/i)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .forEach((segment) => {
          blocks.push(`<p>${segment}</p>`);
        });
      return;
    }

    blocks.push(element.outerHTML);
  });

  return blocks.join("");
}

interface NotesEditorProps {
  value: string;
  onChange: (html: string) => void;
  onInsertPageTag?: () => void;
}

function ToolbarButton({
  onClick,
  active,
  children,
  title,
  className,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      onClick={onClick}
      className={`${active ? "bg-accent text-accent-foreground" : ""} ${className || ""}`}
    >
      {children}
    </Button>
  );
}

function Toolbar({ editor, onInsertPageTag, triggerImageUpload, isUploadingImage, editMode, onEditModeChange }: { 
  editor: Editor | null; 
  onInsertPageTag?: () => void;
  triggerImageUpload?: () => void;
  isUploadingImage?: boolean;
  editMode: 'editor' | 'editable';
  onEditModeChange: (mode: 'editor' | 'editable') => void;
}) {
  if (!editor) return null;

  const applyHeading = (level: 1 | 2 | 3) => {
    const { from, to } = editor.state.selection;

    editor
      .chain()
      .focus()
      .setTextSelection(from)
      .toggleHeading({ level })
      .run();

    if (from !== to) {
      editor.commands.setTextSelection(from);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-toolbar px-2 py-1.5">
      <ToolbarButton title="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => applyHeading(1)}>
        <Heading1 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => applyHeading(2)}>
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => applyHeading(3)}>
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>
      <div className="w-px h-5 bg-border mx-1" />
      <ToolbarButton title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="h-4 w-4" />
      </ToolbarButton>
      <div className="w-px h-5 bg-border mx-1" />
      <ToolbarButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Ordered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton title="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton 
        title="Insert image" 
        onClick={triggerImageUpload}
        className={isUploadingImage ? "opacity-50" : ""}
      >
        <Image className="h-4 w-4" />
      </ToolbarButton>
      <div className="w-px h-5 bg-border mx-1" />
      {onInsertPageTag && (
        <ToolbarButton title="Insert current page tag" onClick={onInsertPageTag}>
          <Hash className="h-4 w-4" />
        </ToolbarButton>
      )}
      <div className="w-px h-5 bg-border mx-1" />
      <ToolbarButton 
        title={editMode === 'editor' ? "Switch to editable mode" : "Switch to editor mode"} 
        active={editMode === 'editable'}
        onClick={() => onEditModeChange(editMode === 'editor' ? 'editable' : 'editor')}
        className="ml-2"
      >
        <Sparkles className="h-4 w-4" />
      </ToolbarButton>
      <div className="ml-auto flex items-center gap-0.5">
        <ToolbarButton title="Undo" onClick={() => editor.chain().focus().undo().run()}>
          <Undo className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Redo" onClick={() => editor.chain().focus().redo().run()}>
          <Redo className="h-4 w-4" />
        </ToolbarButton>
      </div>
    </div>
  );
}

export function NotesEditor({ value, onChange, onInsertPageTag }: NotesEditorProps) {
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [showCorrectionMenu, setShowCorrectionMenu] = useState(false);
  const [correctionMenuPos, setCorrectionMenuPos] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState("");
  const [correctedText, setCorrectedText] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [editMode, setEditMode] = useState<'editor' | 'editable'>('editor');
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      ...enhancedExtensions,
      TipTapImage.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: "max-w-full h-auto rounded border border-border my-2",
        },
      }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: "prose-notes focus:outline-none px-6 py-5 max-w-none",
        "data-placeholder": "Start writing your notes…",
      },
      handlePaste: (view, event, slice) => {
        // Handle rich content paste
        handleRichPaste(event).then(pastedContent => {
          if (pastedContent && shouldProcessAsRichContent(pastedContent)) {
            event.preventDefault();
            
            // Insert the processed HTML content
            const { state, dispatch } = view;
            const { from } = state.selection;
            
            // Create a transaction to insert the content
            const tr = state.tr.insert(
              from,
              state.schema.text(pastedContent.text, [
                state.schema.mark('pasteMetadata', {
                  pasteSource: pastedContent.source,
                  pasteTimestamp: Date.now()
                })
              ])
            );
            
            dispatch(tr);
            
            // If there's HTML content, also insert it
            if (pastedContent.html && pastedContent.html !== pastedContent.text) {
              setTimeout(() => {
                // Convert HTML to ProseMirror nodes and insert
                const div = document.createElement('div');
                div.innerHTML = pastedContent.html;
                const nodes = [];
                
                div.childNodes.forEach(node => {
                  if (node.nodeType === Node.ELEMENT_NODE) {
                    const element = node as HTMLElement;
                    // Handle different element types
                    if (element.tagName === 'PRE' && element.querySelector('code')) {
                      const codeEl = element.querySelector('code');
                      const language = codeEl?.getAttribute('data-language') || detectLanguage(codeEl?.textContent || '');
                      const codeContent = codeEl?.textContent || '';
                      
                      // Insert as code block
                      if (editor) {
                        editor.commands.setCodeBlock({ language });
                        editor.commands.insertContent(codeContent);
                      }
                    } else if (element.tagName === 'TABLE') {
                      // Handle table insertion
                      if (editor) {
                        editor.commands.insertContent(element.outerHTML);
                      }
                    } else {
                      // Handle other elements
                      if (editor) {
                        editor.commands.insertContent(element.outerHTML);
                      }
                    }
                  }
                });
              }, 0);
            }
            
            return true;
          }
        }).catch(err => {
          console.error('Error handling rich paste:', err);
        });
        
        // Fall back to default paste handling
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      console.log('Editor updated, HTML:', editor.getHTML());
      onChange(normalizeEditorHtml(editor.getHTML()));
    },
  });

  // Sync external value changes (e.g. switching documents)
  useEffect(() => {
    if (!editor) return;
    const normalizedValue = normalizeEditorHtml(value || "");
    if (normalizedValue !== editor.getHTML()) {
      editor.commands.setContent(normalizedValue, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

  // Debug editor state
  useEffect(() => {
    if (editor) {
      console.log('Editor state:', {
        isEditable: editor.isEditable,
        isFocused: editor.isFocused,
        isEmpty: editor.isEmpty,
        HTML: editor.getHTML().substring(0, 100) + '...'
      });
    }
  }, [editor]);

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const text = range.toString().trim();
    
    if (text.length > 3) { // Only show for text longer than 3 characters
      setSelectedText(text);
      const rect = range.getBoundingClientRect();
      setCorrectionMenuPos({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 10 // Position below the text instead of above
      });
      setShowCorrectionMenu(true);
    }
  };

  const handleMouseDown = () => {
    // Clear any existing long press timer
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    
    // Start long press timer
    longPressTimer.current = setTimeout(() => {
      handleTextSelection();
    }, 500); // 500ms long press
  };

  const handleMouseUp = () => {
    // Clear timer if mouse is released quickly
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleGrammarCorrection = async () => {
    if (!selectedText || isCorrecting) return;
    
    setIsCorrecting(true);
    
    try {
      const corrected = await correctGrammar(selectedText);
      if (corrected !== selectedText) {
        setCorrectedText(corrected);
      } else {
        setCorrectedText("No corrections needed");
      }
    } catch (error) {
      console.error('Grammar correction failed:', error);
      setCorrectedText("Correction failed");
    } finally {
      setIsCorrecting(false);
    }
  };

  const handleAcceptCorrection = () => {
    if (!correctedText || correctedText === "No corrections needed" || correctedText === "Correction failed") return;
    
    // Replace selected text in editor
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(correctedText));
      selection.removeAllRanges();
      selection.addRange(range);
    }
    
    // Trigger editor update
    if (editor) {
      onChange(normalizeEditorHtml(editor.getHTML()));
    }
    
    // Close menu and reset state
    setShowCorrectionMenu(false);
    setSelectedText("");
    setCorrectedText("");
  };

  const handleRejectCorrection = () => {
    // Close menu and reset state without making changes
    setShowCorrectionMenu(false);
    setSelectedText("");
    setCorrectedText("");
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('Image upload triggered');
    const file = event.target.files?.[0];
    if (!file) {
      console.log('No file selected');
      return;
    }

    console.log('File selected:', file.name, file.type, file.size);

    // Check file type
    if (!file.type.startsWith('image/')) {
      console.log('Not an image file:', file.type);
      alert('Please select an image file');
      return;
    }

    // Check file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      console.log('File too large:', file.size);
      alert('Image size should be less than 5MB');
      return;
    }

    console.log('Starting image upload...');
    setIsUploadingImage(true);

    try {
      const imageUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
            return;
          }

          reject(new Error("Failed to read image file"));
        };
        reader.onerror = () => reject(reader.error || new Error("Failed to read image file"));
        reader.readAsDataURL(file);
      });

      console.log('Image data URL created:', imageUrl.substring(0, 60) + '...');
      
      // Insert image into editor - simplified for testing
      if (editor && editor.isEditable) {
        console.log('Inserting image...');
        console.log('Editor is ready:', {
          isEditable: editor.isEditable,
          isFocused: editor.isFocused,
          isEmpty: editor.isEmpty
        });
        try {
          editor.chain().focus().setImage({ src: imageUrl, alt: file.name }).run();
          console.log('Image inserted successfully');
        } catch (error) {
          console.error('Error inserting image:', error);
        }
      } else {
        console.error('Editor not available or not editable');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image');
    } finally {
      setIsUploadingImage(false);
      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const triggerImageUpload = () => {
    console.log('Image upload button clicked');
    if (fileInputRef.current) {
      console.log('File input found:', !!fileInputRef.current);
      fileInputRef.current.click();
    } else {
      console.error('File input not found');
    }
  };

  // Add global functions for MS Word-like image operations
  useEffect(() => {
    let isResizing = false;
    let isDragging = false;
    let currentImage: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;

    // Resize image by dragging
    (window as any).startResize = (e: MouseEvent, handle: HTMLElement, imageWrapper: HTMLElement) => {
      e.preventDefault();
      isResizing = true;
      currentImage = imageWrapper;
      startX = e.clientX;
      startY = e.clientY;
      const img = imageWrapper.querySelector('img') as HTMLImageElement;
      startWidth = img.offsetWidth;
      startHeight = img.offsetHeight;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing || !currentImage) return;
        
        const img = currentImage.querySelector('img') as HTMLImageElement;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        if (handle.classList.contains('resize-se')) {
          // Southeast resize (both width and height)
          const newWidth = Math.max(50, startWidth + deltaX);
          const newHeight = Math.max(50, startHeight + deltaY);
          img.style.width = newWidth + 'px';
          img.style.height = newHeight + 'px';
        } else if (handle.classList.contains('resize-e')) {
          // East resize (width only)
          const newWidth = Math.max(50, startWidth + deltaX);
          img.style.width = newWidth + 'px';
        } else if (handle.classList.contains('resize-s')) {
          // South resize (height only)
          const newHeight = Math.max(50, startHeight + deltaY);
          img.style.height = newHeight + 'px';
        }
      };

      const handleMouseUp = () => {
        isResizing = false;
        currentImage = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    // Delete image
    (window as any).deleteImage = (imageId: string) => {
      const imageWrapper = document.querySelector(`[data-image-id="${imageId}"]`) as HTMLElement;
      if (imageWrapper) {
        imageWrapper.remove();
      }
    };

    // Show context menu on right-click
    (window as any).showImageContextMenu = (e: MouseEvent, imageId: string) => {
      e.preventDefault();
      
      // Remove existing context menu
      const existingMenu = document.querySelector('.image-context-menu');
      if (existingMenu) {
        existingMenu.remove();
      }

      // Create context menu
      const menu = document.createElement('div');
      menu.className = 'image-context-menu';
      menu.style.cssText = `
        position: fixed;
        background: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        z-index: 1000;
        padding: 8px 0;
        min-width: 150px;
        font-size: 12px;
      `;

      menu.innerHTML = `
        <div style="padding: 8px 16px; cursor: pointer;" onclick="window.deleteImage('${imageId}')">🗑️ Delete</div>
        <div style="padding: 8px 16px; cursor: pointer;" onclick="window.cutImage('${imageId}')">✂️ Cut</div>
        <div style="padding: 8px 16px; cursor: pointer;" onclick="window.copyImage('${imageId}')">📋 Copy</div>
        <hr style="margin: 4px 0; border: none; border-top: 1px solid #eee;">
        <div style="padding: 8px 16px; cursor: pointer;" onclick="window.bringToFront('${imageId}')">⬆️ Bring to Front</div>
        <div style="padding: 8px 16px; cursor: pointer;" onclick="window.sendToBack('${imageId}')">⬇️ Send to Back</div>
        <hr style="margin: 4px 0; border: none; border-top: 1px solid #eee;">
        <div style="padding: 8px 16px; cursor: pointer;" onclick="window.formatImage('${imageId}')">🖼️ Format Picture</div>
      `;

      document.body.appendChild(menu);
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';

      // Close menu when clicking outside
      const closeMenu = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      };

      setTimeout(() => {
        document.addEventListener('click', closeMenu);
      }, 100);
    };

    // Additional functions for context menu
    (window as any).cutImage = (imageId: string) => {
      const imageWrapper = document.querySelector(`[data-image-id="${imageId}"]`) as HTMLElement;
      if (imageWrapper) {
        // Store in clipboard (simplified)
        (window as any).clipboardImage = imageWrapper.outerHTML;
        imageWrapper.remove();
      }
    };

    (window as any).copyImage = (imageId: string) => {
      const imageWrapper = document.querySelector(`[data-image-id="${imageId}"]`) as HTMLElement;
      if (imageWrapper) {
        // Store in clipboard (simplified)
        (window as any).clipboardImage = imageWrapper.outerHTML;
      }
    };

    (window as any).bringToFront = (imageId: string) => {
      const imageWrapper = document.querySelector(`[data-image-id="${imageId}"]`) as HTMLElement;
      if (imageWrapper) {
        imageWrapper.style.zIndex = '1000';
      }
    };

    (window as any).sendToBack = (imageId: string) => {
      const imageWrapper = document.querySelector(`[data-image-id="${imageId}"]`) as HTMLElement;
      if (imageWrapper) {
        imageWrapper.style.zIndex = '-1';
      }
    };

    (window as any).formatImage = (imageId: string) => {
      // Placeholder for image formatting dialog
      alert('Image formatting options would open here');
    };

    // Add event listeners for resize handles
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('resize-handle')) {
        const imageWrapper = target.closest('.word-image-wrapper') as HTMLElement;
        if (imageWrapper) {
          const imageId = imageWrapper.getAttribute('data-image-id');
          if (imageId) {
            (window as any).startResize(e, target, imageWrapper);
          }
        }
      }
    };

    // Add context menu listener
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const imageWrapper = target.closest('.word-image-wrapper');
      if (imageWrapper) {
        const imageId = imageWrapper.getAttribute('data-image-id');
        if (imageId) {
          (window as any).showImageContextMenu(e, imageId);
        }
      }
    };

    // Add event listeners
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  return (
    <div className="flex h-full flex-col relative" data-notes-export-root>
      <Toolbar 
        editor={editor} 
        onInsertPageTag={onInsertPageTag}
        triggerImageUpload={triggerImageUpload}
        isUploadingImage={isUploadingImage}
        editMode={editMode}
        onEditModeChange={setEditMode}
      />
      <div 
        className="flex-1 overflow-auto" 
        data-notes-export-content
        ref={editorRef}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onSelect={(e) => {
          // Handle text selection on mouse up
          const selection = window.getSelection();
          if (selection && selection.toString().trim().length > 3) {
            handleTextSelection();
          }
        }}
      >
        {editMode === 'editor' ? (
          <EditorContent editor={editor} className="h-full pb-32" />
        ) : (
          <div className="h-full pb-32">
            <EditableRichContent
              html={value}
              onChange={onChange}
              placeholder="Double-click any element to edit it..."
            />
          </div>
        )}
      </div>
      
      {/* Grammar correction menu */}
      {showCorrectionMenu && (
        <div
          className="fixed z-50 bg-background border border-border rounded-md shadow-lg p-3 min-w-[250px]"
          style={{
            left: `${correctionMenuPos.x - 125}px`,
            top: `${correctionMenuPos.y}px`,
          }}
        >
          {!correctedText ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGrammarCorrection}
                disabled={isCorrecting}
                className="w-full justify-start gap-2 mb-2"
              >
                <Sparkles className="h-4 w-4" />
                {isCorrecting ? "Correcting..." : "Correct grammar"}
              </Button>
              <div className="text-xs text-muted-foreground px-1">
                Original: "{selectedText}"
              </div>
            </>
          ) : (
            <>
              <div className="text-xs text-muted-foreground px-1 mb-2">
                Original: "{selectedText}"
              </div>
              <div className="text-xs text-foreground px-1 mb-3 p-2 bg-muted rounded">
                Corrected: "{correctedText}"
              </div>
              <div className="flex gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleAcceptCorrection}
                  disabled={correctedText === "No corrections needed" || correctedText === "Correction failed"}
                  className="flex-1 gap-1"
                >
                  <Check className="h-4 w-4" />
                  Accept
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRejectCorrection}
                  className="flex-1 gap-1"
                >
                  <X className="h-4 w-4" />
                  Reject
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      
      {/* Click outside to close menu */}
      {showCorrectionMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowCorrectionMenu(false)}
        />
      )}
      
      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />
    </div>
  );
}
