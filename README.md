# Standalone llama.cpp WebUI

Modified from llama.cpp

All credit goes to the llama.cpp team and contributors.

## Purpose

This is a standalone web interface designed to work with OpenAI-compatible APIs. It can be used with llama-server and other providers that support the OpenAI API format.

## Features

- OpenAI API compatibility
- Works with llama-server
- Supports multiple LLM providers
- Conversation management and branching
- File attachments (images, PDFs, audio, text)
- Available as Android APK

## Screenshots

![Web View](Screenshot/Screenshot_2025-12-02_13-51-13.png)
*Web View and read pdf as images*

![Web View2](Screenshot/Screenshot_2025-12-02_13-52-34.png)
*Web View and read pdf as images - response*

![Mobile View](Screenshot/Screenshot_20251202_135513.jpg)
*Mobile interface view*

![Image Generation](Screenshot/Screenshot_20251202_135501.jpg)
*AI image generation feature*

![Chat Interface](Screenshot/Screenshot_2025-12-02_13-48-54.png)
*Compitable with AI chatbots in Firefox*

## Platform Support

Available for web browsers and as an Android application (APK).

## Getting Started

### Web Version

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

### Android Version

See [ANDROID_BUILD.md](ANDROID_BUILD.md) for detailed instructions on building the Android APK.

Quick commands:
```bash
npm run cap:sync    # Build and sync to Android
npm run cap:open    # Open in Android Studio
npm run cap:run     # Build, sync, and run on device
```

## Configuration

Configure your API endpoint in the app settings:
- API Base URL: Your OpenAI-compatible endpoint
- API Key: Your authentication key
- Model: Your model identifier

## Credits

This project is based on and modified from llama.cpp. All credit goes to the original llama.cpp team and contributors.

## License

This project follows the same license as llama.cpp.
