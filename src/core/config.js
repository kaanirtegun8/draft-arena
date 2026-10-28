// Central game configuration. Engine weights are the starting config and are
// checked by calibration tests (tests/engine.test.js).

export const NUM_MANAGERS = 5;
export const SQUAD_SIZE = 18;

// Squad composition per manager (sum = SQUAD_SIZE)
export const POSITION_QUOTAS = { GK: 2, DEF: 6, MID: 6, FWD: 4 };

// Performance weights (must sum to 1)
export const PERFORMANCE_WEIGHTS = {
  ea: 0.30,        // EA FC attributes
  form: 0.30,      // real-life form (missing => neutral)
  tactic: 0.15,    // tactic + formation fit
  matchup: 0.10,   // opponent strengths/weaknesses
  condition: 0.10, // fitness/fatigue
  random: 0.05,    // controlled randomness
};

export const MAX_SUBS = 5;
export const MATCH_MINUTES = 90;

// Fitness model (0-100)
export const FITNESS = {
  drainPerMinute: 0.28,         // base condition loss per minute played (scaled by stamina)
  recoverAfterPlaying: 6,       // weekly recovery for players who played that week
  recoverBench: 16,             // squad members of a playing team who did not play
  recoverBye: 24,               // all players of the team with a BAY week
  injuryWeeksMin: 1,
  injuryWeeksMax: 3,
  lowConditionWarn: 60,
};

export const POINTS = { win: 3, draw: 1, loss: 0 };
export const AWARD_BONUS = { topScorer: 2, topAssist: 1 };

export const TACTIC_STYLES = {
  balanced: { label: 'Dengeli', attack: 1.0, defense: 1.0, fatigue: 1.0, possession: 1.0 },
  attacking: { label: 'Hücum', attack: 1.12, defense: 0.92, fatigue: 1.06, possession: 1.03 },
  defensive: { label: 'Savunma', attack: 0.88, defense: 1.1, fatigue: 0.95, possession: 0.97 },
  counter: { label: 'Kontra', attack: 1.04, defense: 1.03, fatigue: 1.0, possession: 0.92 },
  press: { label: 'Yüksek Pres', attack: 1.07, defense: 1.02, fatigue: 1.15, possession: 1.05 },
};

// Formation slots. role is used for position fit.
export const FORMATIONS = {
  '4-3-3': ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CDM', 'CM', 'LW', 'ST', 'RW'],
  '4-4-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'],
  '4-2-3-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'CDM', 'CDM', 'LW', 'CAM', 'RW', 'ST'],
  '3-5-2': ['GK', 'CB', 'CB', 'CB', 'LWB', 'CM', 'CDM', 'CM', 'RWB', 'ST', 'ST'],
  '3-4-3': ['GK', 'CB', 'CB', 'CB', 'LM', 'CM', 'CM', 'RM', 'LW', 'ST', 'RW'],
  '5-3-2': ['GK', 'LWB', 'CB', 'CB', 'CB', 'RWB', 'CM', 'CDM', 'CM', 'ST', 'ST'],
};

export const POSITION_GROUP = {
  GK: 'GK',
  CB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
  CDM: 'MID', CM: 'MID', CAM: 'MID', LM: 'MID', RM: 'MID',
  LW: 'FWD', RW: 'FWD', ST: 'FWD', CF: 'FWD',
};

export const GROUP_LABEL = { GK: 'Kaleci', DEF: 'Defans', MID: 'Orta Saha', FWD: 'Forvet' };

// Position familiarity: compat[slot][playerPos] in 0..1 (missing => derived by group)
const C = {
  GK: { GK: 1 },
  CB: { CB: 1, CDM: 0.82, LB: 0.78, RB: 0.78, LWB: 0.7, RWB: 0.7 },
  LB: { LB: 1, LWB: 0.95, RB: 0.82, CB: 0.78, LM: 0.75, RWB: 0.75 },
  RB: { RB: 1, RWB: 0.95, LB: 0.82, CB: 0.78, RM: 0.75, LWB: 0.75 },
  LWB: { LWB: 1, LB: 0.95, LM: 0.88, RWB: 0.82, RB: 0.78, LW: 0.75 },
  RWB: { RWB: 1, RB: 0.95, RM: 0.88, LWB: 0.82, LB: 0.78, RW: 0.75 },
  CDM: { CDM: 1, CM: 0.92, CB: 0.8, CAM: 0.72 },
  CM: { CM: 1, CDM: 0.92, CAM: 0.9, LM: 0.78, RM: 0.78 },
  CAM: { CAM: 1, CM: 0.9, CF: 0.88, LW: 0.8, RW: 0.8, ST: 0.75 },
  LM: { LM: 1, LW: 0.93, RM: 0.85, LWB: 0.82, CM: 0.78, RW: 0.8 },
  RM: { RM: 1, RW: 0.93, LM: 0.85, RWB: 0.82, CM: 0.78, LW: 0.8 },
  LW: { LW: 1, LM: 0.93, RW: 0.88, ST: 0.8, CF: 0.82, CAM: 0.8 },
  RW: { RW: 1, RM: 0.93, LW: 0.88, ST: 0.8, CF: 0.82, CAM: 0.8 },
  ST: { ST: 1, CF: 0.96, LW: 0.8, RW: 0.8, CAM: 0.76 },
};

export function positionFit(slot, player) {
  const positions = [player.pos, ...(player.alt || [])];
  let best = 0;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    let v = (C[slot] && C[slot][p]) || 0;
    if (!v) {
      if (slot === 'GK' || p === 'GK') v = 0.25;
      else if (POSITION_GROUP[slot] === POSITION_GROUP[p]) v = 0.75;
      else v = 0.55;
    }
    // alternative positions are slightly less natural than the primary one
    if (i > 0) v *= 0.97;
    if (v > best) best = v;
  }
  return best;
}

export const DATA_VERSION = 1;
