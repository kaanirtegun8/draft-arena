// Test fixture: the original 128-player pool mapped to the online schema
// (used only until/unless the full online dataset is present).
import { PLAYERS as OLD } from '../../src/data/players.js';
const WR = { ST: ['H', 'L'], LW: ['H', 'M'], RW: ['H', 'M'], CAM: ['H', 'M'], CM: ['M', 'M'], CDM: ['M', 'H'], LM: ['H', 'M'], RM: ['H', 'M'], CB: ['L', 'H'], LB: ['M', 'H'], RB: ['M', 'H'], GK: ['M', 'M'] };
export const PLAYERS = OLD.map((p) => ({ ...p, foot: p.pos === 'LB' || p.pos === 'LM' ? 'L' : 'R', workAtt: (WR[p.pos] || ['M', 'M'])[0], workDef: (WR[p.pos] || ['M', 'M'])[1], height: null, a: null, mv: null, form: null }));
