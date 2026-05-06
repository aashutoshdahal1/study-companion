import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Send, Bot, User, Settings, X, Minimize2, Maximize2 } from "lucide-react";

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  timestamp: number;
  chatbotType?: 'zai' | 'deepai';
}

interface ChatAIProps {
  isVisible: boolean;
  onToggle: () => void;
  onInsertToNotes?: (content: string) => void;
}

export function ChatAI({ isVisible, onToggle, onInsertToNotes }: ChatAIProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [token, setToken] = useState("");
  const [cookie, setCookie] = useState("");
  const [model, setModel] = useState("GLM-5-Turbo");
  const [proxyPort, setProxyPort] = useState("8788");
  const [showThinking, setShowThinking] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [proxyStatus, setProxyStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [selectedChatbot, setSelectedChatbot] = useState<'zai' | 'deepai'>('zai');
  const [deepaiModel, setDeepaiModel] = useState('standard');
  const [deepaiTools, setDeepaiTools] = useState(['image_generator', 'image_editor']);
  const [deepaiProxyPort, setDeepaiProxyPort] = useState("8789");
  const [deepaiProxyStatus, setDeepaiProxyStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load saved tokens from localStorage
  useEffect(() => {
    const savedZaiToken = localStorage.getItem('zai-glm-bearer-token');
    if (savedZaiToken) {
      setToken(savedZaiToken);
    }
    const savedDeepaiToken = localStorage.getItem('deepai-token');
    if (savedDeepaiToken) {
      // DeepAI uses different token storage
    }
  }, []);

  // Check proxy status for Z.ai
  useEffect(() => {
    const checkProxy = async () => {
      try {
        const response = await fetch(`http://localhost:${proxyPort}/ping`, { 
          method: 'GET',
          signal: AbortSignal.timeout(1500)
        });
        if (response.ok) {
          setProxyStatus('online');
        } else {
          setProxyStatus('offline');
        }
      } catch {
        setProxyStatus('offline');
      }
    };

    checkProxy();
    const interval = setInterval(checkProxy, 5000);
    return () => clearInterval(interval);
  }, [proxyPort]);

  // Check proxy status for DeepAI
  useEffect(() => {
    const checkDeepaiProxy = async () => {
      try {
        const response = await fetch(`http://localhost:${deepaiProxyPort}/ping`, { 
          method: 'GET',
          signal: AbortSignal.timeout(1500)
        });
        if (response.ok) {
          setDeepaiProxyStatus('online');
        } else {
          setDeepaiProxyStatus('offline');
        }
      } catch {
        setDeepaiProxyStatus('offline');
      }
    };

    checkDeepaiProxy();
    const interval = setInterval(checkDeepaiProxy, 5000);
    return () => clearInterval(interval);
  }, [deepaiProxyPort]);

  // Save token to localStorage
  useEffect(() => {
    if (token) {
      localStorage.setItem('zai-glm-bearer-token', token);
    } else {
      localStorage.removeItem('zai-glm-bearer-token');
    }
  }, [token]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      chatbotType: selectedChatbot
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      if (selectedChatbot === 'zai') {
        await handleZaiMessage(userMessage);
      } else if (selectedChatbot === 'deepai') {
        await handleDeepaiMessage(userMessage);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Request was aborted');
      } else {
        console.error('Chat error:', error);
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: Date.now(),
          chatbotType: selectedChatbot
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleZaiMessage = async (userMessage: ChatMessage) => {
    if (!token) {
      throw new Error('Z.ai token is required');
    }

    const chatHistory = messages.concat(userMessage).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const payload = {
      stream: true,
      model: model,
      messages: chatHistory,
      chat_id: crypto.randomUUID(),
      current_user_message_id: crypto.randomUUID(),
      current_user_message_parent_id: null,
      extra: {},
      params: {},
      features: {
        image_generation: false,
        web_search: false,
        auto_web_search: false,
        preview_mode: true,
        flags: []
      },
      background_tasks: { title_generation: false, tags_generation: false },
      variables: {}
    };

    const timestamp = Date.now();
    const url = `http://localhost:${proxyPort}?timestamp=${timestamp}&requestId=${userMessage.id}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': token,
        'X-Cookie': cookie,
      },
      body: JSON.stringify(payload),
      signal: abortControllerRef.current?.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let thinkingText = '';
    let answerText = '';

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      thinking: '',
      timestamp: Date.now(),
      chatbotType: 'zai'
    };

    setMessages(prev => [...prev, assistantMessage]);

    const processLine = (line: string) => {
      if (!line.startsWith('data: ')) return;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') return;
      
      try {
        const evt = JSON.parse(raw);
        const d = evt.data;
        if (!d) return;
        
        const chunk = d.delta_content || d.edit_content;
        if (!chunk) return;
        
        if (d.phase === 'thinking') {
          thinkingText += chunk;
          assistantMessage.thinking = thinkingText;
        } else if (d.phase === 'answer' || d.phase === 'other') {
          answerText += chunk;
          assistantMessage.content = answerText;
        }
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessage.id ? assistantMessage : msg
        ));
      } catch (e) {
        console.warn('JSON parse fail:', raw);
      }
    };

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) processLine(buffer.trim());
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      }
    }
  };

  const handleDeepaiMessage = async (userMessage: ChatMessage) => {
    const chatHistory = messages.concat(userMessage).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const params = new URLSearchParams({
      chat_style: 'chat',
      model: deepaiModel,
      session_uuid: crypto.randomUUID(),
      sensitivity_request_id: crypto.randomUUID(),
      hacker_is_stinky: 'very_stinky',
      chatHistory: JSON.stringify(chatHistory),
      enabled_tools: JSON.stringify(deepaiTools),
    });

    const response = await fetch(`http://localhost:${deepaiProxyPort}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: abortControllerRef.current?.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      chatbotType: 'deepai'
    };

    setMessages(prev => [...prev, assistantMessage]);

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      assistantMessage.content = fullText;
      
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessage.id ? assistantMessage : msg
      ));
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  const handleInsertToNotes = (content: string) => {
    if (onInsertToNotes) {
      onInsertToNotes(content);
    }
  };

  const renderMarkdown = (text: string) => {
    // Simple markdown rendering for basic formatting
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-sm">$1</code>')
      .replace(/\n/g, '<br />');
  };

  if (!isVisible) {
    return (
      <Button
        onClick={onToggle}
        className="fixed bottom-4 right-4 z-50 rounded-full w-12 h-12 shadow-lg"
        size="icon"
      >
        <Bot className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 h-[600px] bg-background border border-border rounded-lg shadow-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4" />
          <span className="font-medium text-sm">
            {selectedChatbot === 'zai' ? 'Z.ai GLM' : 'DeepAI'}
          </span>
          <div className={`w-2 h-2 rounded-full ${
            selectedChatbot === 'zai' ? 
              (proxyStatus === 'online' ? 'bg-green-500' : proxyStatus === 'offline' ? 'bg-red-500' : 'bg-yellow-500') :
              (deepaiProxyStatus === 'online' ? 'bg-green-500' : deepaiProxyStatus === 'offline' ? 'bg-red-500' : 'bg-yellow-500')
          }`} />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsMinimized(!isMinimized)}
          >
            {isMinimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onToggle}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="p-3 border-b border-border bg-muted/50 max-h-64 overflow-y-auto">
          <div className="space-y-3 text-xs">
            {/* Chatbot Selection */}
            <div>
              <label className="block font-medium mb-2">Select Chatbot</label>
              <div className="flex gap-2">
                <Button
                  variant={selectedChatbot === 'zai' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedChatbot('zai')}
                  className="flex-1 text-xs"
                >
                  Z.ai GLM
                </Button>
                <Button
                  variant={selectedChatbot === 'deepai' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedChatbot('deepai')}
                  className="flex-1 text-xs"
                >
                  DeepAI
                </Button>
              </div>
            </div>

            {/* Z.ai Configuration */}
            {selectedChatbot === 'zai' && (
              <div className="space-y-2 border-t pt-2">
                <div className="font-medium text-xs">Z.ai Configuration</div>
                <div>
                  <label className="block font-medium mb-1">Bearer Token</label>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Z.ai Bearer token..."
                    className="w-full px-2 py-1 bg-background border border-border rounded text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Cookie (optional)</label>
                  <input
                    type="text"
                    value={cookie}
                    onChange={(e) => setCookie(e.target.value)}
                    placeholder="Cookie string..."
                    className="w-full px-2 py-1 bg-background border border-border rounded text-xs"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block font-medium mb-1">Model</label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full px-2 py-1 bg-background border border-border rounded text-xs"
                    >
                      <option value="GLM-5-Turbo">GLM-5-Turbo</option>
                      <option value="GLM-5">GLM-5</option>
                      <option value="GLM-5.1">GLM-5.1</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block font-medium mb-1">Proxy Port</label>
                    <input
                      type="text"
                      value={proxyPort}
                      onChange={(e) => setProxyPort(e.target.value)}
                      className="w-full px-2 py-1 bg-background border border-border rounded text-xs"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="showThinking"
                    checked={showThinking}
                    onChange={(e) => setShowThinking(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="showThinking" className="text-xs">Show thinking</label>
                </div>
              </div>
            )}

            {/* DeepAI Configuration */}
            {selectedChatbot === 'deepai' && (
              <div className="space-y-2 border-t pt-2">
                <div className="font-medium text-xs">DeepAI Configuration</div>
                <div>
                  <label className="block font-medium mb-1">Model</label>
                  <select
                    value={deepaiModel}
                    onChange={(e) => setDeepaiModel(e.target.value)}
                    className="w-full px-2 py-1 bg-background border border-border rounded text-xs"
                  >
                    <option value="standard">Standard</option>
                    <option value="creative">Creative</option>
                    <option value="balanced">Balanced</option>
                    <option value="precise">Precise</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Proxy Port</label>
                  <input
                    type="text"
                    value={deepaiProxyPort}
                    onChange={(e) => setDeepaiProxyPort(e.target.value)}
                    className="w-full px-2 py-1 bg-background border border-border rounded text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Enabled Tools</label>
                  <div className="space-y-1">
                    {['image_generator', 'image_editor'].map((tool) => (
                      <div key={tool} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={tool}
                          checked={deepaiTools.includes(tool)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDeepaiTools([...deepaiTools, tool]);
                            } else {
                              setDeepaiTools(deepaiTools.filter(t => t !== tool));
                            }
                          }}
                          className="rounded"
                        />
                        <label htmlFor={tool} className="text-xs capitalize">
                          {tool.replace('_', ' ')}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleClearChat}
              className="w-full text-xs"
            >
              Clear Chat
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      {!isMinimized && (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">
                <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Start a conversation with {selectedChatbot === 'zai' ? 'Z.ai GLM' : 'DeepAI'}</p>
                {selectedChatbot === 'zai' && !token && (
                  <p className="text-xs mt-2 text-red-500">Please set your Z.ai Bearer token in settings</p>
                )}
                {selectedChatbot === 'deepai' && deepaiProxyStatus === 'offline' && (
                  <p className="text-xs mt-2 text-red-500">DeepAI proxy is offline. Start the DeepAI server.</p>
                )}
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'assistant' && (
                    <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="h-3 w-3" />
                    </div>
                  )}
                  <div className={`max-w-[80%] ${message.role === 'user' ? 'order-first' : ''}`}>
                    <div
                      className={`rounded-lg p-2 text-sm ${
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      {message.thinking && showThinking && (
                        <div className="mb-2 p-2 bg-background/50 rounded text-xs italic border-l-2 border-primary">
                          <div className="font-medium mb-1">Thinking:</div>
                          <div className="whitespace-pre-wrap">{message.thinking}</div>
                        </div>
                      )}
                      <div
                        className="whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                      />
                    </div>
                    {message.role === 'assistant' && message.content && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleInsertToNotes(message.content)}
                        className="mt-1 text-xs h-6 px-2"
                      >
                        Add to Notes
                      </Button>
                    )}
                  </div>
                  {message.role === 'user' && (
                    <div className="w-6 h-6 rounded bg-primary flex items-center justify-center flex-shrink-0">
                      <User className="h-3 w-3 text-primary-foreground" />
                    </div>
                  )}
                </div>
              ))
            )}
            {isLoading && (
              <div className="flex gap-2 justify-start">
                <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
                  <Bot className="h-3 w-3" />
                </div>
                <div className="bg-muted rounded-lg p-2 text-sm">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-border">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isLoading || (selectedChatbot === 'zai' && !token) || (selectedChatbot === 'deepai' && deepaiProxyStatus === 'offline')}
              />
              {isLoading ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleStopGeneration}
                  className="shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleSendMessage}
                  disabled={!input.trim() || (selectedChatbot === 'zai' && !token) || (selectedChatbot === 'deepai' && deepaiProxyStatus === 'offline')}
                  size="icon"
                  className="shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            {selectedChatbot === 'zai' && !token && (
              <p className="text-xs text-red-500 mt-1">Please configure your Z.ai Bearer token in settings</p>
            )}
            {selectedChatbot === 'deepai' && deepaiProxyStatus === 'offline' && (
              <p className="text-xs text-red-500 mt-1">DeepAI proxy is offline. Start the DeepAI server.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
