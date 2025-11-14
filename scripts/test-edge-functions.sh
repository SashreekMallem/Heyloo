#!/bin/bash

# Edge Functions Testing Script
# Tests all Supabase Edge Functions for basic functionality

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_URL="https://fjfhwbtovmbooaqafdxb.supabase.co"
BASE_URL="${PROJECT_URL}/functions/v1"

# Test counters
PASSED=0
FAILED=0
SKIPPED=0

# Helper functions
print_test() {
    echo -e "\n${YELLOW}Testing: $1${NC}"
}

print_pass() {
    echo -e "${GREEN}✓ PASSED: $1${NC}"
    ((PASSED++))
}

print_fail() {
    echo -e "${RED}✗ FAILED: $1${NC}"
    ((FAILED++))
}

print_skip() {
    echo -e "${YELLOW}⊘ SKIPPED: $1${NC}"
    ((SKIPPED++))
}

test_endpoint() {
    local name=$1
    local method=$2
    local path=$3
    local headers=$4
    local data=$5
    
    print_test "$name"
    
    local url="${BASE_URL}${path}"
    local cmd="curl -s -w '\n%{http_code}' -X ${method}"
    
    if [ ! -z "$headers" ]; then
        cmd="$cmd $headers"
    fi
    
    if [ ! -z "$data" ]; then
        cmd="$cmd -d '$data'"
    fi
    
    cmd="$cmd '$url'"
    
    local response=$(eval $cmd)
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        print_pass "$name (HTTP $http_code)"
        return 0
    elif [ "$http_code" -eq 401 ] || [ "$http_code" -eq 403 ]; then
        print_skip "$name (HTTP $http_code - Auth required, skipping)"
        return 2
    else
        print_fail "$name (HTTP $http_code)"
        echo "Response: $body" | head -c 200
        return 1
    fi
}

# Start testing
echo "=========================================="
echo "Edge Functions Testing Suite"
echo "=========================================="
echo "Project: $PROJECT_URL"
echo ""

# 1. Test CORS preflight (OPTIONS)
test_endpoint "Auth - CORS" "OPTIONS" "/auth/login" "-H 'Content-Type: application/json'"
test_endpoint "Restaurants - CORS" "OPTIONS" "/restaurants" "-H 'Content-Type: application/json'"
test_endpoint "POS - CORS" "OPTIONS" "/pos/sync" "-H 'Content-Type: application/json'"

# 2. Test public endpoints (no auth)
test_endpoint "Onboarding - Status Check" "GET" "/onboarding/status/test-id" "-H 'Content-Type: application/json'"
test_endpoint "POS Sync - Health" "POST" "/pos-sync" "-H 'Content-Type: application/json'" '{"restaurantId":"test"}'

# 3. Test webhook endpoints (may fail without proper signatures, but should not 500)
test_endpoint "Clover Webhook - Health" "POST" "/clover-webhook" "-H 'Content-Type: application/json'" '{"type":"test"}'
test_endpoint "Square Webhook - Health" "POST" "/square-webhook" "-H 'Content-Type: application/json'" '{"type":"test"}'
test_endpoint "Stripe Webhook - Health" "POST" "/stripe-webhook" "-H 'Content-Type: application/json' -H 'stripe-signature: test'" '{"type":"test"}'
test_endpoint "VAPI Events - Health" "POST" "/vapi-events" "-H 'Content-Type: application/json' -H 'x-vapi-signature: test'" '{"type":"test"}'

# 4. Test auth endpoint (public)
test_endpoint "Auth - Login (Invalid)" "POST" "/auth/login" "-H 'Content-Type: application/json'" '{"email":"test@test.com","password":"wrong"}'
# Should return 401, which is expected for invalid credentials

# 5. Test endpoints that require auth (will skip)
test_endpoint "Restaurants - List" "GET" "/restaurants" "-H 'Content-Type: application/json'"
test_endpoint "Orders - Create" "POST" "/orders" "-H 'Content-Type: application/json'" '{"restaurantId":"test"}'
test_endpoint "Platform - Overview" "GET" "/platform/overview" "-H 'Content-Type: application/json'"

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo -e "${YELLOW}Skipped: $SKIPPED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi

