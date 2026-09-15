'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const upstream = path.resolve(__dirname, '..', 'upstream');
const runtimePath = path.join(upstream, 'utils', 'cross-video-character-continuity-gate-v11.js');
if (!fs.existsSync(runtimePath)) throw new Error('Phase 11.11.6 runtime is not materialized');
const { CROSS_VIDEO_CHARACTER_CONTINUITY_VERSION, CrossVideoCharacterContinuityGateV11, visibleCharacterBindings, appearanceStateSummary, buildCharacterContinuityPrompt, normalizeCharacterVisionResponse, characterVisionDecision, extractJson, mimeForPath } = require(runtimePath);
let count = 0; const check = (name, fn) => { fn(); count += 1; };

check('version', () => assert.strictEqual(CROSS_VIDEO_CHARACTER_CONTINUITY_VERSION, '11.11.6'));
for (const [vis, n] of [['visible',1],['occluded',1],['offscreen',0],['mentioned',0]]) check(`visibility ${vis}`, () => assert.strictEqual(visibleCharacterBindings([{status:'resolved',characterId:'c',visibility:vis}]).length,n));
check('conflict excluded', () => assert.strictEqual(visibleCharacterBindings([{status:'conflict',characterId:'c',visibility:'visible'}]).length,0));
check('missing id excluded', () => assert.strictEqual(visibleCharacterBindings([{status:'resolved',visibility:'visible'}]).length,0));
check('wardrobe state active', () => assert(appearanceStateSummary({status:'active',wardrobe:'raincoat'}).appearanceChangeExpected));
check('injury state active', () => assert(appearanceStateSummary({status:'active',injuries:['bandage']}).summary.includes('bandage')));
check('neutral state', () => assert.strictEqual(appearanceStateSummary({status:'neutral'}).appearanceChangeExpected,false));

const prompt = buildCharacterContinuityPrompt({ character:{id:'c',characterKey:'luna',displayName:'Luna',speciesType:'rabbit',canonicalIdentity:{palette:['cream','gold'],proportions:'small rabbit',face:'large brown eyes',shapeLanguage:'round ears',outfit:'blue dress',markings:['gold ear tip']}}, binding:{visibility:'visible',placement:'foreground',action:'wave',expression:'happy'}, state:{status:'active',wardrobe:'yellow raincoat'}, canonicalAsset:{assetSha256:'sha'} });
for (const token of ['IMAGE 1','IMAGE 2','CHARACTER ID: c','CANONICAL FACE: large brown eyes','cream / gold','wardrobe=yellow raincoat','Base outfit may be visually replaced only','"sameCanonicalCharacter"']) check(`prompt ${token}`, () => assert(prompt.includes(token)));

const good = normalizeCharacterVisionResponse({characterPresent:true,sameCanonicalCharacter:true,canonicalIdentityConsistent:true,appearanceStateConsistent:true,confidence:.93,identityMismatches:[]});
check('good contract', () => assert(good.contractValid && good.verified));
check('bad contract', () => assert.strictEqual(normalizeCharacterVisionResponse({characterPresent:true}).contractValid,false));
check('mismatch hardens true flag', () => assert.strictEqual(normalizeCharacterVisionResponse({characterPresent:true,sameCanonicalCharacter:true,canonicalIdentityConsistent:true,appearanceStateConsistent:true,confidence:.95,identityMismatches:['different eyes']}).canonicalIdentityConsistent,false));
const decide = payload => characterVisionDecision(normalizeCharacterVisionResponse(payload), {requireVision:false,requiredBinding:true,minConfidence:.72});
check('missing blocks', () => assert(decide({characterPresent:false,sameCanonicalCharacter:true,canonicalIdentityConsistent:true,appearanceStateConsistent:null,confidence:.9,identityMismatches:[]}).reasons.includes('CROSS_VIDEO_CHARACTER_MISSING')));
check('replacement blocks', () => assert(decide({characterPresent:true,sameCanonicalCharacter:false,canonicalIdentityConsistent:false,appearanceStateConsistent:true,confidence:.9,identityMismatches:['different face']}).reasons.includes('CROSS_VIDEO_CHARACTER_REPLACED')));
check('identity drift blocks', () => assert(decide({characterPresent:true,sameCanonicalCharacter:true,canonicalIdentityConsistent:false,appearanceStateConsistent:true,confidence:.9,identityMismatches:['different eyes']}).reasons.includes('CROSS_VIDEO_CHARACTER_IDENTITY_DRIFT')));
check('appearance drift blocks', () => assert(decide({characterPresent:true,sameCanonicalCharacter:true,canonicalIdentityConsistent:true,appearanceStateConsistent:false,confidence:.9,identityMismatches:[]}).reasons.includes('CROSS_VIDEO_CHARACTER_APPEARANCE_STATE_DRIFT')));
check('low confidence nonstrict accepted', () => assert(characterVisionDecision(normalizeCharacterVisionResponse({characterPresent:true,sameCanonicalCharacter:true,canonicalIdentityConsistent:true,appearanceStateConsistent:true,confidence:.51,identityMismatches:[]}), {requireVision:false,minConfidence:.72}).accepted));
check('missing vision strict blocks', () => assert(!characterVisionDecision(null,{requireVision:true}).accepted));
check('json fenced', () => assert.strictEqual(extractJson('```json\n{"a":1}\n```').a,1));
check('mime webp', () => assert.strictEqual(mimeForPath('a.webp'),'image/webp'));

const dbSource=fs.readFileSync(path.join(upstream,'database','db.js'),'utf8');
const pipelineSource=fs.readFileSync(path.join(upstream,'utils','scene-pipeline-v2.js'),'utf8');
const keyframeSource=fs.readFileSync(path.join(upstream,'utils','cartoon-keyframe-pipeline-v11.js'),'utf8');
const dashboardSource=fs.readFileSync(path.join(upstream,'dashboard','app.js'),'utf8');
const envSource=fs.readFileSync(path.join(upstream,'.env.example'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(upstream,'package.json'),'utf8'));
const tokens=[
 ['db table',dbSource,'CREATE TABLE IF NOT EXISTS cross_video_character_continuity_checks'],
 ['binding fk',dbSource,'FOREIGN KEY (binding_id) REFERENCES persistent_character_bindings(id) ON DELETE SET NULL'],
 ['character fk',dbSource,'FOREIGN KEY (character_id) REFERENCES persistent_characters(id) ON DELETE SET NULL'],
 ['asset fk',dbSource,'FOREIGN KEY (canonical_asset_id) REFERENCES persistent_character_assets(id) ON DELETE SET NULL'],
 ['state fk',dbSource,'FOREIGN KEY (state_id) REFERENCES persistent_character_appearance_states(id) ON DELETE SET NULL'],
 ['save method',dbSource,'async saveCrossVideoCharacterContinuityCheck(input = {})'],
 ['list method',dbSource,'async listCrossVideoCharacterContinuityChecks(productionId)'],
 ['bundle load',dbSource,'const crossVideoCharacterContinuityChecks = await this.listCrossVideoCharacterContinuityChecks(productionId);'],
 ['bundle expose',dbSource,'crossVideoCharacterContinuityChecks,'],
 ['pipeline import',pipelineSource,"CrossVideoCharacterContinuityGateV11 } = require('./cross-video-character-continuity-gate-v11')"],
 ['pipeline construct',pipelineSource,'this.crossVideoCharacterContinuityGate = options.crossVideoCharacterContinuityGate || new CrossVideoCharacterContinuityGateV11'],
 ['pipeline pass',pipelineSource,'crossVideoCharacterContinuityGate: this.crossVideoCharacterContinuityGate'],
 ['keyframe option',keyframeSource,'this.crossVideoCharacterContinuityGate = options.crossVideoCharacterContinuityGate || null;'],
 ['keyframe evaluate',keyframeSource,'this.crossVideoCharacterContinuityGate.evaluate({ productionId, sceneId, keyframe: current, assetPath, attempt: 0 })'],
 ['keyframe failure status',keyframeSource,"status: 'cross_video_character_continuity_failed'"],
 ['error code',keyframeSource,"crossVideoCharacterError.code = 'CROSS_VIDEO_CHARACTER_CONTINUITY_FAILED'"],
 ['dashboard',dashboardSource,'CROSS-VIDEO CHARACTER CONTINUITY GATE V11.11.6'],
 ['env enabled',envSource,'CROSS_VIDEO_CHARACTER_CONTINUITY_ENABLED=true'],
 ['env asset strict',envSource,'CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_CANONICAL_ASSET=true'],
 ['env vision nonstrict',envSource,'CROSS_VIDEO_CHARACTER_CONTINUITY_REQUIRE_VISION=false'],
 ['env confidence',envSource,'CROSS_VIDEO_CHARACTER_CONTINUITY_MIN_CONFIDENCE=0.72']
];
for (const [name,source,token] of tokens) check(name,()=>assert(source.includes(token)));
check('package script',()=>assert.strictEqual(pkg.scripts['test:cross-video-character-continuity'],'node ../bootstrap/verify-phase11-cross-video-character-continuity.js'));
check('location before object',()=>assert(keyframeSource.indexOf('this.crossVideoContinuityGate.evaluate')<keyframeSource.indexOf('this.crossVideoObjectContinuityGate.evaluate')));
check('object before character',()=>assert(keyframeSource.indexOf('this.crossVideoObjectContinuityGate.evaluate')<keyframeSource.indexOf('this.crossVideoCharacterContinuityGate.evaluate')));
check('character before ready',()=>assert(keyframeSource.indexOf('this.crossVideoCharacterContinuityGate.evaluate')<keyframeSource.indexOf("status: 'ready'")));

async function runtimeChecks(){
 const dir=path.join(__dirname,'.tmp-character-continuity'); fs.mkdirSync(dir,{recursive:true});
 const referencePath=path.join(dir,'reference.png'), candidatePath=path.join(dir,'candidate.png'); fs.writeFileSync(referencePath,'ref'); fs.writeFileSync(candidatePath,'candidate');
 const saved=[]; let currentBindings=[];
 const characters={origin:{id:'origin',characterKey:'origin',displayName:'Origin',createdFromProductionId:'video_b',canonicalIdentity:{}},reused:{id:'reused',characterKey:'luna',displayName:'Luna',speciesType:'rabbit',createdFromProductionId:'video_a',canonicalIdentity:{face:'eyes',palette:['cream'],shapeLanguage:'ears'}},missing:{id:'missing',characterKey:'star',displayName:'Star',createdFromProductionId:'video_a',canonicalIdentity:{}}};
 const assets={reused:{id:'asset',characterId:'reused',status:'ready',canonical:true,assetPath:referencePath,assetSha256:'sha',sourceProductionId:'video_a'}};
 const states={state:{id:'state',characterId:'reused',status:'active',wardrobe:'raincoat',stateFingerprint:'sf'}};
 const db={async listShotPersistentCharacterBindings(){return currentBindings},async getPersistentCharacter(id){return characters[id]||null},async getPersistentCharacterAsset(id){return Object.values(assets).find(a=>a.id===id)||null},async getPersistentCharacterAssetByCharacter(id){return assets[id]||null},async getPersistentCharacterAppearanceState(id){return states[id]||null},async saveCrossVideoCharacterContinuityCheck(row){saved.push({...row});return row}};
 const input={productionId:'video_b',sceneId:'scene',keyframe:{id:'kf',shotId:'shot'},assetPath:candidatePath,attempt:0};
 const goodPayload={characterPresent:true,sameCanonicalCharacter:true,canonicalIdentityConsistent:true,appearanceStateConsistent:true,confidence:.94,identityMismatches:[]};
 const gate=new CrossVideoCharacterContinuityGateV11(db,{analyzer:async()=>goodPayload,pathExists:async p=>fs.existsSync(p)});
 currentBindings=[{id:'bo',characterId:'origin',status:'resolved',visibility:'visible',required:true}]; let result=await gate.evaluate(input);
 check('origin accepted',()=>assert(result.accepted&&result.status==='origin_only')); check('origin persisted',()=>assert(saved.some(r=>r.characterId==='origin'&&r.status==='origin_production')));
 currentBindings=[{id:'br',characterId:'reused',status:'resolved',visibility:'visible',required:true,stateId:'state',stateFingerprint:'sf',canonicalAssetId:'asset'}]; result=await gate.evaluate(input);
 check('reused verified',()=>assert(result.accepted&&result.summary.verified===1)); check('state persisted',()=>assert(saved.some(r=>r.characterId==='reused'&&r.stateFingerprint==='sf'))); check('provider persisted',()=>assert(saved.some(r=>r.characterId==='reused'&&r.providerUsed)));
 const replacement=new CrossVideoCharacterContinuityGateV11(db,{analyzer:async()=>({characterPresent:true,sameCanonicalCharacter:false,canonicalIdentityConsistent:false,appearanceStateConsistent:true,confidence:.95,identityMismatches:['different face']}),pathExists:async p=>fs.existsSync(p)}); result=await replacement.evaluate(input);
 check('replacement runtime blocks',()=>assert(!result.accepted&&result.reasons.includes('CROSS_VIDEO_CHARACTER_REPLACED')));
 const stateDrift=new CrossVideoCharacterContinuityGateV11(db,{analyzer:async()=>({...goodPayload,appearanceStateConsistent:false}),pathExists:async p=>fs.existsSync(p)}); result=await stateDrift.evaluate(input);
 check('state drift runtime blocks',()=>assert(!result.accepted&&result.reasons.includes('CROSS_VIDEO_CHARACTER_APPEARANCE_STATE_DRIFT')));
 currentBindings=[{id:'bm',characterId:'missing',status:'resolved',visibility:'visible',required:true}]; result=await gate.evaluate(input);
 check('missing asset blocks',()=>assert(!result.accepted&&result.reasons.includes('CROSS_VIDEO_CHARACTER_CANONICAL_ASSET_MISSING')));
 currentBindings=[{characterId:'reused',status:'resolved',visibility:'offscreen'},{characterId:'reused',status:'resolved',visibility:'mentioned'}]; result=await gate.evaluate(input);
 check('nonvisual excluded runtime',()=>assert.strictEqual(result.status,'no_visible_character_bindings'));
 currentBindings=[{id:'br2',characterId:'reused',status:'resolved',visibility:'occluded',required:true,canonicalAssetId:'asset'}];
 const noProvider=new CrossVideoCharacterContinuityGateV11(db,{baseURL:'',model:'',requireVision:false,pathExists:async p=>fs.existsSync(p)}); result=await noProvider.evaluate(input);
 check('nonstrict provider absence accepted',()=>assert(result.accepted&&result.summary.unverified===1));
 const strict=new CrossVideoCharacterContinuityGateV11(db,{baseURL:'',model:'',requireVision:true,pathExists:async p=>fs.existsSync(p)}); result=await strict.evaluate(input);
 check('strict provider absence blocks',()=>assert(!result.accepted&&result.reasons.includes('CROSS_VIDEO_CHARACTER_VISION_REQUIRED')));
 const mismatchTrue=new CrossVideoCharacterContinuityGateV11(db,{analyzer:async()=>({...goodPayload,identityMismatches:['different eye shape']}),pathExists:async p=>fs.existsSync(p)}); result=await mismatchTrue.evaluate(input);
 check('mismatch list hardens runtime',()=>assert(!result.accepted&&result.reasons.includes('CROSS_VIDEO_CHARACTER_IDENTITY_DRIFT')));
 fs.rmSync(dir,{recursive:true,force:true});
}
runtimeChecks().then(()=>console.log(`Phase 11.11.6 Cross-Video Character Continuity Gate OK: ${count} regression checks passed.`)).catch(error=>{console.error(error.stack||error.message||error);process.exit(1)});
