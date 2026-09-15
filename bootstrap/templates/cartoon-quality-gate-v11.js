'use strict';

const crypto = require('crypto');
const fs = require('fs');

const VERSION = '11.6';
const KEYFRAME_ROLES = Object.freeze(['start', 'middle', 'end']);
const BLOCKING_SEVERITIES = new Set(['CRITICAL', 'HIGH']);

function clean(value, limit = 16000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.max(min, Math.min(max, number));
}

function qualityFinding(id, severity, message, remediation, options = {}) {
  return {
    id,
    severity,
    blocking: options.blocking === undefined ? BLOCKING_SEVERITIES.has(severity) : Boolean(options.blocking),
    message,
    remediation: remediation || null,
    sceneId: options.sceneId || null,
    shotId: options.shotId || null,
    keyframeId: options.keyframeId || null,
    evidence: options.evidence || null
  };
}

function fileDigest(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_error) {
    return null;
  }
}

function latestContinuityByKeyframe(checks = []) {
  const latest = new Map();
  for (const check of checks || []) {
    const key = check.keyframe_id || check.keyframeId;
    if (!key) continue;
    const current = latest.get(key);
    const attempt = Number(check.attempt || 0);
    const currentAttempt = current ? Number(current.attempt || 0) : -1;
    const created = String(check.created_at || check.createdAt || '');
    const currentCreated = current ? String(current.created_at || current.createdAt || '') : '';
    if (!current || attempt > currentAttempt || (attempt === currentAttempt && created >= currentCreated)) latest.set(key, check);
  }
  return latest;
}

function isCartoonProduction(production = {}) {
  return production.cartoonBible?.mode === 'kids_cartoon_2d';
}

function evaluateCartoonQualityV11(production = {}, options = {}) {
  if (!isCartoonProduction(production)) {
    return {
      version: VERSION,
      active: false,
      productionId: production.id || null,
      status: 'not_applicable',
      passed: true,
      score: 100,
      findings: [],
      blockers: [],
      metrics: {},
      fingerprint: null,
      createdAt: new Date().toISOString()
    };
  }

  const minShots = clampInt(options.minShots ?? process.env.CARTOON_SHOTS_PER_SCENE_MIN, 3, 2, 8);
  const maxShots = clampInt(options.maxShots ?? process.env.CARTOON_SHOTS_PER_SCENE_MAX, 6, minShots, 10);
  const scenes = Array.isArray(production.scenes) ? production.scenes : [];
  const shots = Array.isArray(production.shots) ? production.shots : [];
  const keyframes = Array.isArray(production.keyframes) ? production.keyframes : [];
  const continuityChecks = Array.isArray(production.continuityChecks) ? production.continuityChecks : [];
  const motionSegments = Array.isArray(production.motionSegments) ? production.motionSegments : [];
  const motionScenes = Array.isArray(production.motionScenes) ? production.motionScenes : [];
  const bible = production.cartoonBible || {};
  const visualBriefs = Object.values(production.assets?.sceneManifest?.visualBriefs || {}).filter(Boolean);
  const latestContinuity = latestContinuityByKeyframe(continuityChecks);
  const findings = [];
  let score = 100;

  if (!Array.isArray(bible.characters) || bible.characters.length === 0) {
    score -= 40;
    findings.push(qualityFinding(
      'cartoon_bible_missing_characters', 'CRITICAL',
      'Cartoon mode is active but the Character Bible has no persisted characters.',
      'Regenerate the Phase 11.1 Character Bible before producing or approving the cartoon.',
      { blocking: true }
    ));
  }

  if (!scenes.length) {
    score -= 60;
    findings.push(qualityFinding(
      'cartoon_no_scenes', 'CRITICAL',
      'Cartoon production has no persisted scenes.',
      'Rebuild the scene manifest before continuing the cartoon pipeline.',
      { blocking: true }
    ));
  }

  const shotByScene = new Map();
  for (const shot of shots) {
    if (!shotByScene.has(shot.sceneId)) shotByScene.set(shot.sceneId, []);
    shotByScene.get(shot.sceneId).push(shot);
  }
  for (const items of shotByScene.values()) items.sort((a, b) => Number(a.shotIndex || 0) - Number(b.shotIndex || 0));

  const keyframesByShot = new Map();
  for (const frame of keyframes) {
    if (!keyframesByShot.has(frame.shotId)) keyframesByShot.set(frame.shotId, []);
    keyframesByShot.get(frame.shotId).push(frame);
  }
  for (const items of keyframesByShot.values()) items.sort((a, b) => Number(a.keyframeIndex || 0) - Number(b.keyframeIndex || 0));

  const motionByShot = new Map(motionSegments.map(item => [item.shotId, item]));
  const motionByScene = new Map(motionScenes.map(item => [item.sceneId, item]));

  let shotCountViolations = 0;
  let promptContractViolations = 0;
  let keyframeContractViolations = 0;
  let keyframeAssetFailures = 0;
  let continuityMissing = 0;
  let continuityRejected = 0;
  let motionSegmentFailures = 0;
  let motionSceneFailures = 0;
  let sceneMotionBindingFailures = 0;
  let staticShots = 0;
  let partiallyStaticShots = 0;
  let durationMismatches = 0;
  let continuityScoreTotal = 0;
  let continuityScoreCount = 0;
  let compositionScoreTotal = 0;
  let compositionScoreCount = 0;
  let referenceConditionedAccepted = 0;
  let acceptedContinuityCount = 0;

  const digestCounts = new Map();

  for (const scene of scenes) {
    const sceneShots = shotByScene.get(scene.id) || [];
    if (sceneShots.length < minShots || sceneShots.length > maxShots) {
      shotCountViolations += 1;
      score -= 18;
      findings.push(qualityFinding(
        'cartoon_shot_count', 'HIGH',
        `${scene.label || scene.id} has ${sceneShots.length} shot(s); the active cartoon contract expects ${minShots}-${maxShots}.`,
        'Re-run the Shot Planner for this scene and rebuild downstream keyframes and motion.',
        { blocking: true, sceneId: scene.id, evidence: { shotCount: sceneShots.length, minShots, maxShots } }
      ));
    }

    const expectedIndices = sceneShots.map((_, index) => index);
    const actualIndices = sceneShots.map(item => Number(item.shotIndex || 0));
    if (sceneShots.length && actualIndices.some((value, index) => value !== expectedIndices[index])) {
      score -= 12;
      findings.push(qualityFinding(
        'cartoon_shot_order', 'HIGH',
        `${scene.label || scene.id} has a non-contiguous shot order.`,
        'Rebuild the persisted shot plan so shot indexes are contiguous and deterministic.',
        { blocking: true, sceneId: scene.id, evidence: actualIndices }
      ));
    }

    const plannedDuration = sceneShots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
    const sceneDuration = Number(scene.duration || 0);
    const durationTolerance = Math.max(0.35, sceneDuration * 0.035);
    if (sceneShots.length && sceneDuration > 0 && Math.abs(plannedDuration - sceneDuration) > durationTolerance) {
      durationMismatches += 1;
      score -= 8;
      findings.push(qualityFinding(
        'cartoon_scene_duration_mismatch', 'MEDIUM',
        `${scene.label || scene.id} shot durations total ${plannedDuration.toFixed(2)}s but the scene is ${sceneDuration.toFixed(2)}s.`,
        'Re-run shot planning so motion timing matches the narration-aware scene duration.',
        { blocking: false, sceneId: scene.id, evidence: { plannedDuration, sceneDuration } }
      ));
    }

    const motionScene = motionByScene.get(scene.id);
    const motionSceneReady = Boolean(motionScene && motionScene.status === 'ready' && fileDigest(motionScene.outputPath));
    if (!motionSceneReady) {
      motionSceneFailures += 1;
      score -= 22;
      findings.push(qualityFinding(
        'cartoon_motion_scene_missing', 'CRITICAL',
        `${scene.label || scene.id} does not have a ready Phase 11.5 scene motion composition.`,
        'Run or resume the Motion Composer after every shot keyframe passes continuity.',
        { blocking: true, sceneId: scene.id }
      ));
    }

    const boundToMotion = scene.assetType === 'video' &&
      scene.assetOrigin === 'generated-motion' &&
      scene.provider === 'cartoon-motion-v11' &&
      Boolean(fileDigest(scene.assetPath));
    if (!boundToMotion) {
      sceneMotionBindingFailures += 1;
      score -= 20;
      findings.push(qualityFinding(
        'cartoon_scene_not_motion_bound', 'CRITICAL',
        `${scene.label || scene.id} is not bound to the Phase 11.5 motion video.`,
        'Re-compose the cartoon scene and persist the generated-motion MP4 as the active scene visual.',
        { blocking: true, sceneId: scene.id, evidence: { assetType: scene.assetType, assetOrigin: scene.assetOrigin, provider: scene.provider } }
      ));
    }
  }

  for (const shot of shots) {
    const prompt = String(shot.prompt || '');
    const promptContractReady = ['SHOT PLAN V11.2:', 'ACTION:', 'CHARACTERS:', 'CAMERA:', 'CONTINUITY:'].every(marker => prompt.includes(marker));
    if (!promptContractReady) {
      promptContractViolations += 1;
      score -= 10;
      findings.push(qualityFinding(
        'cartoon_generic_shot_prompt', 'HIGH',
        `Shot ${Number(shot.shotIndex || 0) + 1} is missing concrete Character/Action/Camera/Continuity prompt fields.`,
        'Rebuild the shot prompt from the Character Bible and Shot Planner instead of using a generic image prompt.',
        { blocking: true, sceneId: shot.sceneId, shotId: shot.id }
      ));
    }

    const frames = keyframesByShot.get(shot.id) || [];
    const roles = frames.map(item => item.keyframeRole);
    if (frames.length !== 3 || roles.join(',') !== KEYFRAME_ROLES.join(',')) {
      keyframeContractViolations += 1;
      score -= 24;
      findings.push(qualityFinding(
        'cartoon_keyframe_contract', 'CRITICAL',
        `Shot ${Number(shot.shotIndex || 0) + 1} does not have the exact start/middle/end keyframe contract.`,
        'Re-run Phase 11.3 for this shot before motion composition.',
        { blocking: true, sceneId: shot.sceneId, shotId: shot.id, evidence: roles }
      ));
      continue;
    }

    const shotDigests = [];
    for (const frame of frames) {
      const promptReady = String(frame.prompt || '').includes('KEYFRAME PIPELINE V11.3:') &&
        String(frame.prompt || '').includes(`KEYFRAME ROLE: ${String(frame.keyframeRole || '').toUpperCase()}`);
      if (!promptReady) {
        keyframeContractViolations += 1;
        score -= 8;
        findings.push(qualityFinding(
          'cartoon_keyframe_prompt_contract', 'HIGH',
          `${frame.keyframeRole || 'unknown'} keyframe is missing its Phase 11.3 role contract.`,
          'Re-plan the keyframe so its role-specific action state is explicit.',
          { blocking: true, sceneId: frame.sceneId, shotId: frame.shotId, keyframeId: frame.id }
        ));
      }

      const digest = frame.status === 'ready' ? fileDigest(frame.assetPath) : null;
      if (!digest) {
        keyframeAssetFailures += 1;
        score -= 16;
        findings.push(qualityFinding(
          'cartoon_keyframe_not_ready', 'CRITICAL',
          `${frame.keyframeRole || 'unknown'} keyframe is not a ready readable image asset.`,
          'Resume keyframe generation/repair until the persisted frame is ready on disk.',
          { blocking: true, sceneId: frame.sceneId, shotId: frame.shotId, keyframeId: frame.id, evidence: { status: frame.status, assetPath: frame.assetPath || null } }
        ));
      } else {
        shotDigests.push(digest);
        digestCounts.set(digest, (digestCounts.get(digest) || 0) + 1);
      }

      if (frame.referenceKeyframeId) {
        const check = latestContinuity.get(frame.id);
        if (!check) {
          continuityMissing += 1;
          score -= 16;
          findings.push(qualityFinding(
            'cartoon_continuity_missing', 'CRITICAL',
            `No persisted Phase 11.4 continuity decision exists for ${frame.keyframeRole || 'keyframe'}.`,
            'Run the Continuity Engine and persist its decision before motion composition.',
            { blocking: true, sceneId: frame.sceneId, shotId: frame.shotId, keyframeId: frame.id }
          ));
        } else {
          const status = String(check.status || '');
          const checkScore = Number(check.score || 0);
          const threshold = Number(check.threshold || 0);
          if (status !== 'accepted' || checkScore < threshold) {
            continuityRejected += 1;
            score -= 20;
            findings.push(qualityFinding(
              'cartoon_continuity_rejected', 'CRITICAL',
              `Continuity is not accepted for ${frame.keyframeRole || 'keyframe'} (${checkScore.toFixed(3)} < ${threshold.toFixed(3)} or status=${status}).`,
              'Repair or regenerate the frame against its reference image; do not publish with unresolved visual drift.',
              { blocking: true, sceneId: frame.sceneId, shotId: frame.shotId, keyframeId: frame.id, evidence: { status, score: checkScore, threshold } }
            ));
          } else {
            continuityScoreTotal += checkScore;
            continuityScoreCount += 1;
            acceptedContinuityCount += 1;
            const composition = Number(check.metrics?.compositionGrid);
            if (Number.isFinite(composition)) {
              compositionScoreTotal += composition;
              compositionScoreCount += 1;
            }
            if (check.referenceConditioned === true || check.reference_conditioned === 1) referenceConditionedAccepted += 1;
          }
        }
      }
    }

    if (shotDigests.length === 3) {
      const unique = new Set(shotDigests).size;
      if (unique === 1) {
        staticShots += 1;
        score -= 22;
        findings.push(qualityFinding(
          'cartoon_static_shot', 'HIGH',
          `Shot ${Number(shot.shotIndex || 0) + 1} uses byte-identical start, middle, and end frames.`,
          'Regenerate the shot so pose/action visibly progresses across its keyframes.',
          { blocking: true, sceneId: shot.sceneId, shotId: shot.id }
        ));
      } else if (unique === 2) {
        partiallyStaticShots += 1;
        score -= 5;
        findings.push(qualityFinding(
          'cartoon_partial_static_shot', 'MEDIUM',
          `Shot ${Number(shot.shotIndex || 0) + 1} repeats one exact keyframe image.`,
          'Review whether the hold is intentional; otherwise regenerate the repeated action state.',
          { blocking: false, sceneId: shot.sceneId, shotId: shot.id }
        ));
      }
    }

    const motion = motionByShot.get(shot.id);
    const motionReady = Boolean(motion && motion.status === 'ready' && fileDigest(motion.outputPath));
    if (!motionReady) {
      motionSegmentFailures += 1;
      score -= 18;
      findings.push(qualityFinding(
        'cartoon_motion_segment_missing', 'CRITICAL',
        `Shot ${Number(shot.shotIndex || 0) + 1} has no ready local motion segment.`,
        'Run Phase 11.5 for this shot after all three keyframes pass continuity.',
        { blocking: true, sceneId: shot.sceneId, shotId: shot.id }
      ));
    } else {
      const shotDuration = Number(shot.duration || 0);
      const motionDuration = Number(motion.duration || 0);
      if (shotDuration > 0 && Math.abs(shotDuration - motionDuration) > Math.max(0.25, shotDuration * 0.04)) {
        durationMismatches += 1;
        score -= 6;
        findings.push(qualityFinding(
          'cartoon_motion_duration_mismatch', 'MEDIUM',
          `Shot ${Number(shot.shotIndex || 0) + 1} motion duration ${motionDuration.toFixed(2)}s does not match planned ${shotDuration.toFixed(2)}s.`,
          'Re-render the shot motion with the persisted shot duration.',
          { blocking: false, sceneId: shot.sceneId, shotId: shot.id }
        ));
      }
    }
  }

  const allDigests = [...digestCounts.entries()];
  const totalReadableFrames = allDigests.reduce((sum, [, count]) => sum + count, 0);
  const duplicateFrames = allDigests.reduce((sum, [, count]) => sum + Math.max(0, count - 1), 0);
  const duplicateRatio = totalReadableFrames ? duplicateFrames / totalReadableFrames : 0;
  if (duplicateRatio > 0.20) {
    score -= 20;
    findings.push(qualityFinding(
      'cartoon_repetition_risk', 'HIGH',
      `${Math.round(duplicateRatio * 100)}% of readable keyframes are exact byte duplicates across the production.`,
      'Regenerate repeated frames so different story beats receive distinct visual states.',
      { blocking: true, evidence: { duplicateFrames, totalReadableFrames, duplicateRatio: Number(duplicateRatio.toFixed(4)) } }
    ));
  } else if (duplicateRatio > 0.08) {
    score -= 8;
    findings.push(qualityFinding(
      'cartoon_repetition_advisory', 'MEDIUM',
      `${Math.round(duplicateRatio * 100)}% of readable keyframes are exact duplicates.`,
      'Review repeated frames and keep only intentional holds.',
      { blocking: false, evidence: { duplicateFrames, totalReadableFrames, duplicateRatio: Number(duplicateRatio.toFixed(4)) } }
    ));
  }

  const genericRisks = visualBriefs
    .map(brief => Number(brief.quality?.genericAiRisk))
    .filter(Number.isFinite);
  const averageGenericAiRisk = genericRisks.length
    ? genericRisks.reduce((sum, value) => sum + value, 0) / genericRisks.length
    : null;
  if (averageGenericAiRisk !== null && averageGenericAiRisk >= 65) {
    score -= 20;
    findings.push(qualityFinding(
      'cartoon_generic_visual_risk', 'HIGH',
      `Average Visual Director Generic-AI risk is ${Math.round(averageGenericAiRisk)}/100 for the cartoon.`,
      'Rewrite weak scene/shot prompts around named characters, one concrete action, camera framing, and stable location details.',
      { blocking: true }
    ));
  }

  const storyText = clean(shots.map(shot => `${shot.storyBeat || ''} ${shot.action || ''}`).join(' '), 50000).toLowerCase();
  const unsafeTerms = [...new Set((storyText.match(/\b(?:blood|gore|gun|firearm|knife|weapon|murder|kill|torture|corpse|nudity|nude|sexual|cocaine|heroin|methamphetamine)\b/g) || []))];
  if (unsafeTerms.length) {
    score -= 35;
    findings.push(qualityFinding(
      'cartoon_child_safety_lexical', 'CRITICAL',
      `Child-directed cartoon story beats contain high-risk terms requiring manual review: ${unsafeTerms.join(', ')}.`,
      'Rewrite or explicitly review the affected story beats before approval. This deterministic lexical check is conservative and is not a full semantic safety classifier.',
      { blocking: true, evidence: unsafeTerms }
    ));
  }

  const averageContinuityScore = continuityScoreCount ? continuityScoreTotal / continuityScoreCount : null;
  const averageCompositionContinuity = compositionScoreCount ? compositionScoreTotal / compositionScoreCount : null;
  const blockers = findings.filter(item => item.blocking);
  const finalScore = clampScore(score);
  const status = blockers.length ? 'blocked' : (finalScore < 85 || findings.some(item => ['HIGH', 'MEDIUM'].includes(item.severity)) ? 'warning' : 'passed');
  const metrics = {
    sceneCount: scenes.length,
    shotCount: shots.length,
    keyframeCount: keyframes.length,
    continuityCheckCount: continuityChecks.length,
    motionSegmentCount: motionSegments.length,
    motionSceneCount: motionScenes.length,
    shotCountViolations,
    promptContractViolations,
    keyframeContractViolations,
    keyframeAssetFailures,
    continuityMissing,
    continuityRejected,
    motionSegmentFailures,
    motionSceneFailures,
    sceneMotionBindingFailures,
    staticShots,
    partiallyStaticShots,
    durationMismatches,
    duplicateFrames,
    totalReadableFrames,
    duplicateRatio: Number(duplicateRatio.toFixed(4)),
    averageContinuityScore: averageContinuityScore === null ? null : Number(averageContinuityScore.toFixed(4)),
    averageCompositionContinuity: averageCompositionContinuity === null ? null : Number(averageCompositionContinuity.toFixed(4)),
    acceptedContinuityCount,
    referenceConditionedAccepted,
    referenceConditioningRate: acceptedContinuityCount ? Number((referenceConditionedAccepted / acceptedContinuityCount).toFixed(4)) : null,
    averageGenericAiRisk: averageGenericAiRisk === null ? null : Number(averageGenericAiRisk.toFixed(2)),
    childSafetyLexicalHits: unsafeTerms
  };

  const fingerprint = hash(JSON.stringify({
    version: VERSION,
    productionId: production.id || null,
    bibleFingerprint: bible.fingerprint || null,
    scenes: scenes.map(scene => ({ id: scene.id, revision: scene.revision, status: scene.status, assetPath: scene.assetPath, provider: scene.provider })),
    shots: shots.map(shot => ({ id: shot.id, fingerprint: shot.fingerprint, status: shot.status, duration: shot.duration })),
    keyframes: keyframes.map(frame => ({ id: frame.id, fingerprint: frame.fingerprint, status: frame.status, assetPath: frame.assetPath, generatedAt: frame.generatedAt })),
    continuity: [...latestContinuity.entries()].map(([id, check]) => ({ id, attempt: check.attempt, score: check.score, threshold: check.threshold, status: check.status })),
    motionSegments: motionSegments.map(item => ({ shotId: item.shotId, fingerprint: item.fingerprint, status: item.status, outputPath: item.outputPath })),
    motionScenes: motionScenes.map(item => ({ sceneId: item.sceneId, fingerprint: item.fingerprint, status: item.status, outputPath: item.outputPath })),
    keyframeAssetDigests: allDigests.slice().sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  }));

  return {
    version: VERSION,
    active: true,
    productionId: production.id || null,
    fingerprint,
    status,
    passed: blockers.length === 0,
    score: finalScore,
    findings,
    blockers,
    metrics,
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  CARTOON_QUALITY_GATE_VERSION: VERSION,
  CARTOON_QUALITY_KEYFRAME_ROLES: KEYFRAME_ROLES,
  evaluateCartoonQualityV11,
  latestContinuityByKeyframe,
  fileDigest,
  isCartoonProduction
};
