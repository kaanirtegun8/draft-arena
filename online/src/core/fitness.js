// Age and fitness: older players tire much faster in a match and recover slowly
// between matches; young players can play several matches in a row.
// A 35-year-old who plays 90 minutes starts the next match at about half condition,
// a 24-year-old is almost fresh again.
export function ageDrain(age = 27) {
  return age <= 24 ? 0.5 : age <= 27 ? 0.6 : age <= 29 ? 0.7 : age <= 31 ? 0.82 : age <= 32 ? 0.95 : age <= 33 ? 1.05 : age <= 34 ? 1.15 : 1.25;
}
// condition regained before the next match: played / did not play / team had a bye
export function ageRecovery(age = 27, kind = 'played') {
  if (kind === 'played') return age <= 24 ? 16 : age <= 27 ? 13 : age <= 29 ? 10 : age <= 31 ? 7 : age <= 32 ? 5 : age <= 33 ? 4 : 2;
  if (kind === 'bench') return age <= 29 ? 18 : age <= 32 ? 12 : 8;
  return age <= 29 ? 24 : age <= 32 ? 16 : 10; // bye week
}
export function ageLabel(age) {
  return age >= 33 ? 'Çok çabuk yorulur, yavaş toparlanır' : age >= 30 ? 'Çabuk yorulur' : age <= 24 ? 'Az yorulur, hızlı toparlanır' : 'Normal dayanıklılık';
}
