#!/bin/bash

# Development script for llama.cpp webui
#
# This script starts the webui development servers (Storybook and Vite).
# Note: You need to start llama-server separately.
#
# Usage:
#   bash scripts/dev.sh
#   npm run dev

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Change to project root
cd "$PROJECT_ROOT"

# Check and install git hooks if missing
check_and_install_hooks() {
    # Skip if not a git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        return 0
    fi

    local hooks_missing=false

    # Check for required hooks
    if [ ! -f ".git/hooks/pre-commit" ] || [ ! -f ".git/hooks/pre-push" ] || [ ! -f ".git/hooks/post-push" ]; then
        hooks_missing=true
    fi

    if [ "$hooks_missing" = true ]; then
        echo "🔧 Git hooks missing, installing them..."
        if [ -f "scripts/install-git-hooks.sh" ]; then
            if bash scripts/install-git-hooks.sh; then
                echo "✅ Git hooks installed successfully"
            else
                echo "⚠️  Failed to install git hooks, continuing anyway..."
            fi
        else
            echo "⚠️  Git hooks installation script not found, continuing anyway..."
        fi
    else
        echo "✅ Git hooks already installed"
    fi
}

# Install git hooks if needed
check_and_install_hooks

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up..."
    exit
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

echo "🚀 Starting development servers..."
echo "📝 Note: Make sure to start llama-server separately if needed"

# Set cache directory explicitly to avoid permission issues
export STORYBOOK_CACHE_DIR="$PROJECT_ROOT/node_modules/.cache/storybook"
mkdir -p "$STORYBOOK_CACHE_DIR"

storybook dev -p 6006 --ci & vite dev --host 0.0.0.0 &

# Wait for all background processes
wait
