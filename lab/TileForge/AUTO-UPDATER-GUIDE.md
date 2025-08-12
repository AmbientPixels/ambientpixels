# TileForge Auto-Updater Setup Guide

## 🎯 Overview
TileForge now includes automatic update functionality using `electron-updater`. Users will be notified when updates are available and can install them with one click.

## ✅ What's Already Configured

### Dependencies Installed
- `electron-updater`: ^6.1.7 - Handles update checking and installation
- `electron-log`: ^5.0.1 - Provides logging for update process

### Auto-Updater Features
- **Automatic Check**: Checks for updates 5 seconds after app startup
- **Background Download**: Updates download automatically in background
- **User Notifications**: Dialog boxes inform users of available updates
- **One-Click Install**: Users can restart and install with one button
- **Manual Check**: "Check for Updates" menu option available
- **Development Mode**: Auto-updater disabled during development

### GitHub Release Integration
- Configured to publish to: `github.com/ambientpixels/tileforge`
- Uses GitHub Releases for update distribution
- Supports both x64 and ia32 Windows builds

## 🚀 How to Release Updates

### Step 1: Update Version Number
```bash
# Update version in package.json
"version": "1.0.1"  # Increment version number
```

### Step 2: Build and Publish
```bash
# Install dependencies (if needed)
npm install

# Build and publish to GitHub Releases
npm run build-win-publish
```

### Step 3: Create GitHub Release
1. Go to your GitHub repository
2. Create a new release with the same version number
3. Upload the generated installer files
4. Publish the release

## 📋 Update Process Flow

### For Users
1. **Automatic Check**: App checks for updates on startup
2. **Notification**: Dialog appears if update is available
3. **Background Download**: Update downloads automatically
4. **Install Prompt**: User chooses "Restart Now" or "Later"
5. **Seamless Update**: App restarts and applies update

### For Developers
1. **Code Changes**: Make your improvements to TileForge
2. **Version Bump**: Update version in package.json
3. **Build & Publish**: Run `npm run build-win-publish`
4. **GitHub Release**: Create release on GitHub
5. **Automatic Distribution**: Users get notified automatically

## 🔧 Configuration Details

### Auto-Updater Settings
```javascript
// Checks for updates 5 seconds after app ready
setTimeout(() => {
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}, 5000);
```

### User Experience
- **Update Available**: "A new version is available. It will be downloaded in the background."
- **Update Ready**: "Update downloaded successfully! The application will restart to apply the update."
- **User Choice**: "Restart Now" or "Later" buttons

### Security Features
- Only checks for updates in production (not development)
- Uses secure HTTPS connections to GitHub
- Validates update signatures automatically

## 📝 Build Scripts

### Available Commands
```bash
# Development
npm run electron-dev          # Run in development mode
npm run electron             # Run production build locally

# Building
npm run build-win           # Build without publishing
npm run build-win-publish   # Build and publish to GitHub

# Other platforms
npm run build-mac           # macOS build
npm run build-linux         # Linux build
```

## 🎉 Benefits for Users

### Seamless Updates
- No manual download/install process
- Always running latest version
- Security updates delivered automatically
- New features arrive automatically

### Professional Experience
- Native desktop app feel
- Offline functionality
- System integration
- Familiar Windows installer

## 🔍 Troubleshooting

### Common Issues
1. **Updates not found**: Check GitHub release is published
2. **Download fails**: Verify internet connection
3. **Install fails**: Run as administrator if needed

### Logs Location
- Windows: `%USERPROFILE%\AppData\Roaming\TileForge\logs\`
- Check `main.log` for auto-updater activity

## 🚀 Next Steps

1. **Test the System**: Build a test release to verify auto-updater works
2. **Version 1.0.1**: Plan your first update with new features
3. **User Communication**: Let users know about auto-update capability
4. **Monitor Usage**: Check logs to ensure updates are working smoothly

Your TileForge desktop app now has professional-grade auto-updating capability! 🎯
