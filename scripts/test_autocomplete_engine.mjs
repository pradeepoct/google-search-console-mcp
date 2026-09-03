import { expandAutocomplete } from '../src/autocomplete.js';

async function test() {
  console.log('Testing Google Autocomplete Engine...');
  const res = await expandAutocomplete({
    query: 'best crm for startups',
    strategy: 'questions',
    country: 'us',
    language: 'en'
  });

  console.log('Total unique suggestions found:', res.totalUniqueSuggestions);
  console.log('Sample suggestions:', res.suggestions.slice(0, 10));
}

test().catch(console.error);
