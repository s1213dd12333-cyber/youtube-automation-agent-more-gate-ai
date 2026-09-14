'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'upstream', 'agents', 'script-writer-agent.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(from, to, label) {
  if (source.includes(to)) return;
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  source = source.slice(0, index) + to + source.slice(index + from.length);
}

replaceOnce(
`    // Conclusion
    fullScript += \`[\${script.conclusion.duration}] CONCLUSION\\n\`;
    script.conclusion.recap.forEach(line => {
      fullScript += \`\${line}\\n\`;
    });
    fullScript += \`\\n\${script.conclusion.finalThought}\\n\\n\`;
`,
`    // Conclusion — tolerate provider/model shape variation.
    const conclusion = script.conclusion || {};
    const conclusionLines = Array.isArray(conclusion.recap)
      ? conclusion.recap
      : Array.isArray(conclusion.keyPoints)
        ? conclusion.keyPoints
        : conclusion.summary ? [conclusion.summary] : [];
    fullScript += \`[\${conclusion.duration || '30 seconds'}] CONCLUSION\\n\`;
    for (const line of conclusionLines) {
      if (line) fullScript += \`\${line}\\n\`;
    }
    if (conclusion.finalThought) fullScript += \`\\n\${conclusion.finalThought}\\n\\n\`;
`,
'conclusion shape normalization'
);

replaceOnce(
"    fullScript += `KEYWORDS: ${script.keywords.join(', ')}\\n`;\n",
"    fullScript += `KEYWORDS: ${(Array.isArray(script.keywords) ? script.keywords : []).join(', ')}\\n`;\n",
'keywords array guard'
);

replaceOnce(
"    for (const section of script.mainContent.sections) {\n",
"    const sections = Array.isArray(script.mainContent?.sections) ? script.mainContent.sections : [];\n    for (const section of sections) {\n",
'main content sections guard'
);

fs.writeFileSync(target, source, 'utf8');
console.log('ScriptWriter output-shape hardening applied.');
