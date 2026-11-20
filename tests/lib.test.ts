import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, parseEstimate, parseExtension } from '../src/lib/ai/parse';
import { heuristicEstimate, heuristicExtension } from '../src/lib/ai/heuristics';
import { signParams, validateUpload, isOwnCloudinaryAsset, buildUploadFolder } from '../src/lib/cloudinary';
import { renderEmail, escapeHtml, dedupeKey } from '../src/lib/email/templates';
import { aiConfigFromEnv } from '../src/lib/ai/provider';

test('AI JSON extraction tolerates code fences and prose', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"a":2} done'), { a: 2 });
  assert.throws(() => extractJson('no json'));
});

test('AI estimate validation rejects malformed output and cannot claim unsupplied history', () => {
  const ok = { recommended_min_hours: 24, recommended_max_hours: 40, verdict: 'reasonable', explanation: 'Fine.', missing_information: ['x'], used_company_history: true };
  assert.equal(parseEstimate(ok, 10).usedCompanyHistory, true);
  assert.equal(parseEstimate(ok, 1).usedCompanyHistory, false);   // sample too small -> history claim stripped
  assert.throws(() => parseEstimate({ ...ok, recommended_min_hours: 50 }, 0));
  assert.throws(() => parseEstimate({ ...ok, verdict: 'approve' }, 0));
  assert.throws(() => parseEstimate({ ...ok, explanation: '' }, 0));
  assert.throws(() => parseExtension({ verdict: 'approved', recommendation: 'x' }, false));
});

const est = { title: 't', description: 'short', category: null, expectedDeliverable: null, employeeEstimateHours: 40, startDate: null, deadline: null,
  dependencies: [], workingHoursPerDay: 8, workload: null, history: { sampleSize: 0, avgActualToEstimate: null }, recentUnplannedHours: 0, openBlockers: 0 };

test('heuristic estimate never invents company history', () => {
  const r = heuristicEstimate(est);
  assert.equal(r.usedCompanyHistory, false);
  assert.match(r.explanation, /not enough company-specific history/);
  assert.ok(r.missingInformation.length >= 2);
  const h = heuristicEstimate({ ...est, history: { sampleSize: 5, avgActualToEstimate: 1.5 } });
  assert.equal(h.usedCompanyHistory, true);
  assert.ok(h.recommendedMaxHours > 40);
});

test('heuristic extension: documented urgent work makes a request reasonable', () => {
  const base = { taskTitle: 't', originalDeadline: null, currentDeadline: 'a', requestedDeadline: 'b', reason: 'urgent production issue',
    estimatedHours: 16, actualHours: 8, progress: 50, workingHoursPerDay: 8, workingDaysRequested: 1, openBlockers: [], previousExtensions: 0,
    unplannedWorkDuringPeriod: [{ title: 'Refund', hours: 2, urgent: true }, { title: 'Hotfix', hours: 3, urgent: true }] };
  assert.equal(heuristicExtension(base).verdict, 'reasonable');
  const weak = heuristicExtension({ ...base, unplannedWorkDuringPeriod: [], previousExtensions: 1, progress: 10 });
  assert.equal(weak.verdict, 'questionable');
});

test('AI config is read from env and absent when incomplete', () => {
  assert.equal(aiConfigFromEnv({} as NodeJS.ProcessEnv), null);
  assert.deepEqual(aiConfigFromEnv({ AI_PROVIDER: 'anthropic', AI_API_KEY: 'k', AI_MODEL: 'm' } as unknown as NodeJS.ProcessEnv), { provider: 'anthropic', apiKey: 'k', model: 'm', baseUrl: undefined });
});

test('Cloudinary: signature matches the documented algorithm; uploads are validated and tenant-scoped', () => {
  // Cloudinary docs example: sha1("eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510" + secret)
  const sig = signParams({ timestamp: 1315060510, public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' }, 'abcd');
  assert.equal(sig, 'bfd09f95f331f558cbd1320e67aa8d488770583e');
  assert.equal(validateUpload({ contentType: 'application/x-msdownload', bytes: 10 }), 'File type not allowed');
  assert.equal(validateUpload({ contentType: 'image/png', bytes: 99_999_999 }), 'File exceeds the 10 MB limit');
  assert.equal(validateUpload({ contentType: 'image/png', bytes: 1000 }), null);
  const folder = buildUploadFolder('co1', 'tasks');
  assert.ok(isOwnCloudinaryAsset(`${folder}/x`, 'co1'));
  assert.ok(!isOwnCloudinaryAsset(`${folder}/x`, 'co2'));
  assert.ok(!isOwnCloudinaryAsset('workline/co1/../co2/x', 'co1'));
});

test('email templates escape user content and only link http(s)', () => {
  const { html, text } = renderEmail({ title: 'T <b>', intro: '<script>alert(1)</script>', details: [['Task', '"quoted" & more']], ctaUrl: 'javascript:alert(1)' });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('&quot;quoted&quot; &amp; more'));
  assert.ok(text.includes('Task: "quoted" & more'));
  assert.ok(renderEmail({ title: 'a', intro: 'b', ctaUrl: 'https://app.example.com/x' }).html.includes('href="https://app.example.com/x"'));
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(dedupeKey(['deadline', 'task1', null, '24h']), 'deadline:task1:24h');
});
