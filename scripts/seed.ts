/**
 * Demo seed: one fintech company ("Speedy Finance Demo"), five users, a couple of projects
 * (mirroring the "admin sets what we're building" requirement) and a handful of tasks.
 *
 * Uses the Supabase service-role key directly (never exposed to the browser) to bypass RLS for
 * setup convenience — exactly the kind of system-only write the admin client exists for.
 *
 * Run with: npm run seed   (needs .env.local populated: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// --- tiny .env.local loader (no dotenv dependency) ---
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Populate .env.local first.'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const PASSWORD = 'Demo12345!';
const USERS = [
  { email: 'admin@demo.workline.app', name: 'Amaka Admin', roles: ['admin'] },
  { email: 'pm@demo.workline.app', name: 'Peter PM', roles: ['pm'] },
  { email: 'lead@demo.workline.app', name: 'Tolu Lead', roles: ['tech_lead'] },
  { email: 'dev1@demo.workline.app', name: 'Chidi Dev', roles: ['employee'] },
  { email: 'dev2@demo.workline.app', name: 'Zainab Dev', roles: ['employee'] },
];

async function upsertUser(email: string, name: string) {
  const { data: existing } = await sb.auth.admin.listUsers({ perPage: 200 });
  const found = existing.users.find((u) => u.email === email);
  if (found) return found.id;
  const { data, error } = await sb.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  console.log('Creating demo users...');
  const ids: Record<string, string> = {};
  for (const u of USERS) { ids[u.email] = await upsertUser(u.email, u.name); await sb.from('profiles').update({ full_name: u.name }).eq('id', ids[u.email]); }
  const adminId = ids['admin@demo.workline.app'];

  console.log('Creating demo company...');
  let { data: company } = await sb.from('companies').select('id').eq('slug', 'speedy-finance-demo').maybeSingle();
  if (!company) {
    const { data, error } = await sb.from('companies').insert({
      name: 'Speedy Finance (Demo)', slug: 'speedy-finance-demo', timezone: 'Africa/Lagos', industry: 'Fintech', created_by: adminId,
    }).select('id').single();
    if (error) throw error;
    company = data;
    await sb.from('departments').insert([{ company_id: company.id, name: 'Engineering' }, { company_id: company.id, name: 'Operations' }]);
    await sb.from('task_categories').insert(['Development', 'Customer Service', 'Operations', 'Administration', 'Finance', 'Maintenance', 'Other']
      .map((name, i) => ({ company_id: company!.id, name, sort_order: i + 1 })));
  }
  const companyId = company.id;
  const { data: eng } = await sb.from('departments').select('id').eq('company_id', companyId).eq('name', 'Engineering').single();
  const { data: devCat } = await sb.from('task_categories').select('id').eq('company_id', companyId).eq('name', 'Development').single();

  console.log('Adding memberships and roles...');
  for (const u of USERS) {
    const { data: existingM } = await sb.from('company_memberships').select('id').eq('company_id', companyId).eq('user_id', ids[u.email]).maybeSingle();
    const membershipId = existingM?.id ?? (await sb.from('company_memberships').insert({ company_id: companyId, user_id: ids[u.email], department_id: eng?.id ?? null }).select('id').single()).data!.id;
    for (const role of u.roles) await sb.from('membership_roles').upsert({ membership_id: membershipId, company_id: companyId, role_key: role }, { onConflict: 'membership_id,role_key' });
  }

  console.log('Creating demo products...');
  const { data: existingProject } = await sb.from('projects').select('id').eq('company_id', companyId).eq('name', 'Merchant Payouts App').maybeSingle();
  let projectId = existingProject?.id;
  if (!projectId) {
    const { data: proj, error } = await sb.from('projects').insert({
      company_id: companyId, created_by: adminId, name: 'Merchant Payouts App',
      description: 'A new app for small merchants to accept and reconcile payments — separate from our existing consumer money-transfer app.',
      status: 'active',
    }).select('id').single();
    if (error) throw error;
    projectId = proj.id;
    await sb.from('project_members').insert([
      { project_id: projectId, company_id: companyId, user_id: ids['lead@demo.workline.app'], assigned_by: adminId },
      { project_id: projectId, company_id: companyId, user_id: ids['dev1@demo.workline.app'], assigned_by: adminId },
      { project_id: projectId, company_id: companyId, user_id: ids['dev2@demo.workline.app'], assigned_by: adminId },
    ]);
    await sb.from('project_scope_items').insert([
      { project_id: projectId, company_id: companyId, title: 'Merchant onboarding & KYC', weight: 30, estimated_hours: 80, sort_order: 0 },
      { project_id: projectId, company_id: companyId, title: 'Payment acceptance flow', weight: 40, estimated_hours: 120, sort_order: 1 },
      { project_id: projectId, company_id: companyId, title: 'Reconciliation dashboard', weight: 30, estimated_hours: 60, sort_order: 2 },
    ]);
  }

  // Tasks created directly (service role, no session) must start as draft/submitted/pending_approval —
  // the tasks_guard trigger enforces this even for privileged writes, exactly as it does for real users.
  // That keeps the seed honest: to see an approved/in-progress task, approve this one from the Approvals
  // page as the demo PM or admin.
  console.log('Creating demo tasks...');
  const today = new Date().toISOString().slice(0, 10);
  const { data: existingTask } = await sb.from('tasks').select('id').eq('company_id', companyId).eq('title', 'Build KYC document upload screen').maybeSingle();
  if (!existingTask) {
    const { data: task, error } = await sb.from('tasks').insert({
      company_id: companyId, title: 'Build KYC document upload screen', description: 'Screen for merchants to upload ID and proof of address during onboarding.',
      category_id: devCat?.id ?? null, department_id: eng?.id ?? null, creator_id: ids['dev1@demo.workline.app'], priority: 'high',
      project_id: projectId, status: 'pending_approval', estimated_hours: 16, original_deadline: `${today}T17:00:00Z`,
    }).select('id').single();
    if (error) throw error;
    await sb.from('task_assignees').insert({ task_id: task.id, company_id: companyId, user_id: ids['dev1@demo.workline.app'] });
  }

  console.log('\nDone. Demo login (all users share this password):');
  console.log(`  password: ${PASSWORD}`);
  for (const u of USERS) console.log(`  ${u.email}  (${u.roles.join(', ')})`);
  console.log('\nSign in at /login with any of the above.');
}

main().catch((e) => { console.error(e); process.exit(1); });
