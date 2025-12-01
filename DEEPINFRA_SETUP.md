# DeepInfra Setup Guide

This WebUI has been configured to work with DeepInfra's API. Follow these steps to get started.

## Configuration

The following settings have been pre-configured:

- **API Base URL**: `https://api.deepinfra.com`
- **Model Selector**: Enabled by default
- **Dev Server Port**: 8000

## Setup Steps

### 1. Get Your DeepInfra API Key

1. Go to [DeepInfra](https://deepinfra.com/)
2. Sign up or log in to your account
3. Navigate to your API settings
4. Copy your API key

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Development Server

```bash
npm run dev
```

The server will start at `http://localhost:8000`

### 4. Configure the WebUI

1. Open `http://localhost:8000` in your browser
2. Click on the Settings icon (gear icon)
3. In the settings panel:
   - **API Key**: Paste your DeepInfra API key
   - **API Base URL**: Should already be set to `https://api.deepinfra.com/v1/openai` or `http://100.100.106.32:11434/v1`
   - **Model Selector**: Should already be enabled

### 5. Select Your Model

1. In the chat input area, you should see a model selector dropdown
2. The WebUI will fetch available models from DeepInfra
3. Select `mistralai/Mistral-Small-3.2-24B-Instruct-2506` or any other model you prefer

## Switching Between DeepInfra and Local llama.cpp

You can easily switch between DeepInfra and a local llama.cpp server:

### For DeepInfra:
- **API Base URL**: `https://api.deepinfra.com/v1/openai`
- **API Key**: Your DeepInfra API key
- **Model Selector**: Enabled

### For Local llama.cpp:
- **API Base URL**: `.` (or leave empty) or `http://100.100.106.32:11434/v1`
- **API Key**: Empty (unless your local server uses authentication)
- **Model Selector**: Optional

## Troubleshooting

### Models not loading
- Verify your API key is correct
- Check that the API Base URL is set to `https://api.deepinfra.com/v1/openai` or `http://100.100.106.32:11434/v1`
- Check browser console for error messages

### CORS errors
- This shouldn't happen with DeepInfra, but if it does, you may need to use a proxy

### Connection errors
- Ensure you have internet connectivity
- Verify the API Base URL is correct
- Check if DeepInfra service is operational

## Notes

- The WebUI is fully compatible with OpenAI-style APIs
- You can use any provider that supports the OpenAI chat completion format
- Settings are persisted in browser localStorage
- When using external APIs, all file types (images, audio, PDF, text) are allowed - the API will validate whether the selected model supports them
- Reasoning/thinking content in `<think>` tags is automatically extracted and displayed in a collapsible section
