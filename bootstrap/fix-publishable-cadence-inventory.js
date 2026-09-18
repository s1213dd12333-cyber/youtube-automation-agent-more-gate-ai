'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, 'upstream');
const file = rel => path.join(upstream, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const write = (rel, value) => fs.writeFileSync(file(rel), value.replace(/\r\n/g, '\n'), 'utf8');

function replaceAllExact(text, from, to, label, expected = 1) {
  if (text.includes(to) && !text.includes(from)) return text;
  const count = text.split(from).length - 1;
  if (count !== expected) throw new Error(`Publishable inventory anchor ${label}: expected ${expected}, found ${count}`);
  return text.split(from).join(to);
}

function patchCompletedOutputCounts() {
  const oldQuery = [
    "      const weeklyOutput = await this.db.getRow(",
    "        `SELECT COUNT(*) AS count FROM generation_jobs",
    "         WHERE source = 'autonomous_operator' AND status = 'completed'",
    "         AND created_at >= datetime('now', '-7 days')`",
    "      );"
  ].join('\n');
  const newQuery = [
    "      const weeklyOutput = await this.db.getRow(",
    "        `SELECT COUNT(*) AS count",
    "         FROM generation_jobs gj",
    "         LEFT JOIN content_reviews cr ON cr.production_id = gj.production_id",
    "         WHERE gj.source = 'autonomous_operator' AND gj.status = 'completed'",
    "         AND cr.status IN ('needs_review', 'approved')",
    "         AND gj.created_at >= datetime('now', '-7 days')`",
    "      );"
  ].join('\n');

  let source = read('index.js');
  source = replaceAllExact(source, oldQuery, newQuery, 'index weekly output', 1);
  write('index.js', source);

  source = read('schedules/daily-automation.js');
  source = replaceAllExact(source, oldQuery, newQuery, 'scheduler weekly output', 1);
  source = replaceAllExact(
    source,
    "        this.logger.info('Skipping content generation - sufficient content in pipeline');",
    "        this.logger.info('Skipping content generation - publishable buffer or cadence target is already satisfied');",
    'scheduler skip reason',
    1
  );
  write('schedules/daily-automation.js', source);
}

function patchUpcomingSchedule() {
  let source = read('agents/publishing-scheduling-agent.js');
  const oldFilter = [
    "    return this.publishQueue",
    "      .filter(entry => {",
    "        const publishTime = new Date(entry.publishTime);",
    "        return publishTime >= now && publishTime <= endDate;",
    "      })"
  ].join('\n');
  const newFilter = [
    "    return this.publishQueue",
    "      .filter(entry => {",
    "        if (entry.status !== 'scheduled') return false;",
    "        const publishTime = new Date(entry.publishTime);",
    "        return publishTime >= now && publishTime <= endDate;",
    "      })"
  ].join('\n');
  source = replaceAllExact(source, oldFilter, newFilter, 'upcoming schedule status filter', 1);
  write('agents/publishing-scheduling-agent.js', source);
}

function patchPackage() {
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:publishable-inventory'] = 'node ../bootstrap/verify-publishable-cadence-inventory.js';
  write('package.json', JSON.stringify(pkg, null, 2) + '\n');
}

patchCompletedOutputCounts();
patchUpcomingSchedule();
patchPackage();

console.log('Publishable cadence inventory active: blocked productions no longer satisfy weekly output, and only scheduled queue entries count toward future buffer.');
