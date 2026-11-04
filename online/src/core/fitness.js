// Age and fitness: older players tire faster in a match and recover more slowly
// between matches; young players can play several matches in a row.
// A 34-year-old who plays 90 minutes ends at about 80 and starts the next match
// at about 90; after two or three full matches in a row he needs a rest.
// A 24-year-old is fresh again every week.
export function ageDrain(age = 27) {
  return age <= 24 ? 0.5 : age <= 27 ? 0.56 : age <= 29 ? 0.62 : age <= 31 ? 0.68 : age <= 32 ? 0.74 : age <= 33 ? 0.8 : age <= 34 ? 0.86 : 0.92;
}
// condition regained before the next match: played / did not play / team had a bye
export function ageRecovery(age = 27, kind = 'played') {
  if (kind === 'played') return age <= 24 ? 16 : age <= 27 ? 14 : age <= 29 ? 13 : age <= 31 ? 12 : age <= 32 ? 11 : age <= 33 ? 10 : age <= 34 ? 9 : 8;
  if (kind === 'bench') return age <= 29 ? 18 : age <= 32 ? 16 : 14;
  return age <= 29 ? 24 : age <= 32 ? 22 : 20; // bye week
}
export function ageLabel(age) {
  return age >= 33 ? 'Biraz çabuk yorulur, yavaş toparlanır' : age >= 30 ? 'Normalden biraz çabuk yorulur' : age <= 24 ? 'Az yorulur, hızlı toparlanır' : 'Normal dayanıklılık';
}
