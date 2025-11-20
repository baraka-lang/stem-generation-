#!/bin/bash

# Deploy Gemini Loop Fix Feature
# This script deploys both edge functions required for Gemini-assisted loop fixing

set -e

echo "════════════════════════════════════════════════════════"
echo "🚀 Deploying Gemini Loop Fix Feature"
echo "════════════════════════════════════════════════════════"
echo ""

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "❌ Error: .env file not found"
    exit 1
fi

# Check if Gemini API key is set
if [ -z "$GEMINI_API_KEY" ] || [ "$GEMINI_API_KEY" = "your-gemini-api-key-here" ]; then
    echo "❌ Error: GEMINI_API_KEY not configured in .env"
    echo "   Get your key from: https://aistudio.google.com/app/apikey"
    exit 1
fi

echo "✓ GEMINI_API_KEY found in .env"
echo ""

# Set Supabase secrets
echo "📝 Step 1: Setting Gemini API key as Supabase secret..."
npx supabase secrets set GEMINI_API_KEY="$GEMINI_API_KEY" || {
    echo "⚠️  Warning: Failed to set secret. Make sure you're logged in:"
    echo "   npx supabase login"
    echo "   npx supabase link --project-ref fsdknzsgdzlexyjallmy"
    exit 1
}
echo "   ✓ Secret set successfully"
echo ""

# Deploy loop-fix-gemini function
echo "📤 Step 2: Deploying loop-fix-gemini function..."
npx supabase functions deploy loop-fix-gemini || {
    echo "❌ Failed to deploy loop-fix-gemini"
    exit 1
}
echo "   ✓ loop-fix-gemini deployed successfully"
echo ""

# Deploy generate-techno-stem function
echo "📤 Step 3: Deploying generate-techno-stem function..."
npx supabase functions deploy generate-techno-stem || {
    echo "❌ Failed to deploy generate-techno-stem"
    exit 1
}
echo "   ✓ generate-techno-stem deployed successfully"
echo ""

echo "════════════════════════════════════════════════════════"
echo "✅ Deployment Complete!"
echo "════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Run tests: node test-gemini-loop-fix.js"
echo "  2. Check function logs: npx supabase functions logs loop-fix-gemini"
echo "  3. View in dashboard: https://supabase.com/dashboard/project/fsdknzsgdzlexyjallmy"
echo ""
echo "Functions deployed:"
echo "  • loop-fix-gemini: https://fsdknzsgdzlexyjallmy.supabase.co/functions/v1/loop-fix-gemini"
echo "  • generate-techno-stem: https://fsdknzsgdzlexyjallmy.supabase.co/functions/v1/generate-techno-stem"
echo ""
