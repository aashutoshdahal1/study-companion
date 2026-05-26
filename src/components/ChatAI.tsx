import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Send, Bot, User, Settings, X, Minimize2, Maximize2 } from "lucide-react";
import { markdownToHtml } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  chatbotType?: 'groq' | 'deepai';
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
  const [isMinimized, setIsMinimized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedChatbot, setSelectedChatbot] = useState<'groq' | 'deepai'>('groq');

  // Groq state
  const [groqApiKey, setGroqApiKey] = useState("");
  const [groqModel, setGroqModel] = useState("llama-3.3-70b-versatile");

  // DeepAI state
  const [deepaiModel, setDeepaiModel] = useState('standard');
  const [deepaiProxyStatus, setDeepaiProxyStatus] = useState<'online' | 'offline' | 'checking'>('checking');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load saved settings
  useEffect(() => {
    const key = localStorage.getItem('groq-api-key');
    if (key) setGroqApiKey(key);
    const model = localStorage.getItem('groq-model');
    if (model) setGroqModel(model);
    const chatbot = localStorage.getItem('selected-chatbot') as 'groq' | 'deepai' | null;
    if (chatbot) setSelectedChatbot(chatbot);
  }, []);

  // Persist settings
  useEffect(() => {
    if (groqApiKey) localStorage.setItem('groq-api-key', groqApiKey);
    else localStorage.removeItem('groq-api-key');
  }, [groqApiKey]);

  useEffect(() => {
    localStorage.setItem('groq-model', groqModel);
  }, [groqModel]);

  useEffect(() => {
    localStorage.setItem('selected-chatbot', selectedChatbot);
  }, [selectedChatbot]);

  // Check DeepAI proxy status
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch('/proxy/deepai-ping');
        setDeepaiProxyStatus(r.ok ? 'online' : 'offline');
      } catch {
        setDeepaiProxyStatus('offline');
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, [isVisible]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    if (selectedChatbot === 'groq' && !groqApiKey) {
      setShowSettings(true);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '⚙️ Please add your **Groq API key** in Settings. Get a free key at **console.groq.com**.',
        timestamp: Date.now(),
        chatbotType: 'groq',
      }]);
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      chatbotType: selectedChatbot,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      if (selectedChatbot === 'groq') {
        await handleGroqMessage(userMessage);
      } else {
        await handleDeepaiMessage(userMessage);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const isAuth = msg.includes('401') || msg.includes('invalid_api_key') || msg.includes('403');
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: isAuth
          ? '🔑 Invalid Groq API key. Open Settings and paste a valid key from console.groq.com.'
          : `❌ Error: ${msg}`,
        timestamp: Date.now(),
        chatbotType: selectedChatbot,
      }]);
      if (isAuth) setShowSettings(true);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleGroqMessage = async (userMessage: ChatMessage) => {
    const chatHistory = messages.concat(userMessage).map(m => ({
      role: m.role,
      content: m.content,
    }));

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: groqModel,
        messages: chatHistory,
        stream: true,
      }),
      signal: abortControllerRef.current?.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 200) || response.statusText}`);
    }

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      chatbotType: 'groq',
    };
    setMessages(prev => [...prev, assistantMessage]);

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answerText = '';

    const processLine = (line: string) => {
      if (!line.startsWith('data: ')) return;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') return;
      try {
        const evt = JSON.parse(raw);
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) {
          answerText += delta;
          assistantMessage.content = answerText;
          setMessages(prev => prev.map(m =>
            m.id === assistantMessage.id ? { ...assistantMessage } : m
          ));
        }
      } catch { /* ignore parse errors */ }
    };

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) processLine(buffer.trim());
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
      }
    }
  };

  const handleDeepaiMessage = async (userMessage: ChatMessage) => {
    const chatHistory = messages.concat(userMessage).map(m => ({
      role: m.role,
      content: m.content,
    }));

    const params = new URLSearchParams({
      chat_style: 'chat',
      model: deepaiModel,
      session_uuid: crypto.randomUUID(),
      sensitivity_request_id: crypto.randomUUID(),
      hacker_is_stinky: 'very_stinky',
      chatHistory: JSON.stringify(chatHistory),
      enabled_tools: JSON.stringify(['image_generator', 'image_editor']),
    });

    const response = await fetch('/proxy/deepai-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: abortControllerRef.current?.signal,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      chatbotType: 'deepai',
    };
    setMessages(prev => [...prev, assistantMessage]);

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        assistantMessage.content = fullText;
        setMessages(prev => prev.map(m =>
          m.id === assistantMessage.id ? { ...assistantMessage } : m
        ));
      }
    }
  };

  const handleStopGeneration = () => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  };

  const statusDot = (status: 'online' | 'offline' | 'checking') =>
    status === 'online' ? 'bg-green-500' : status === 'offline' ? 'bg-red-500' : 'bg-yellow-500';

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
            {selectedChatbot === 'groq' ? 'Groq AI' : 'DeepAI'}
          </span>
          {selectedChatbot === 'groq' ? (
            <div className={`w-2 h-2 rounded-full ${groqApiKey ? 'bg-green-500' : 'bg-red-500'}`} />
          ) : (
            <div className={`w-2 h-2 rounded-full ${statusDot(deepaiProxyStatus)}`} />
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsMinimized(!isMinimized)}>
            {isMinimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowSettings(!showSettings)}>
            <Settings className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggle}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="p-3 border-b border-border bg-muted/50 max-h-64 overflow-y-auto">
          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-medium mb-2">Select Chatbot</label>
              <div className="flex gap-2">
                <Button
                  variant={selectedChatbot === 'groq' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedChatbot('groq')}
                  className="flex-1 text-xs"
                >
                  Groq AI
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

            {selectedChatbot === 'groq' && (
              <div className="space-y-2 border-t pt-2">
                <div className="font-medium">Groq Configuration</div>
                <div>
                  <label className="block font-medium mb-1">API Key</label>
                  <input
                    type="password"
                    value={groqApiKey}
                    onChange={(e) => setGroqApiKey(e.target.value)}
                    placeholder="gsk_..."
                    className="w-full px-2 py-1 bg-background border border-border rounded text-xs"
                  />
                  <p className="text-muted-foreground mt-0.5">Free key at console.groq.com</p>
                </div>
                <div>
                  <label className="block font-medium mb-1">Model</label>
                  <select
                    value={groqModel}
                    onChange={(e) => setGroqModel(e.target.value)}
                    className="w-full px-2 py-1 bg-background border border-border rounded text-xs"
                  >
                    <option value="llama-3.3-70b-versatile">Llama 3.3 70B</option>
                    <option value="llama-3.1-8b-instant">Llama 3.1 8B (fast)</option>
                    <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                    <option value="gemma2-9b-it">Gemma 2 9B</option>
                  </select>
                </div>
              </div>
            )}

            {selectedChatbot === 'deepai' && (
              <div className="space-y-2 border-t pt-2">
                <div className="font-medium">DeepAI Configuration</div>
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
                <div className={`text-xs ${deepaiProxyStatus === 'online' ? 'text-green-600' : 'text-red-500'}`}>
                  Proxy: {deepaiProxyStatus} {deepaiProxyStatus === 'offline' && '— run node server.js'}
                </div>
              </div>
            )}

            <Button variant="outline" size="sm" onClick={() => setMessages([])} className="w-full text-xs">
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
                <p>Start a conversation with {selectedChatbot === 'groq' ? 'Groq AI' : 'DeepAI'}</p>
                {selectedChatbot === 'groq' && !groqApiKey && (
                  <p className="text-xs mt-2 text-red-500">Add your Groq API key in Settings</p>
                )}
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {message.role === 'assistant' && (
                    <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="h-3 w-3" />
                    </div>
                  )}
                  <div className={`max-w-[80%] ${message.role === 'user' ? 'order-first' : ''}`}>
                    <div className={`rounded-lg p-2 text-sm ${message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                      <div
                        className="chat-md"
                        dangerouslySetInnerHTML={{ __html: markdownToHtml(message.content) }}
                      />
                    </div>
                    {message.role === 'assistant' && message.content && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onInsertToNotes?.(message.content)}
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
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isLoading || (selectedChatbot === 'groq' && !groqApiKey)}
              />
              {isLoading ? (
                <Button variant="outline" size="icon" onClick={handleStopGeneration} className="shrink-0">
                  <X className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleSendMessage}
                  disabled={!input.trim() || (selectedChatbot === 'groq' && !groqApiKey)}
                  size="icon"
                  className="shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            {selectedChatbot === 'groq' && !groqApiKey && (
              <p className="text-xs text-red-500 mt-1">Add your Groq API key in Settings (free at console.groq.com)</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
