/**
 * Unassign Assistant from Phone Number
 * For dynamic routing to work, phone numbers should only have serverUrl, not assistantId
 */

import 'dotenv/config';
import { config } from 'dotenv';
import { VapiClient } from '@vapi-ai/server-sdk';

// Load .env file
config();

const VAPI_API_KEY = process.env.VAPI_API_KEY || process.env.VAPI_TOKEN;
const PHONE_NUMBER_ID =
  process.argv[2] ||
  process.env.VAPI_PHONE_NUMBER_ID ||
  '9b69d47f-a50f-4d9d-99c3-eb3ac4bf6ddd';

if (!VAPI_API_KEY) {
  console.error('❌ VAPI_API_KEY or VAPI_TOKEN not found in environment');
  process.exit(1);
}

const vapi = new VapiClient({ token: VAPI_API_KEY });

async function unassignAssistant() {
  try {
    console.log('🔄 Unassigning assistant from phone number...\n');
    console.log(`Phone Number ID: ${PHONE_NUMBER_ID}\n`);

    // Get current phone number configuration
    const currentPhone = await vapi.phoneNumbers.get(PHONE_NUMBER_ID);
    console.log('📞 Current phone number configuration:');
    console.log('  - Name:', currentPhone.name);
    console.log('  - Phone:', currentPhone.phoneNumber);
    console.log('  - Assistant ID:', currentPhone.assistantId || 'NOT SET (good for dynamic routing)');
    console.log('  - Server URL:', currentPhone.serverUrl || 'NOT SET');
    console.log('');

    // Update phone number to remove assistantId (set to null/undefined)
    // Keep serverUrl if it exists
    const API_URL = process.env.API_URL || 'https://eely-val-provocatively.ngrok-free.dev';
    const serverUrl = `${API_URL}/v1/vapi/assistant-request`;

    console.log('🔧 Updating phone number configuration...');
    console.log('  - Removing assistantId (setting to null)');
    console.log('  - Setting serverUrl:', serverUrl);
    console.log('');

    // Update phone number - remove assistantId, keep/update serverUrl
    const updateData = {
      assistantId: null, // Remove assistant assignment
      serverUrl: serverUrl // Ensure serverUrl is set for dynamic routing
    };
    
    // Add serverUrlSecret if available
    if (process.env.VAPI_WEBHOOK_SECRET) {
      updateData.serverUrlSecret = process.env.VAPI_WEBHOOK_SECRET;
    }
    
    const updatedPhone = await vapi.phoneNumbers.update(PHONE_NUMBER_ID, updateData);

    console.log('✅ Phone number updated successfully!\n');
    console.log('📞 Updated phone number configuration:');
    console.log('  - Name:', updatedPhone.name);
    console.log('  - Phone:', updatedPhone.phoneNumber);
    console.log('  - Assistant ID:', updatedPhone.assistantId || 'NULL (✅ Correct for dynamic routing)');
    console.log('  - Server URL:', updatedPhone.serverUrl);
    console.log('  - Server URL Secret:', updatedPhone.serverUrlSecret ? 'SET' : 'NOT SET');
    console.log('\n🎯 Configuration Summary:');
    console.log('  ✅ Assistant ID removed - phone number will use serverUrl for dynamic routing');
    console.log('  ✅ Server URL configured - calls will route to:', serverUrl);
    console.log('  ✅ When calls come in, VAPI will call your serverUrl for assistant-request');
    console.log('\n📝 Updated at:', updatedPhone.updatedAt);
  } catch (error) {
    console.error('❌ Failed to update phone number:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

unassignAssistant();
