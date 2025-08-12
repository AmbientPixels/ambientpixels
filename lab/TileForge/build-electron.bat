@echo off
echo ========================================
echo  TileForge Electron Build Script
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo ✓ Node.js detected
echo.

REM Check if npm is available
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm is not available
    pause
    exit /b 1
)

echo ✓ npm detected
echo.

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
    echo ✓ Dependencies installed
    echo.
) else (
    echo ✓ Dependencies already installed
    echo.
)

REM Create electron directory if it doesn't exist
if not exist "electron" (
    mkdir electron
    echo ✓ Created electron directory
)

REM Create assets directory if it doesn't exist
if not exist "electron\assets" (
    mkdir electron\assets
    echo ✓ Created electron\assets directory
)

echo Building TileForge for Windows...
echo This may take a few minutes...
echo.

REM Build the application
npm run build-win
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Build failed!
    echo Check the error messages above for details.
    pause
    exit /b 1
)

echo.
echo ========================================
echo  BUILD SUCCESSFUL! 🎉
echo ========================================
echo.
echo Your TileForge installer is ready:
echo Location: dist\TileForge Setup 1.0.0.exe
echo.
echo You can now distribute this installer to your users!
echo.
echo Next steps:
echo 1. Test the installer on a clean machine
echo 2. Share the installer with your team
echo 3. Users just double-click to install
echo.
pause
