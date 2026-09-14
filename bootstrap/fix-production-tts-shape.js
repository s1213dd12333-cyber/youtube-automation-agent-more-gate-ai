'use strict';

const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, '..', 'upstream', 'agents', 'production-management-agent.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function replaceOnce(from, to, label) {
  if (source.includes(to)) return;
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Anchor not found for ${label}`);
  source = source.slice(0, index) + to + source.slice(index + from.length);
}

replaceOnce(
`    return {
      originalPath: scriptPath,
      ttsPath: scriptPath.replace('.json', '_tts.txt'),
      duration: script.duration,
      sections: script.mainContent.sections.length
    };
`,
`    const sections = Array.isArray(script.mainContent?.sections) ? script.mainContent.sections : [];
    return {
      originalPath: scriptPath,
      ttsPath: scriptPath.replace('.json', '_tts.txt'),
      duration: script.duration,
      sections: sections.length
    };
`,
'processScript sections length guard'
);

replaceOnce(
`    // Add main content
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach((section, index) => {
        ttsText += \`Section \${index + 1}: \${section.title}\\n\`;
        
        if (Array.isArray(section.content)) {
          section.content.forEach(line => {
            if (typeof line === 'string' && !line.startsWith('[')) {
              ttsText += \`\${line}\\n\`;
            }
          });
        } else if (section.steps) {
          section.steps.forEach(step => {
            ttsText += \`\${step.title}. \${step.description}\\n\`;
            ttsText += \`\${step.tip}\\n\`;
          });
        } else if (section.items) {
          section.items.forEach(item => {
            ttsText += \`Number \${item.number}: \${item.title}. \${item.description}\\n\`;
          });
        } else if (typeof section.content === 'string') {
          ttsText += \`\${section.content}\\n\`;
        }
        
        ttsText += '\\n';
      });
    }
    
    // Add conclusion
    if (script.conclusion) {
      script.conclusion.recap.forEach(line => {
        if (typeof line === 'string') {
          ttsText += \`\${line}\\n\`;
        }
      });
      ttsText += \`\\n\${script.conclusion.finalThought}\\n\\n\`;
    }
`,
`    // Add main content — tolerate provider/model shape variation.
    const sections = Array.isArray(script.mainContent?.sections) ? script.mainContent.sections : [];
    sections.forEach((section, index) => {
      if (!section || typeof section !== 'object') return;
      const title = section.title || \`Section \${index + 1}\`;
      ttsText += \`Section \${index + 1}: \${title}\\n\`;
      
      if (Array.isArray(section.content)) {
        section.content.forEach(line => {
          if (typeof line === 'string' && !line.startsWith('[')) {
            ttsText += \`\${line}\\n\`;
          }
        });
      } else if (Array.isArray(section.steps)) {
        section.steps.forEach(step => {
          if (!step || typeof step !== 'object') return;
          const sentence = [step.title, step.description].filter(Boolean).join('. ');
          if (sentence) ttsText += \`\${sentence}\\n\`;
          if (step.tip) ttsText += \`\${step.tip}\\n\`;
        });
      } else if (Array.isArray(section.items)) {
        section.items.forEach((item, itemIndex) => {
          if (!item || typeof item !== 'object') return;
          const number = item.number ?? (itemIndex + 1);
          const sentence = [item.title, item.description].filter(Boolean).join('. ');
          if (sentence) ttsText += \`Number \${number}: \${sentence}\\n\`;
        });
      } else if (Array.isArray(section.points)) {
        section.points.forEach(point => {
          if (typeof point === 'string') ttsText += \`\${point}\\n\`;
        });
      } else if (typeof section.content === 'string') {
        ttsText += \`\${section.content}\\n\`;
      }
      
      ttsText += '\\n';
    });
    
    // Add conclusion — accept recap, keyPoints, or summary.
    if (script.conclusion) {
      const conclusion = script.conclusion;
      const conclusionLines = Array.isArray(conclusion.recap)
        ? conclusion.recap
        : Array.isArray(conclusion.keyPoints)
          ? conclusion.keyPoints
          : conclusion.summary ? [conclusion.summary] : [];
      conclusionLines.forEach(line => {
        if (typeof line === 'string') {
          ttsText += \`\${line}\\n\`;
        }
      });
      if (conclusion.finalThought) ttsText += \`\\n\${conclusion.finalThought}\\n\\n\`;
    }
`,
'TTS script shape normalization'
);

fs.writeFileSync(target, source, 'utf8');
console.log('ProductionManagement TTS output-shape hardening applied.');
