/**
 * smoke_llm.ts — Verify Andromeda's LLM provider works with Claude Sonnet 4.5
 */
import { readFileSync } from 'fs';
import { simpleChatCompletion } from '../server/llmProvider.js';

// Load environment variables from andromeda_env.local
const env = readFileSync('/home/ubuntu/andromeda_env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

async function main() {
  console.log('Testing Andromeda LLM provider with Claude Sonnet 4.5...');
  const result = await simpleChatCompletion(
    [{ role: 'user', content: 'Say "Andromeda online" and nothing else.' }],
    { maxTokens: 20, providerId: 'anthropic' }
  );
  console.log('LLM response:', result);
  console.log('SUCCESS: Andromeda LLM provider is working.');
}

main().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
