# Chat AI Integration

This document explains how to set up and use the Chat AI functionality in StudySync.

## Overview

The Chat AI feature integrates multiple AI chat assistants directly into your note-taking workflow. You can:
- Chat with Z.ai GLM or DeepAI assistants about your study materials
- Insert AI responses directly into your notes
- Use the AI to help explain concepts, summarize content, or answer questions
- Switch between different chatbots based on your needs

## Setup Instructions

### 1. Install Dependencies

First, install the required Express dependency:

```bash
npm install
```

### 2. Start the Proxy Servers

The Chat AI requires proxy servers to communicate with the AI APIs. You can run one or both depending on which chatbots you want to use:

**For Z.ai GLM:**
```bash
npm run server
```

**For DeepAI:**
```bash
npm run deepai-server
```

You should see output like:
```
✓ Proxy running at http://localhost:8788/  (Z.ai)
✓ DeepAI Proxy running → http://localhost:8787/  (DeepAI)
```

### 3. Start the Development Server

In a separate terminal, start the main application:

```bash
npm run dev
```

### 4. Configure the Chat AI

1. Open the StudySync application in your browser
2. Click the AI bot button in the bottom-right corner to open the chat
3. Click the settings icon (⚙️) in the chat header
4. **Select your preferred chatbot:**
   - **Z.ai GLM**: Enter your Z.ai Bearer token in the "Token" field
   - **DeepAI**: No token required, just ensure the DeepAI server is running
5. Configure other settings as needed:
   - **Z.ai**: Model selection (GLM-5-Turbo, GLM-5, GLM-5.1), proxy port (8788), show/hide thinking
   - **DeepAI**: Model selection (Standard, Creative, Balanced, Precise), proxy port (8787), enabled tools

## Usage

### Starting a Chat

1. Click the AI bot button (🤖) in the bottom-right corner
2. Type your message in the input field
3. Press Enter or click the Send button

### Adding AI Responses to Notes

When the AI responds, you'll see an "Add to Notes" button below each AI response. Click it to insert the response into your current notes with special formatting.

### Features

- **Streaming Responses**: See AI responses as they're being generated
- **Thinking Process**: View the AI's reasoning if enabled
- **Markdown Support**: The AI responses support basic markdown formatting
- **Proxy Status Indicator**: Green dot when proxy is online, red when offline
- **Minimize/Maximize**: Collapse the chat window when not needed
- **Clear Chat**: Reset the conversation history

## Troubleshooting

### Proxy Connection Issues

If you see a red dot in the chat header:
1. Ensure the proxy server is running (`npm run server`)
2. Check that the port number matches (default: 8787)
3. Verify no firewall is blocking the connection

### Authentication Issues

If you get authentication errors:
1. Verify your Bearer token is correct
2. Check that the token hasn't expired
3. Ensure you have the necessary permissions

### No Response from AI

If the AI doesn't respond:
1. Check the proxy status indicator
2. Verify your token and cookie settings
3. Check the browser console for error messages

## Architecture

The Chat AI integration consists of:

1. **ChatAI Component** (`src/components/ChatAI.tsx`): React component for the chat interface
2. **Proxy Server** (`server.js`): Express server that proxies requests to Z.ai API
3. **Integration**: The chat is integrated into the main application (`src/pages/Index.tsx`)

## Security Notes

- Your Bearer token is stored in localStorage and persisted between sessions
- The proxy server only runs on localhost by default
- All API requests are proxied through your local server

## API Details

The proxy server forwards requests to:
- Target: `https://chat.z.ai/api/v2/chat/completions`
- Method: POST with streaming support
- Authentication: Bearer token + optional cookie

For more details about the Z.ai API, refer to their official documentation.
