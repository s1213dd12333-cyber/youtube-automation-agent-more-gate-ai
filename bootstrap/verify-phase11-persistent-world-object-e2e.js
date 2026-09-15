'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),up=path.join(root,'upstream'),u=n=>path.join(up,'utils',n);
for(const n of ['persistent-world-object-registry-v11.js','persistent-world-object-resolver-v11.js','canonical-world-object-assets-v11.js','persistent-world-object-state-v11.js','persistent-world-object-binding-v11.js','cross-video-object-continuity-gate-v11.js','persistent-world-object-library-manager-v11.js'])if(!fs.existsSync(u(n)))throw new Error(`11.10.8 prerequisite missing: ${n}`);
const {PersistentWorldObjectRegistryV11,PERSISTENT_WORLD_OBJECT_VERSION}=require(u('persistent-world-object-registry-v11.js'));
const {PERSISTENT_WORLD_OBJECT_RESOLVER_VERSION}=require(u('persistent-world-object-resolver-v11.js'));
const {CanonicalWorldObjectAssetRegistryV11,CANONICAL_WORLD_OBJECT_ASSETS_VERSION}=require(u('canonical-world-object-assets-v11.js'));
const {PersistentWorldObjectStateLayerV11,PERSISTENT_WORLD_OBJECT_STATE_VERSION}=require(u('persistent-world-object-state-v11.js'));
const {PersistentWorldObjectBindingV11,PERSISTENT_WORLD_OBJECT_BINDING_VERSION}=require(u('persistent-world-object-binding-v11.js'));
const {CrossVideoObjectContinuityGateV11,CROSS_VIDEO_OBJECT_CONTINUITY_VERSION}=require(u('cross-video-object-continuity-gate-v11.js'));
const {PersistentWorldObjectLibraryManagerV11,PERSISTENT_WORLD_OBJECT_LIBRARY_VERSION}=require(u('persistent-world-object-library-manager-v11.js'));
const {MemoryObjectDb}=require('./e2e/object-system-memory-db');
const {locationBinding,shotPlan,environment,car,createFixtureFiles}=require('./e2e/object-system-fixtures');
let checks=0;const ok=(n,f)=>{try{f();checks++}catch(e){e.message=`${n}: ${e.message}`;throw e}};
async function main(){
for(const [a,b] of [[PERSISTENT_WORLD_OBJECT_VERSION,'11.10.1'],[PERSISTENT_WORLD_OBJECT_RESOLVER_VERSION,'11.10.2'],[CANONICAL_WORLD_OBJECT_ASSETS_VERSION,'11.10.3'],[PERSISTENT_WORLD_OBJECT_STATE_VERSION,'11.10.4'],[PERSISTENT_WORLD_OBJECT_BINDING_VERSION,'11.10.5'],[CROSS_VIDEO_OBJECT_CONTINUITY_VERSION,'11.10.6'],[PERSISTENT_WORLD_OBJECT_LIBRARY_VERSION,'11.10.7']])ok(`runtime ${b}`,()=>assert.strictEqual(a,b));
const pkg=JSON.parse(fs.readFileSync(path.join(up,'package.json'),'utf8'));ok('e2e npm script',()=>assert.strictEqual(pkg.scripts['test:persistent-world-object:e2e'],'node ../bootstrap/verify-phase11-persistent-world-object-e2e.js'));ok('full script includes e2e',()=>assert((pkg.scripts['test:persistent-world-object:full']||'').includes('test:persistent-world-object:e2e')));
const db=new MemoryObjectDb(),fx=await createFixtureFiles(),F=fx.files;
const registry=new PersistentWorldObjectRegistryV11(db,{enabled:true,namespace:'series'}),assets=new CanonicalWorldObjectAssetRegistryV11(db,{enabled:true,requireProvider:true,dataRoot:fx.dataRoot}),states=new PersistentWorldObjectStateLayerV11(db,{enabled:true,inheritDurable:true}),binder=new PersistentWorldObjectBindingV11(db,{enabled:true,requireExplicit:true}),manager=new PersistentWorldObjectLibraryManagerV11(db,{enabled:true,operatorControls:true,allowAlias:true,allowLink:true});
const analyzer=async({candidatePath})=>String(candidatePath).includes('replacement')?{objectPresent:true,sameCanonicalObject:false,canonicalIdentityConsistent:false,stateConsistent:true,confidence:.99,identityMismatches:['different body silhouette'],notes:'replacement'}:{objectPresent:true,sameCanonicalObject:true,canonicalIdentityConsistent:true,stateConsistent:true,confidence:.97,identityMismatches:[],notes:'same object'};
const gate=new CrossVideoObjectContinuityGateV11(db,{enabled:true,requireCanonicalAsset:true,requireVision:true,minConfidence:.72,analyzer});
const bind=(id,ref,visibility,statePlan,objectPlan,bible,assetList)=>binder.bindShotPlan({production:{id},scenes:[{id:`scene_${id}`,position:1,objectBindings:[{reference:ref,visibility}]}],shotPlan:shotPlan(`scene_${id}`,`shot_${id}`),environmentBible:bible,objectPlan,statePlan,assetPlan:{assets:assetList}});
const evalGate=(id,file)=>gate.evaluate({productionId:id,sceneId:`scene_${id}`,keyframe:{id:`kf_${id}`,shotId:`shot_${id}`},assetPath:file});

const A={id:'A'},aDecl=car({id:'a',objectKey:'miller_family_car',aliases:['family car','Carro da Família Miller'],canonicalAsset:{path:F.carCanonical,provider:'fixture-vision',model:'v1',canonical:true}}),aBible={environments:[environment('env_A',[aDecl])]},aPlan=await registry.ensureProductionObjects(A,aBible,[],[locationBinding('env_A','miller_house')],[]),obj=aPlan.objects[0].object,oid=obj.id,fp=obj.identityFingerprint;
ok('A registers',()=>assert.strictEqual(aPlan.summary.registered,1));ok('A key',()=>assert.strictEqual(obj.objectKey,'miller_family_car'));ok('A aliases seeded',()=>assert(db.aliases.some(x=>x.aliasKey==='family car')&&db.aliases.some(x=>x.aliasKey==='carro da familia miller')));
const aAssets=await assets.ensureProductionAssets(A,aBible,[],aPlan),anchor=(await db.listPersistentWorldObjectAssets(oid))[0],sha=anchor.assetSha256;ok('A canonical ready',()=>assert(aAssets.summary.ready===1&&anchor.sourceProductionId==='A'&&fs.existsSync(anchor.assetPath)));
await bind('A','miller_family_car','visible',{states:[]},aPlan,aBible,[anchor]);const ga=await evalGate('A',F.carFrameB);ok('A origin audit',()=>assert(ga.accepted&&ga.checks[0].result.status==='origin_production'));

const B={id:'B'},bDecl=car({id:'b',name:'family car',canonicalAsset:{path:F.carAlternative,provider:'fixture-vision',model:'v2',canonical:true}});delete bDecl.objectKey;const bBible={environments:[environment('env_B',[bDecl],{objectStates:[{objectKey:'miller_family_car',sceneId:'scene_B',damage:['rear dent'],statePersistence:'until_changed'}]})]},bPlan=await registry.ensureProductionObjects(B,bBible,[],[locationBinding('env_B','miller_house')],[]);
ok('B alias reuse',()=>assert(bPlan.objects[0].object.id===oid&&bPlan.objects[0].matchMode==='object_alias_exact'));const bAssets=await assets.ensureProductionAssets(B,bBible,[],bPlan),anchorB=(await db.listPersistentWorldObjectAssets(oid))[0];ok('B anchor immutable',()=>assert(bAssets.summary.reused>=1&&anchorB.assetSha256===sha&&anchorB.sourceProductionId==='A'));
const bStates=await states.ensureProductionStates(B,bBible,[],bPlan),sb=bStates.states[0];ok('B durable damage',()=>assert(sb.status==='active'&&sb.persistence==='until_changed'&&sb.damage.includes('rear dent')));const bb=await bind('B','family car','visible',bStates,bPlan,bBible,[anchorB]);ok('B visible binding carries state/asset',()=>assert(bb.summary.visible===1&&bb.bindings[0].stateFingerprint===sb.stateFingerprint&&bb.bindings[0].canonicalAssetSha256===sha));const gb=await evalGate('B',F.carFrameB);ok('B cross-video pass',()=>assert(gb.accepted&&gb.checks[0].result.reusedAcrossVideos&&gb.checks[0].result.canonicalIdentityConsistent));

const C={id:'C'},cDecl=car({id:'c',objectKey:'miller_family_car'});delete cDecl.canonicalAsset;const cBible={environments:[environment('env_C',[cDecl])]},cPlan=await registry.ensureProductionObjects(C,cBible,[],[locationBinding('env_C','jones_house')],[]);ok('C same object moves location',()=>assert(cPlan.objects[0].object.id===oid&&db.usages.some(x=>x.productionId==='C'&&x.locationId==='jones_house')));ok('C canonical location unchanged',()=>assert.strictEqual(cPlan.objects[0].object.canonicalLocationId,'miller_house'));const cStates=await states.ensureProductionStates(C,cBible,[],cPlan),sc=cStates.states[0];ok('C inherits durable damage',()=>assert(sc.inherited&&sc.damage.includes('rear dent')&&sc.parentStateId===sb.id));await bind('C','miller_family_car','occluded',cStates,cPlan,cBible,[anchor]);const gc=await evalGate('C',F.carFrameC);ok('C moved object passes gate',()=>assert(gc.accepted));

const D={id:'D'},dDecl=car({id:'d',objectKey:'jones_family_car',name:'Jones Family Car',color:'blue',distinguishingMarks:['black roof rack'],aliases:['Jones car'],canonicalAsset:{path:F.jonesCarCanonical,provider:'fixture-vision',model:'v1',canonical:true}}),dBible={environments:[environment('env_D',[dDecl])]},dPlan=await registry.ensureProductionObjects(D,dBible,[],[locationBinding('env_D','jones_house')],[]),objD=dPlan.objects[0].object;ok('D second car distinct',()=>assert(objD.id!==oid&&db.objects.length===2));const dAssets=await assets.ensureProductionAssets(D,dBible,[],dPlan);ok('D separate anchor',()=>assert.strictEqual(dAssets.summary.ready,1));

const E={id:'E'},eBible={environments:[environment('env_E',[{id:'e',name:'their car',objectType:'vehicle'}])]},ePlan=await registry.ensureProductionObjects(E,eBible,[],[locationBinding('env_E','neutral')],[]),re=db.resolutions.find(x=>x.productionId==='E'&&x.status==='ambiguous');ok('E ambiguous fail closed',()=>assert(ePlan.objects[0].status==='ambiguous'&&db.objects.length===2&&re.candidateObjectIds.length===2));const link=await manager.linkResolution({resolutionId:re.id,objectId:oid,persistAlias:true,actor:'e2e'});ok('E operator link applied',()=>assert(link.status==='applied'&&link.resolution.matchMode==='operator_explicit_link'&&link.resolution.confidence===1));ok('E operator alias persisted/audited',()=>assert(db.aliases.some(x=>x.objectId===oid&&x.aliasKey==='their car')&&db.actions.some(x=>x.actionType==='link_resolution'&&x.status==='applied')));const collision=await manager.addAlias({objectId:objD.id,aliasText:'their car',actor:'e2e'});ok('E alias collision blocked',()=>assert(collision.status==='conflict'&&collision.conflictingObjectIds.includes(oid)));

const FP={id:'F'},fBible={environments:[environment('env_F',[{id:'f',name:'their car',objectType:'vehicle'}],{objectStates:[{objectKey:'miller_family_car',sceneId:'scene_F',clearState:true,statePersistence:'until_changed'}]})]},fPlan=await registry.ensureProductionObjects(FP,fBible,[],[locationBinding('env_F','store')],[]);ok('F corrected alias reuses',()=>assert(fPlan.objects[0].object.id===oid&&fPlan.objects[0].matchMode==='object_alias_exact'));const fStates=await states.ensureProductionStates(FP,fBible,[],fPlan),sf=fStates.states[0];ok('F durable reset neutral',()=>assert(sf.status==='neutral'&&sf.persistence==='until_changed'&&sf.damage.length===0));const fb=await bind('F','their car','offscreen',fStates,fPlan,fBible,[anchor]);ok('F offscreen nonvisual',()=>assert(fb.summary.nonvisual===1&&fb.bindings[0].promptFragment.includes('Do NOT render')));const gf=await evalGate('F',F.offscreenFrame);ok('F excluded from visual gate',()=>assert(gf.accepted&&gf.status==='no_visible_object_bindings'&&gf.checks.length===0));

const G={id:'G'},gBible={environments:[environment('env_G',[{id:'g',name:'their car',objectType:'vehicle'}])]},gPlan=await registry.ensureProductionObjects(G,gBible,[],[locationBinding('env_G','miller_house')],[]),gStates=await states.ensureProductionStates(G,gBible,[],gPlan),sg=gStates.states[0];ok('G neutral reset inherited',()=>assert(gPlan.objects[0].object.id===oid&&sg.inherited&&sg.status==='neutral'&&sg.damage.length===0));await bind('G','their car','visible',gStates,gPlan,gBible,[anchor]);const gg=await evalGate('G',F.carReplacement);ok('G replacement blocked',()=>assert(!gg.accepted&&gg.reasons.includes('CROSS_VIDEO_OBJECT_REPLACED')&&gg.reasons.includes('CROSS_VIDEO_OBJECT_IDENTITY_DRIFT')));ok('G mismatch persisted',()=>assert(db.cross.some(x=>x.productionId==='G'&&(x.identityMismatches||[]).length)));

const H={id:'H'},hDecl=car({id:'h',objectKey:'miller_family_car',color:'blue'});delete hDecl.canonicalAsset;const hPlan=await registry.ensureProductionObjects(H,{environments:[environment('env_H',[hDecl])]},[],[locationBinding('env_H','miller_house')],[]);ok('H identity conflict blocked',()=>assert(hPlan.objects[0].conflict&&hPlan.objects[0].object===null&&db.objects.length===2));const finalObj=await db.getPersistentWorldObject(oid),finalAsset=(await db.listPersistentWorldObjectAssets(oid))[0];ok('canonical identity immutable',()=>assert(finalObj.identityFingerprint===fp&&finalObj.canonicalIdentity.color==='red'));ok('canonical asset immutable',()=>assert(finalAsset.assetSha256===sha&&finalAsset.sourceProductionId==='A'));

const detail=await manager.detail(oid),snap=await manager.getSnapshot('series');ok('UI exposes aliases/assets/states',()=>assert(detail.aliases.some(x=>x.aliasKey==='their car')&&detail.assets.some(x=>x.assetSha256===sha)&&detail.states.some(x=>x.productionId==='B'&&x.status==='active')&&detail.states.some(x=>x.productionId==='F'&&x.status==='neutral')));ok('UI exposes bindings/gates/audit',()=>assert(detail.bindings.some(x=>x.productionId==='B'&&x.visibility==='visible')&&detail.bindings.some(x=>x.productionId==='F'&&x.visibility==='offscreen')&&detail.continuityChecks.some(x=>x.productionId==='G'&&!x.accepted)&&detail.operatorActions.some(x=>x.actionType==='link_resolution')));ok('snapshot correct',()=>assert(snap.summary.objectCount===2&&snap.summary.crossVideoObjects>=1&&snap.summary.blockedContinuity>=1));ok('usage spans five productions',()=>assert((db.usages.filter(x=>x.objectId===oid)).length>=5));ok('resolver audits automated and operator reuse',()=>assert(db.resolutions.some(x=>x.matchMode==='object_alias_exact')&&db.resolutions.some(x=>x.matchMode==='operator_explicit_link')));ok('gate audit has origin/pass/block',()=>assert(db.cross.some(x=>x.status==='origin_production')&&db.cross.some(x=>x.productionId==='B'&&x.accepted)&&db.cross.some(x=>x.productionId==='G'&&!x.accepted)));

ok('A namespace stable',()=>assert.strictEqual(obj.namespace,'series'));
ok('A type stable',()=>assert.strictEqual(obj.objectType,'vehicle'));
ok('A explicit-key scope',()=>assert.strictEqual(obj.canonicalIdentity.scopeKind,'explicit_object_key'));
ok('A scope anchor stable',()=>assert.strictEqual(obj.canonicalIdentity.scopeAnchor,'miller family car'));
ok('A brand stable',()=>assert.strictEqual(obj.canonicalIdentity.brand,'orion'));
ok('A model stable',()=>assert.strictEqual(obj.canonicalIdentity.model,'estate'));
ok('A material stable',()=>assert.strictEqual(obj.canonicalIdentity.material,'metal'));
ok('A canonical sha is sha256',()=>assert.strictEqual(sha.length,64));
ok('B usage is alias reuse',()=>assert(db.usages.some(x=>x.productionId==='B'&&x.objectId===oid&&x.matchMode==='object_alias_exact')));
ok('B resolver audit is alias exact',()=>assert(db.resolutions.some(x=>x.productionId==='B'&&x.objectId===oid&&x.matchMode==='object_alias_exact')));
ok('B state carries canonical fingerprint',()=>assert.strictEqual(sb.canonicalIdentityFingerprint,fp));
ok('B binding visibility visible',()=>assert.strictEqual(bb.bindings[0].visibility,'visible'));
ok('B binding object id stable',()=>assert.strictEqual(bb.bindings[0].objectId,oid));
ok('B gate sees object',()=>assert.strictEqual(gb.checks[0].result.objectPresent,true));
ok('B gate sees same canonical object',()=>assert.strictEqual(gb.checks[0].result.sameCanonicalObject,true));
ok('B gate confidence clears threshold',()=>assert(gb.checks[0].result.visionConfidence>=.72));
ok('C usage persisted',()=>assert(db.usages.some(x=>x.productionId==='C'&&x.objectId===oid)));
ok('C inherited state stays durable',()=>assert.strictEqual(sc.persistence,'until_changed'));
ok('C inherited source kind recorded',()=>assert.strictEqual(sc.sourceKind,'inherited_durable_state'));
ok('C gate has no blocked checks',()=>assert.strictEqual(gc.summary.blocked,0));
ok('D canonical color blue',()=>assert.strictEqual(objD.canonicalIdentity.color,'blue'));
ok('D origin production recorded',()=>assert.strictEqual(objD.createdFromProductionId,'D'));
ok('D alias seeded',()=>assert(db.aliases.some(x=>x.objectId===objD.id&&x.aliasKey==='jones car')));
ok('D asset provenance recorded',()=>assert(db.assets.some(x=>x.objectId===objD.id&&x.sourceProductionId==='D'));
ok('E ambiguity mode is contextual',()=>assert.strictEqual(re.matchMode,'object_context_ambiguous'));
ok('E ambiguity reason is multiple candidates',()=>assert.strictEqual(re.reason,'multiple_compatible_generic_candidates'));
ok('E operator link targets Miller',()=>assert.strictEqual(link.resolution.objectId,oid));
ok('E collision rejection audited',()=>assert(db.actions.some(x=>x.actionType==='add_alias'&&x.status==='rejected')));
ok('F resolver audit is alias exact',()=>assert(db.resolutions.some(x=>x.productionId==='F'&&x.matchMode==='object_alias_exact')));
ok('F reset has new state fingerprint',()=>assert.notStrictEqual(sf.stateFingerprint,sb.stateFingerprint));
ok('F binding visibility offscreen',()=>assert.strictEqual(fb.bindings[0].visibility,'offscreen'));
ok('F visual gate has no reasons',()=>assert.strictEqual(gf.reasons.length,0));
ok('G resolver audit is alias exact',()=>assert(db.resolutions.some(x=>x.productionId==='G'&&x.matchMode==='object_alias_exact')));
ok('G neutral inherits reset parent',()=>assert.strictEqual(sg.parentStateId,sf.id));
ok('G gate status blocked',()=>assert.strictEqual(gg.status,'blocked'));
ok('G replacement flag false',()=>assert.strictEqual(gg.checks[0].result.sameCanonicalObject,false));
ok('G canonical identity flag false',()=>assert.strictEqual(gg.checks[0].result.canonicalIdentityConsistent,false));
ok('G high-confidence mismatch recorded',()=>assert(gg.checks[0].result.visionConfidence>=.99));
ok('H conflict reason names canonical color',()=>assert(String(hPlan.objects[0].reason).includes('canonical_attribute_mismatch:color')));
ok('H conflicting fingerprint differs',()=>assert.notStrictEqual(hPlan.objects[0].candidateFingerprint,fp));
ok('final object origin remains A',()=>assert.strictEqual(finalObj.createdFromProductionId,'A'));
ok('final asset provider remains origin provider',()=>assert.strictEqual(finalAsset.provider,'fixture-vision'));
ok('UI detail usage count spans videos',()=>assert(detail.usageCount>=5));
ok('UI detail production count spans videos',()=>assert(detail.productionCount>=5));
ok('UI latest continuity is blocked',()=>assert(detail.latestContinuity&&detail.latestContinuity.accepted===false));
ok('UI snapshot has two canonical anchors',()=>assert.strictEqual(snap.summary.canonicalReady,2));
ok('UI snapshot has operator audit actions',()=>assert(snap.summary.operatorActions>=2));
ok('UI snapshot has no pending ambiguity after correction',()=>assert.strictEqual(snap.summary.pendingResolutions,0));
console.log(`Phase 11.10.8 Persistent World Object E2E OK: ${checks} regression checks passed across 8 productions.`)}
main().catch(e=>{console.error(e.stack||e.message||e);process.exit(1)});
