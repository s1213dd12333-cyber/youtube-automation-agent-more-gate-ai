'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'upstream', 'utils', 'visual-router-v8.js');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const from = `  const lexical = overlapScore(query, candidateText);\n  const sourceOrder = preferredSources(brief);\n  const sourceRank = sourceOrder.indexOf(candidate.source);\n  const sourceBoost = sourceRank < 0 ? 0 : Math.max(0, 0.18 - sourceRank * 0.035);\n  const rightsBoost = candidate.rights?.autoUseEligible ? 0.25 : candidate.rights?.status === 'review_required' ? 0.04 : 0;\n  const width = Number(candidate.width || 0);\n  const height = Number(candidate.height || 0);\n  const sizeBoost = width >= 1280 && height >= 720 ? 0.08 : width >= 800 ? 0.03 : 0;\n  return Math.max(0, Math.min(1, Number((lexical * 0.62 + sourceBoost + rightsBoost + sizeBoost).toFixed(4))));`;
const to = `  const lexical = overlapScore(query, candidateText);\n  // Rights metadata can never rescue an irrelevant asset. Require a real scene match first.\n  if (lexical < 0.12) return 0;\n  const sourceOrder = preferredSources(brief);\n  const sourceRank = sourceOrder.indexOf(candidate.source);\n  const sourceBoost = sourceRank < 0 ? 0 : Math.max(0, 0.10 - sourceRank * 0.02);\n  const rightsBoost = candidate.rights?.autoUseEligible ? 0.15 : candidate.rights?.status === 'review_required' ? 0.02 : 0;\n  const width = Number(candidate.width || 0);\n  const height = Number(candidate.height || 0);\n  const sizeBoost = width >= 1280 && height >= 720 ? 0.05 : width >= 800 ? 0.02 : 0;\n  return Math.max(0, Math.min(1, Number((lexical * 0.72 + sourceBoost + rightsBoost + sizeBoost).toFixed(4))));`;

if (!source.includes(to)) {
  if (!source.includes(from)) throw new Error('Phase 8 relevance-score anchor not found');
  source = source.replace(from, to);
}
fs.writeFileSync(file, source, 'utf8');
console.log('Phase 8 visual routing requires lexical relevance before source/license bonuses.');
