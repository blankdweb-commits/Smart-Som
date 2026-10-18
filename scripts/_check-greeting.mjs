// Temporary check of the greeting helper's name-selection rules.
import { greetingForDisplayName, greetingForName } from '../src/utils/getGreeting.js';

const cases = [
  ['Nurse Ada', 'Ada Lovelace', 'identity wins, WHOLE name (not "Nurse")'],
  ['', 'Ada Lovelace', 'no identity -> legal name, first word only'],
  ['', '', 'neither -> the Scholar fallback'],
  ['Scholar-466fb2', 'Ada Lovelace', 'a handle stays whole'],
  ['  Nurse Ada  ', 'Ada Lovelace', 'whitespace trimmed'],
  ['Dr', 'Ada Lovelace', 'a one-word identity is used as-is'],
];

for (const [id, full, why] of cases) {
  console.log(
    `identity=${JSON.stringify(id).padEnd(18)} full=${JSON.stringify(full).padEnd(18)} -> ${greetingForDisplayName(id, full, 'Scholar')}   (${why})`
  );
}

console.log('legacy greetingForName("Ada Lovelace") ->', greetingForName('Ada Lovelace'));
console.log('legacy greetingForName("Scholar-466fb2") ->', greetingForName('Scholar-466fb2'));
