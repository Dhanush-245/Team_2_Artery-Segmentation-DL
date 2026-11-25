import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
// Opt-in disposable synthetic saved-run fixture. Never select a real patient case.
const fixturePath = process.env.E2E_REFERENCE_FIXTURE;
test.describe('reference upload acceptance', () => {
 test.skip(!fixturePath, 'Requires isolated synthetic saved-run fixture');
 test('invalid file, retry, persistence and authenticated exports', async ({page,request},info)=>{
  const f=JSON.parse(readFileSync(fixturePath!,'utf8'));
  expect(info.project.use.baseURL).toBe(f.base_url);
  const login=await request.post('/api/auth/login',{data:{identifier:f.email,password:f.password}});expect(login.ok()).toBeTruthy();
  const headers={Authorization:`Bearer ${(await login.json()).access_token}`};
  const base=`/api/cases/${f.case_id}/volumes/analyses/${f.run_id}`;
  const runs=await request.get(`/api/cases/${f.case_id}/volumes/analyses`,{headers});expect(runs.ok()).toBeTruthy();
  expect((await runs.json()).find((run:{id:string})=>run.id===f.run_id)?.input_kind).toBe('synthetic_fixture');
  const previous=(await (await request.get(base+'/reference-metrics',{headers})).json()).records;
  const original=await request.get(base+'/artifacts/mask_source.nii.gz',{headers});expect(original.ok()).toBeTruthy();
  await page.goto('/');await page.getByLabel(/username or email/i).fill(f.email);await page.getByLabel(/^password$/i).fill(f.password);
  await page.getByRole('button',{name:/^sign in$/i}).click();await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
  await page.goto(`/analysis?case_id=${f.case_id}`);
  const panel=page.getByRole('region',{name:'Model evaluation',exact:true});
  await expect(panel.getByRole('heading',{name:'Case reference mask evaluation'})).toBeVisible();
  await panel.getByLabel('Reference provenance').fill('SYNTHETIC self-reference software acceptance; not independent expert evidence.');
  await panel.getByLabel(/belongs to the exact source study/).check();await panel.getByLabel(/foreground annotation matches/).check();
  const root=fixturePath!.slice(0,fixturePath!.lastIndexOf('/'));const file=panel.getByLabel('Source-aligned reference mask');
  await file.setInputFiles(root+'/invalid.nii.gz');await panel.getByRole('button',{name:'Calculate and save case metrics'}).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await file.setInputFiles(root+'/reference.nii.gz');await panel.getByRole('button',{name:'Calculate and save case metrics'}).click();
  await expect(panel.getByRole('status')).toHaveText('Reference metrics saved for this run.');
  await expect(panel.locator('dd')).toHaveText(['1.0000','1.0000','0.0000 mm','0.0000 mm']);
  const saved=(await (await request.get(base+'/reference-metrics',{headers})).json()).records.at(-1);expect(saved.independent_validation).toBe(false);
  const records=(await (await request.get(base+'/reference-metrics',{headers})).json()).records;expect(records.length).toBe(previous.length+1);for(const row of previous)expect(records).toContainEqual(row);
  await writeFile(info.outputPath('reference.json'),JSON.stringify(saved,null,2));
  await page.reload();await expect(panel.locator('dd')).toHaveText(['1.0000','1.0000','0.0000 mm','0.0000 mm']);await expect(panel).toContainText(saved.id);
  await panel.screenshot({path:info.outputPath('reference-reopened.png')});
  const exports=page.getByRole('group',{name:'3D research report exports'});
  for(const format of ['JSON','CSV','PDF']){
   const pending=page.waitForEvent('download');await exports.getByRole('button',{name:format,exact:true}).click();const download=await pending;
   await download.saveAs(info.outputPath('report.'+format.toLowerCase()));expect(await download.failure()).toBeNull();
   const api=await request.get(base+'/report/'+format.toLowerCase(),{headers});expect(api.ok()).toBeTruthy();
   if(format==='JSON')expect((await api.json()).reference_evaluations.at(-1)).toEqual(saved);
   if(format==='CSV')expect(await api.text()).toContain(saved.id);
  }
  const zip=await request.get(base+'/evidence.zip',{headers});expect(zip.ok()).toBeTruthy();await writeFile(info.outputPath('evidence.zip'),await zip.body());
  const after=await request.get(base+'/artifacts/mask_source.nii.gz',{headers});expect(after.ok()).toBeTruthy();expect(await after.body()).toEqual(await original.body());
 });
});
