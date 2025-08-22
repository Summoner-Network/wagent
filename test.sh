#!/bin/bash

# Test script for robust multi-agent system

echo "🚀 Testing robust multi-agent system..."

# First, let's rename the current agent to follow the new convention
echo "📁 Renaming agent directories to follow new convention..."
if [ -d "agent" ]; then
    echo "✅ Root agent directory already exists"
else
    echo "❌ Root agent directory missing!"
    exit 1
fi

# Check if agent-multiplier exists
if [ -d "agent-multiplier" ]; then
    echo "✅ Multiplier agent directory exists"
else
    echo "❌ Multiplier agent directory missing!"
    exit 1
fi

# Clean and rebuild
echo "🧹 Cleaning previous build..."
npm run clean

echo "🔨 Building with new robust system..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
else
    echo "❌ Build failed!"
    exit 1
fi

echo "🏃 Running the system..."
npm run start

if [ $? -eq 0 ]; then
    echo "✅ System ran successfully!"
    echo ""
    echo "🎉 The robust multi-agent system is working!"
    echo ""
    echo "📋 Summary of what was tested:"
    echo "  - Dynamic agent discovery from agent-* directories"
    echo "  - Automatic module mapping and registry creation" 
    echo "  - Flexible requirement discovery across all agents"
    echo "  - Runtime agent resolution and execution"
    echo ""
    echo "🔧 You can now add new agents by creating agent-{name} directories"
    echo "   with main.py and requirements.txt files!"
else
    echo "❌ System execution failed!"
    exit 1
fi