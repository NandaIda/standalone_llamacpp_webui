# Building the Android App

This guide explains how to build the llama.cpp WebUI as an Android application using Capacitor.

## Overview

The WebUI has been configured to run as a native Android app. The app packages the web interface and allows you to connect to external APIs (like DeepInfra or your own OpenAI-compatible API) without needing a local llama.cpp server.

## Prerequisites

### Required Software

1. **Node.js & npm** (already installed if you can run the webui)
2. **Android Studio** - Download from [https://developer.android.com/studio](https://developer.android.com/studio)
3. **Java Development Kit (JDK)** - Usually bundled with Android Studio
   - Alternatively install JDK 17 or higher separately

### Android Studio Setup

After installing Android Studio:

1. Open Android Studio
2. Go to **Tools → SDK Manager**
3. In **SDK Platforms** tab:
   - Install **Android 13.0 (Tiramisu)** or higher
   - Note the **Android SDK Location** path
4. In **SDK Tools** tab, ensure these are installed:
   - Android SDK Build-Tools
   - Android SDK Platform-Tools
   - Android Emulator (if you want to test without a physical device)
   - Google Play Services (optional)
5. Set up environment variables (add to `~/.bashrc` or `~/.zshrc`):
   ```bash
   export ANDROID_HOME=$HOME/Android/Sdk  # or your SDK path
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   export PATH=$PATH:$ANDROID_HOME/tools
   ```
6. Reload your shell: `source ~/.bashrc` (or `source ~/.zshrc`)

## Building the Android App

### Method 1: Using npm Scripts (Recommended)

```bash
# Build and sync all changes to Android project
npm run cap:sync

# Open the project in Android Studio
npm run cap:open

# Or do both: build, sync, and run on connected device
npm run cap:run
```

### Method 2: Manual Steps

```bash
# 1. Build the web assets
npm run build:mobile

# 2. Sync to Android project
npx cap sync android

# 3. Open in Android Studio
npx cap open android
```

## Building the APK/AAB

Once the project opens in Android Studio:

### Debug APK (for testing)

1. In Android Studio, select **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. Wait for the build to complete
3. Click **locate** in the notification to find the APK
4. APK location: `android/app/build/outputs/apk/debug/app-debug.apk`
5. Install on your device:
   ```bash
   adb install android/app/build/outputs/apk/debug/app-debug.apk
   ```

### Release APK (for distribution)

1. **Create a Keystore** (first time only):
   ```bash
   keytool -genkey -v -keystore my-release-key.keystore -alias my-key-alias \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
   - Save this keystore file securely!
   - Remember the passwords

2. **Configure Signing**:
   - In Android Studio: **Build → Generate Signed Bundle/APK**
   - Choose **APK**
   - Select your keystore and enter passwords
   - Select **release** build variant
   - Click **Finish**

3. **Find the Release APK**:
   - Location: `android/app/build/outputs/apk/release/app-release.apk`

## Running on Device/Emulator

### Physical Device

1. Enable **Developer Options** on your Android device:
   - Go to **Settings → About Phone**
   - Tap **Build Number** 7 times
2. Enable **USB Debugging** in **Developer Options**
3. Connect device via USB
4. Run: `npm run cap:run` or use Android Studio's **Run** button

### Emulator

1. In Android Studio: **Tools → Device Manager**
2. Create a new virtual device if needed
3. Start the emulator
4. Run: `npm run cap:run` or use Android Studio's **Run** button

## Configuring the App

### Setting Your API Endpoint

After installing the app on your device:

1. Open the app
2. Tap the **Settings** icon (⚙️)
3. Configure:
   - **API Base URL**: Your API endpoint (e.g., `https://api.deepinfra.com/v1/openai`)
   - **API Key**: Your API authentication key
   - **Model**: Select or enter your model name

### DeepInfra Example

For DeepInfra:
- **API Base URL**: `https://api.deepinfra.com/v1/openai`
- **API Key**: Get from [https://deepinfra.com/dash/api_keys](https://deepinfra.com/dash/api_keys)
- **Model**: e.g., `meta-llama/Meta-Llama-3.1-70B-Instruct`

### Your Own API

If using your own OpenAI-compatible API:
- **API Base URL**: `https://your-domain.com/v1` (without `/chat/completions`)
- **API Key**: Your authentication token
- **Model**: Your model identifier

## Project Structure

```
webui/
├── android/                  # Generated Android project
│   ├── app/
│   │   ├── src/
│   │   └── build.gradle
│   └── build.gradle
├── capacitor.config.ts       # Capacitor configuration
├── package.json              # Added Capacitor scripts
└── ANDROID_BUILD.md          # This file
```

## Useful Commands

```bash
# Rebuild and sync after making changes
npm run cap:sync

# Open Android Studio
npm run cap:open

# Build, sync, and run on device
npm run cap:run

# Check connected devices
adb devices

# View Android logs
adb logcat

# Clean build
cd android && ./gradlew clean && cd ..
```

## Troubleshooting

### Build Errors

**Error: ANDROID_HOME not set**
- Solution: Set the `ANDROID_HOME` environment variable (see setup above)

**Error: SDK location not found**
- Solution: Create `android/local.properties`:
  ```properties
  sdk.dir=/path/to/your/Android/Sdk
  ```

**Gradle sync failed**
- Solution: In Android Studio, click **File → Invalidate Caches → Invalidate and Restart**

### Runtime Issues

**App shows blank screen**
- Check if index.html exists in `../public/`
- Run: `npm run build:mobile` to rebuild

**API calls failing**
- Verify your API URL and key in settings
- Check network permissions in Android manifest
- Use Android Studio's Logcat to see errors

**CORS errors**
- Some APIs may have CORS restrictions
- This shouldn't affect native apps, but verify API allows mobile clients

### Updating the App

When you make changes to the webui:

```bash
# 1. Rebuild the web assets
npm run build:mobile

# 2. Sync to Android
npx cap sync android

# 3. Rebuild in Android Studio or run
npm run cap:run
```

## Advanced Configuration

### Change App Name/Icon

1. **App Name**: Edit `capacitor.config.ts`:
   ```typescript
   appName: 'Your App Name'
   ```

2. **App Icon**:
   - Replace `android/app/src/main/res/mipmap-*/ic_launcher.png`
   - Use Android Studio's **Image Asset** tool (right-click `res` → New → Image Asset)

3. **Package ID**: Edit `capacitor.config.ts`:
   ```typescript
   appId: 'com.yourdomain.yourapp'
   ```
   Then rebuild: `npx cap sync android`

### Enable Live Reload (Development)

Edit `capacitor.config.ts`:

```typescript
server: {
  url: 'http://192.168.1.100:5173',  // Your dev machine IP
  cleartext: true
}
```

Then:
1. Run `npm run dev` on your dev machine
2. Rebuild the app
3. App will connect to your dev server for live updates

### Adding Plugins

Capacitor has many plugins for native features:

```bash
# Example: Add camera support
npm install @capacitor/camera
npx cap sync android
```

See available plugins: [https://capacitorjs.com/docs/plugins](https://capacitorjs.com/docs/plugins)

## Resources

- **Capacitor Docs**: [https://capacitorjs.com/docs](https://capacitorjs.com/docs)
- **Android Developers**: [https://developer.android.com](https://developer.android.com)
- **DeepInfra API**: [https://deepinfra.com/docs](https://deepinfra.com/docs)

## Notes

- The app runs entirely client-side - no server required
- All data is stored locally using IndexedDB
- The app requires internet connection to access your API
- API keys are stored in browser localStorage (encrypted by Android)
- Consider adding authentication/encryption for sensitive data

---

**Need help?** Check the main WebUI repository or Capacitor documentation for additional support.
