#!/bin/bash

# Verify redirect_uri matches what's configured
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

REDIRECT_URI="${API_URL}/v1/onboarding/pos/square/callback"

echo "🔍 Verifying Square OAuth redirect URI..."
echo ""
echo "📍 Redirect URI in code: $REDIRECT_URI"
echo ""
echo "⚠️  IMPORTANT: This redirect URI must match EXACTLY what's configured in:"
echo "   → Square Developer Dashboard → OAuth → Redirect URL"
echo ""
echo "✅ If they match, the token exchange should work correctly"
echo ""
echo "📋 To check Square Dashboard:"
echo "   1. Go to https://developer.squareup.com/apps"
echo "   2. Select your app"
echo "   3. Go to OAuth tab"
echo "   4. Check 'Redirect URL' field"
echo "   5. Ensure it matches: $REDIRECT_URI"
