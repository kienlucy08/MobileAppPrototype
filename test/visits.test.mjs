// Run: node test/visits.test.mjs — the PM feature on the server: My work visibility, status changes (idempotent, 403/409/422), claim, attach, access ending.
import assert from 'node:assert/strict';
import { ServerCore } from '../src/serverCore.js';

let passed = 0; const test = (n, fn) => { fn(); passed++; console.log(`  ✓ ${n}`); };
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const core = new ServerCore();
const U = (email) => core.state.users.find((u) => u.email === email);
const jordan = U('jordan@demo.test'), priya = U('priya@demo.test'), sam = U('sam@demo.test');

console.log('visits (PM feature)');
test('My work shows only visits assigned to me; a PM sees all; each organization is separate', () => {
  const all = core.visitsFor(jordan, {}).visits;
  assert.ok(all.length >= 6 && all.every((v) => v.assignee === 'jordan@demo.test' && v.status !== 'unassigned'));
  assert.deepEqual([...new Set(core.visitsFor(jordan, { orgId: '1001' }).visits.map((v) => v.orgId))], ['1001']);
  assert.equal(core.visitsFor(U('dana@demo.test'), {}).visits.length, 0);                  // nothing assigned: empty state
  assert.deepEqual(core.visitsFor(sam, {}).visits.map((v) => v.id).sort(), ['v1', 'v3']);      // Sam has one survey on each of two visits: those are his work
  assert.ok(core.visitsFor(priya, { orgId: '1002' }).visits.length >= 2);
});
test('start → block (reason required) → unblock → complete; history records each step', () => {
  assert.equal(core.visitStatus(jordan, 'v2', { action: 'start' }).visit.status, 'in_progress');
  assert.equal(code(() => core.visitStatus(jordan, 'v2', { action: 'block', reason: '  ' })), 'ERR-VISIT-422');
  const b = core.visitStatus(jordan, 'v2', { action: 'block', reason: 'gate locked' }).visit;
  assert.equal(b.status, 'blocked'); assert.equal(b.blockedReason, 'gate locked');
  assert.equal(core.visitStatus(jordan, 'v2', { action: 'unblock' }).visit.blockedReason, '');
  const done = core.visitStatus(jordan, 'v2', { action: 'complete' }).visit;
  assert.equal(done.status, 'complete'); assert.ok(done.history.length >= 5);
});
test('a queued change that is replayed (same key) applies once; a stale one is a 409', () => {
  const k = 'key-1';
  const a = core.visitStatus(jordan, 'v9', { action: 'start', key: k }), b = core.visitStatus(jordan, 'v9', { action: 'start', key: k });
  assert.deepEqual(a, b); assert.equal(a.visit.rev, b.visit.rev);
  assert.equal(code(() => core.visitStatus(jordan, 'v9', { action: 'start' })), 'ERR-VISIT-409');            // already started
  core.adminVisit({ id: 'v10', op: 'reassign', email: 'sam@demo.test' });                                        // PM reassigns it while Jordan is offline
  assert.equal(code(() => core.visitStatus(jordan, 'v10', { action: 'start' })), 'ERR-VISIT-403');
  assert.deepEqual(core.visitsFor(jordan, { orgId: '1002', updatedSince: 1 }).removed, ['v10']);                   // the phone drops its cached copy
});
test('someone else cannot change my visit (403)', () => {
  assert.equal(code(() => core.visitStatus(sam, 'v1', { action: 'complete' })), 'ERR-VISIT-403');
});
test('claim: first claim wins, the second gets the plain 409 message', () => {
  assert.equal(core.claim(jordan, 'v6').visit.assignee, 'jordan@demo.test');
  assert.equal(code(() => core.claim(sam, 'v6')), 'ERR-VISIT-409');
  assert.equal(core.unassignedFor(jordan, { orgId: '1001' }).some((v) => v.id === 'v6'), false);
  assert.equal(code(() => core.claim(jordan, 'v11')), null);
});
test('attach links a survey record to my visit; not to someone else’s', () => {
  assert.equal(core.attach(jordan, { visitId: 'v1', recordId: 'rec-1' }).ok, true);
  assert.equal(core.state.attached['rec-1'], 'v1');
  assert.equal(code(() => core.attach(sam, { visitId: 'v1', recordId: 'rec-2' })), 'ERR-VISIT-403');
});
test('access ends: membership is removed for one organization only', () => {
  assert.ok(core.isMember('jordan@demo.test', '1002'));
  core.setMembership({ email: 'jordan@demo.test', orgId: '1002', active: false });
  assert.ok(!core.isMember('jordan@demo.test', '1002') && core.isMember('jordan@demo.test', '1001'));
  assert.equal(core.visitsFor(jordan, { orgId: '1002' }).visits.length, 0);
});
test('a visit is a set of surveys: required and optional, with each one’s status', () => {
  core.resetVisits();                                                  // fresh visits and memberships (the access test above ended one)
  const v = core.visitsFor(jordan, { orgId: '1001' }).visits.find((x) => x.id === 'v1');
  assert.deepEqual(v.surveys.map((x) => [x.title, x.need]).slice(0, 2), [['Compound Inspection', 'required'], ['Structure Flight Inspection', 'required']]);
  assert.deepEqual(v.surveys.filter((x) => x.need === 'optional').map((x) => x.id), ['demo-guy-facilities', 'demo-plumb-twist']);
  assert.equal(v.surveys.find((x) => x.id === 'demo-compound').submitted, true);
  const cm = core.unassignedFor(jordan, { orgId: '1001' }).concat(core.visitsFor(jordan, { orgId: '1001' }).visits).find((x) => x.scope === 'CONS-MOD');
  assert.deepEqual(cm.surveys.map((x) => x.need), ['required', 'required', 'required']);     // prework, sector and ground COPs
});
test('blocking one survey needs a reason; a required block blocks the visit, an optional one does not; unblock restores it', () => {
  core.assignSurvey(jordan, 'v9', { surveyId: 'demo-guy-facilities' });                          // optional surveys are open until someone takes them
  assert.equal(code(() => core.surveyStatus(jordan, 'v9', { surveyId: 'demo-guy-facilities', action: 'block', reason: ' ' })), 'ERR-VISIT-422');
  assert.equal(core.surveyStatus(jordan, 'v9', { surveyId: 'demo-guy-facilities', action: 'block', reason: 'no climb gear' }).visit.status, 'assigned');
  const b = core.surveyStatus(jordan, 'v9', { surveyId: 'demo-compound', action: 'block', reason: 'gate locked' }).visit;
  assert.equal(b.status, 'blocked'); assert.equal(b.blockedReason, 'gate locked'); assert.equal(b.surveys.find((x) => x.id === 'demo-compound').reason, 'gate locked');
  assert.equal(core.surveyStatus(jordan, 'v9', { surveyId: 'demo-compound', action: 'unblock' }).visit.status, 'assigned');
  assert.equal(code(() => core.surveyStatus(jordan, 'v9', { surveyId: 'demo-compound', action: 'unblock' })), 'ERR-VISIT-409');
  assert.equal(code(() => core.surveyStatus(sam, 'v9', { surveyId: 'demo-compound', action: 'block', reason: 'x' })), 'ERR-VISIT-403');
});
test('the visit completes itself when the last required survey is delivered (not before, and never by a button)', () => {
  const send = (id, surveyId, visitId) => { core.begin({ id, surveyId, visitId, schemaVersion: 1, answers: { siteId: 'IA-1' }, media: [{ id: 'm', size: 1 }], user: 'x' }); const r = core.commit({ id }); assert.deepEqual(r.missing, ['m']); core.putMedia({ id, mediaId: 'm', size: 1 }); core.commit({ id }); };
  const status = () => core.visitsFor(jordan, { orgId: '1001' }).visits.find((x) => x.id === 'v1');
  assert.equal(status().status, 'in_progress');
  send('r-guy', 'demo-guy-facilities', 'v1');                       // an optional survey does not finish the visit
  assert.equal(status().status, 'in_progress'); assert.equal(status().surveys.find((x) => x.id === 'demo-guy-facilities').submitted, true);
  send('r-struct', 'demo-structure-flight', 'v1');                  // the second required one does
  assert.equal(status().status, 'complete'); assert.ok(status().history.some((h) => /Completed: every required/.test(h.text)));
});
test('a survey sent as unallocated counts for the visit once it is attached', () => {
  core.begin({ id: 'r-un', surveyId: 'demo-compound', schemaVersion: 1, answers: { siteId: 'OK-3310' }, media: [], user: 'x' }); core.commit({ id: 'r-un' });
  core.attach(jordan, { visitId: 'v9', recordId: 'r-un' });
  assert.equal(core.visitsFor(jordan, { orgId: '1002' }).visits.find((x) => x.id === 'v9').surveys.find((x) => x.id === 'demo-compound').submitted, true);
});
test('every visit on my sites is visible with ALL its surveys; I can take any survey I can see (unassigned, or from someone else)', () => {
  core.resetVisits();
  const all = core.visitsAll(jordan, { orgId: '1001' }).visits, v1 = all.find((x) => x.id === 'v1');
  assert.ok(all.some((x) => x.status === 'unassigned') && all.some((x) => x.status === 'complete'));          // not just my own
  assert.equal(v1.surveys.length, 4); assert.equal(v1.surveys.find((x) => x.id === 'demo-plumb-twist').assigneeName, 'Sam Okafor');
  assert.equal(v1.surveys.find((x) => x.id === 'demo-guy-facilities').assignee, 'jordan@demo.test');                       // already given to me in the demo
  assert.equal(core.visitsAll(jordan, { orgId: '1002' }).visits.find((x) => x.id === 'v9').surveys.find((x) => x.id === 'demo-guy-facilities').assignee, null);   // and an open one elsewhere
  const mine = (v, id) => v.surveys.find((x) => x.id === id).mine;
  assert.equal(mine(v1, 'demo-structure-flight'), true); assert.equal(mine(v1, 'demo-plumb-twist'), false);
  assert.equal(mine(core.surveyStatus(jordan, 'v1', { surveyId: 'demo-structure-flight', action: 'block', reason: 'x' }).visit, 'demo-structure-flight'), true);
  assert.equal(code(() => core.surveyStatus(jordan, 'v1', { surveyId: 'demo-plumb-twist', action: 'block', reason: 'x' })), 'ERR-VISIT-403');      // not yours until you take it
  assert.equal(mine(core.assignSurvey(jordan, 'v9', { surveyId: 'demo-guy-facilities' }).visit, 'demo-guy-facilities'), true);      // take an open one
  const taken = core.assignSurvey(jordan, 'v1', { surveyId: 'demo-plumb-twist' }).visit;
  assert.equal(mine(taken, 'demo-plumb-twist'), true); assert.ok(taken.history.some((h) => /taken over from Sam Okafor/.test(h.text)));
  assert.equal(core.surveyStatus(jordan, 'v1', { surveyId: 'demo-plumb-twist', action: 'block', reason: 'no gear' }).visit.surveys.find((x) => x.id === 'demo-plumb-twist').blocked, true);
});
test('taking a survey on an unassigned visit makes you its accountable person; a submitted survey cannot be taken', () => {
  core.resetVisits();
  const r = core.assignSurvey(jordan, 'v7', { surveyId: 'demo-guy-facilities' }).visit;      // Stonewall: unassigned
  assert.equal(r.status, 'assigned'); assert.equal(r.accountable, 'Jordan Lee'); assert.equal(r.mine, true);
  assert.equal(code(() => core.assignSurvey(jordan, 'v4', { surveyId: 'demo-compound' })), 'ERR-VISIT-409');
  assert.equal(code(() => core.assignSurvey(sam, 'v9', { surveyId: 'demo-compound' })), 'ERR-VISIT-403');   // not a member of that organization
});
test('older saved data (one survey per visit) is reseeded into visits with all their surveys', () => {
  const old = JSON.parse(JSON.stringify(new ServerCore().state)); old.visitsV = 1; old.visits.forEach((v) => { v.scope = 'Structure Flight'; delete v.sAssign; });
  const c = new ServerCore(old);
  assert.ok(c.state.visits.every((v) => ['Inspection', 'CONS-MOD'].includes(v.scope)) && c.visitsAll(c.state.users.find((u) => u.username === 'jordan'), {}).visits.every((v) => v.surveys.length >= 3));
});
test('a record with a site joins that site’s visit on its own (no attaching), only if the visit’s scope has that survey', () => {
  core.resetVisits();
  core.begin({ id: 'r-site', surveyId: 'demo-guy-facilities', orgId: '1001', schemaVersion: 1, answers: { siteId: ' ia-1 ' }, media: [], user: 'x' }); core.commit({ id: 'r-site' });
  assert.equal(core.visitsAll(jordan, { orgId: '1001' }).visits.find((x) => x.id === 'v1').surveys.find((x) => x.id === 'demo-guy-facilities').submitted, true);
  core.begin({ id: 'r-no', surveyId: 'demo-consmod-sector', orgId: '1001', schemaVersion: 1, answers: { siteId: 'IA-1' }, media: [], user: 'x' }); core.commit({ id: 'r-no' });      // not in Polk City's scope
  assert.ok(!core.visitsAll(jordan, { orgId: '1001' }).visits.find((x) => x.id === 'v1').history.some((h) => /Sector/.test(h.text)));
});
test('optional surveys stay workable after the visit completes: take one and it is yours (Mine), block it, never a 409', () => {
  core.resetVisits();
  const v4 = core.visitsAll(jordan, { orgId: '1001' }).visits.find((x) => x.id === 'v4');
  assert.equal(v4.status, 'complete');                                                       // Dillon: both required surveys already submitted
  const taken = core.assignSurvey(jordan, 'v4', { surveyId: 'demo-guy-facilities' }).visit;
  assert.equal(taken.surveys.find((x) => x.id === 'demo-guy-facilities').mine, true); assert.equal(taken.status, 'complete');
  assert.equal(core.surveyStatus(jordan, 'v4', { surveyId: 'demo-guy-facilities', action: 'block', reason: 'no gear' }).visit.status, 'complete');   // an optional block does not reopen it
  assert.equal(code(() => core.assignSurvey(jordan, 'v4', { surveyId: 'demo-compound' })), 'ERR-VISIT-409');        // a submitted one cannot be taken
});
test('the demo already has surveys assigned to Jordan: required and optional, in several visits', () => {
  core.resetVisits();
  const mine = core.visitsAll(jordan, { orgId: '1001' }).visits.flatMap((v) => v.surveys.filter((s) => s.mine && !s.submitted).map((s) => `${v.id}:${s.id}`));
  assert.ok(mine.length >= 8); assert.ok(mine.includes('v1:demo-guy-facilities') && mine.includes('v2:demo-plumb-twist') && mine.includes('v12:demo-structure-flight'));
});
console.log(`\n${passed} passed`);
