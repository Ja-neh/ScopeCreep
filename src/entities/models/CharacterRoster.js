export const HUMAN_CHARACTERS = [
  { id: 'deadpool', name: 'Deadpool' },
  { id: 'ashe', name: 'Ashe' },
  { id: 'junker-queen', name: 'Junker Queen' },
  { id: 'firion', name: 'Firion' },
  { id: 'bob', name: 'BOB' }
];
export const ALIEN_CHARACTERS = ['gorr', 'galiant', 'bahamut-nt', 'bahamut-xvi'];
export const characterName=id=>HUMAN_CHARACTERS.find(c=>c.id===id)?.name ||
  ({gorr:'Gorr',galiant:'Galiant Beast','bahamut-nt':'Bahamut NT','bahamut-xvi':'Bahamut XVI'})[id] || id;
const KEY = 'scopecreep.character';
let selected = 'deadpool';
export const isHumanCharacter = id => HUMAN_CHARACTERS.some(c => c.id === id);

export function getSelectedCharacter() {
  try {
    const saved = globalThis.window?.localStorage?.getItem(KEY);
    if (isHumanCharacter(saved)) selected = saved;
  } catch { /* Private browsing can disable storage; the session selection still works. */ }
  return selected;
}

export function selectCharacter(id) {
  if (!isHumanCharacter(id)) return false;
  selected = id;
  try { globalThis.window?.localStorage?.setItem(KEY, id); } catch { /* Keep the session choice. */ }
  return true;
}

export function squadCharacter(name,leaderId=getSelectedCharacter(),index=null) {
  // Remain safe as an Array.map callback (its index/array are not roster options).
  if(!isHumanCharacter(leaderId))leaderId=getSelectedCharacter();
  if(!Number.isInteger(index))index=null;
  const available = HUMAN_CHARACTERS.filter(c => c.id !== leaderId);
  const slot = index ?? ['Okafor', 'Reyes', 'Novak', 'Chen'].indexOf(name);
  return slot < 0 ? 'bob' : available[slot % available.length].id;
}
