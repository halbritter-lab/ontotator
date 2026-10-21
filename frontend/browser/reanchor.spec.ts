import { expect, test, type Locator, type Page } from '@playwright/test';
import type { components } from '../src/api/generated';
import { authenticatedRequest, loginExisting, openCase, selectText, submitCase } from './helpers';

test.setTimeout(90_000);
type Item = components['schemas']['ReanchorItem'];
type Opened = components['schemas']['AssignmentOpenResponse'];
type Metadata = components['schemas']['ProposalSetView'];
type Scenario = {
  project: string; document_id: string; old_document_id: string; text: string; old_text: string;
  users: Record<'annotator'|'adjudicator'|'lead'|'second_reviewer', string>; pseudonyms: Record<'annotator'|'adjudicator'|'lead'|'second_reviewer', string>; assignment_id: number; second_assignment_id:number; task: 'annotate'|'review';
  import_job_id: number; children: {id:number;status:string;result:{carried:number;needs_review:number};payload:{old_document_id:string;new_document_id:string;producer:{kind:string;job_id:number}}}[];
  pending: Item[]; metadata: Metadata;
};
const left = (page:Page) => page.locator('.app-layout > .center-pane .text-container');
const panel = (page:Page) => page.getByRole('region',{name:'Needs review after the text change',exact:true});
const documentPath = (s:Scenario, suffix:string) => `/api/v1/projects/${encodeURIComponent(s.project)}/documents/${encodeURIComponent(s.document_id)}/${suffix}`;
async function scenario(page:Page,assisted=false):Promise<Scenario> {
  const response=await page.request.post(`/__test_reanchor__?assisted=${assisted}`,{timeout:90_000});
  expect(response.ok()).toBeTruthy();const s=await response.json() as Scenario;
  expect(s.children).toHaveLength(1);const child=s.children[0];
  expect(child.status).toBe('succeeded');expect(child.payload.producer).toEqual({kind:'import',job_id:s.import_job_id});
  expect(child.payload.old_document_id).toBe(s.old_document_id);expect(child.payload.new_document_id).toBe(s.document_id);
  expect(child.result.carried).toBeGreaterThanOrEqual(1);expect(child.result.needs_review).toBeGreaterThanOrEqual(1);
  expect(s.pending).toHaveLength(child.result.needs_review);
  expect(s.pending.every(item=>item.proposal_set_id===s.metadata.id)).toBe(true);
  expect(s.metadata.source_document_id).toBe(s.old_document_id);expect(s.metadata.source_version).toBe(1);
  await test.info().attach('actual-reanchor-producer',{body:Buffer.from(JSON.stringify({project:s.project,import:s.import_job_id,children:s.children,pending:s.pending,metadata:s.metadata})),contentType:'application/json'});
  return s;
}
async function workspace(page:Page,s:Scenario):Promise<Opened> {
  const response=await authenticatedRequest(page,`/api/v1/assignments/${s.assignment_id}/open`,'POST');
  expect(response.ok()).toBeTruthy();return await response.json() as Opened;
}
async function ready(page:Page,s:Scenario) {
  await loginExisting(page,s.users[s.task==='annotate'?'annotator':'adjudicator']);
  const roles=await (await authenticatedRequest(page,'/api/v1/projects')).json() as {project_key:string;roles:string[]}[];
  expect(roles.find(row=>row.project_key===s.project)?.roles).toEqual([s.task==='annotate'?'annotator':'adjudicator']);
  await openCase(page,{projectKey:s.project,documentId:s.document_id,task:s.task});
  await expect(left(page)).toHaveText(s.text);await expect(page.locator('.status-badge')).toContainText('Saved');
  await page.evaluate(()=>document.fonts.ready);
}
const writesSince = (page:Page) => {
  const writes:string[]=[];
  page.on('request',request=>{if(request.method()!=='GET' && /\/workspaces\/.+\/(commands|decisions|reanchor-resolutions|submit)/.test(request.url()))writes.push(request.url());});
  return writes;
};

test('re-creates a Unicode finding, dismisses with reason, reloads and submits with private durable resolutions',async({page,browser})=>{
  await page.setViewportSize({width:1280,height:900});
  const s=await scenario(page);await ready(page,s);
  expect(s.pending).toHaveLength(2);
  const opened=await workspace(page,s), rows=panel(page).locator('ol > li');
  const first=opened.view.pending_reanchor_items![0];
  const rowFor = (item: Item) => panel(page).locator(`[data-reanchor-item=${JSON.stringify(JSON.stringify([item.proposal_set_id, item.source_ref.annotation_id, item.source_ref.version]))}]`);
  const firstRow = rowFor(first), secondRow = rowFor(opened.view.pending_reanchor_items![1]);
  expect(opened.view.draft.reanchor_inputs).toHaveLength(2);
  const writes=writesSince(page);
  await panel(page).locator(':scope > details > summary').click();
  await page.getByRole('button',{name:/^Finish & Submit/}).click();
  const blocked=page.getByRole('dialog',{name:'Submit case',exact:true});
  await expect(blocked).toContainText('2 finding(s) after text correction still pending');
  await expect(blocked).toContainText('Re-create or dismiss 2 findings after text correction before submitting.');
  await blocked.getByLabel(/Entire text checked for further findings/).check();
  await expect(blocked.getByRole('button',{name:'Submit case',exact:true})).toBeDisabled();
  // Each pending item has its own "Go to" action; the first leads to the first pending row.
  await blocked.getByRole('button',{name:/^Go to /}).first().click();
  await expect(blocked).toBeHidden();
  await expect(rows.first().getByRole('button').first()).toBeFocused();
  expect(writes).toEqual([]);
  expect(first.axes_values).toBeTruthy();
  expect(first.axes_defaulted).toContain('experiencer');
  await expect(rows.first()).toContainText('experiencer: patient (defaulted)');
  await rows.first().getByRole('button',{name:'Re-create here',exact:true}).click();
  await expect(left(page).locator('.run--context')).toHaveCount(0,{timeout:3500});
  await expect(page.getByText(/Select supporting text to re-create/)).toBeVisible();
  const start=s.text.indexOf('Ataxia 😀new'),end=start+'Ataxia 😀new'.length;
  await selectText(page,start,end);
  const editor=page.getByRole('region',{name:'New finding',exact:true});
  await expect(editor.getByRole('heading')).toHaveText('Re-create finding on corrected text');
  await expect(editor).toContainText(first.term_id);
  await page.screenshot({path:test.info().outputPath('reanchor-desktop.png')});
  await page.setViewportSize({width:600,height:900});
  await page.screenshot({path:test.info().outputPath('reanchor-narrow.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1280,height:900});
  await editor.getByRole('button',{name:'Save re-created finding',exact:true}).click();
  await expect(page.getByRole('button',{name:'Complete text-change review',exact:true})).toBeVisible();
  expect((await workspace(page,s)).view.draft.reanchor_resolutions ?? []).toEqual([]);
  await page.getByRole('button',{name:/^Confirm defaults \(\d+\)/}).click();
  await page.getByRole('button',{name:'Complete text-change review',exact:true}).click();
  await panel(page).getByText('Completed text-change reviews (1)',{exact:true}).click();
  await expect(firstRow).toContainText('Re-created');
  const savedRow = page.locator('.sidebar [data-list-key^="annotation:"]').first();
  const geometryBefore = await left(page).boundingBox();
  await page.keyboard.press('Escape');
  await savedRow.focus(); await savedRow.press('Enter');
  await expect(page.getByTestId('axes-section')).toBeVisible();
  expect(await left(page).boundingBox()).toEqual(geometryBefore);
  await secondRow.getByRole('button',{name:'Dismiss with reason',exact:true}).click();
  const reason=secondRow.getByRole('textbox',{name:/Reason for dismissal/});
  await expect(reason).toBeFocused();
  await reason.fill('The corrected sentence no longer supports this finding.');
  await secondRow.getByRole('button',{name:'Save dismissal',exact:true}).click();
  await expect(panel(page)).toContainText('0 pending · 2 resolved');
  const saved=await workspace(page,s), resolution=saved.view.draft.reanchor_resolutions!;
  expect(resolution).toHaveLength(2);
  const recreated=resolution.find(item=>item.outcome==='recreated')!;
  const snapshot=saved.view.draft.annotations!.find(value=>value.annotation.annotation_id===recreated.replacement!.annotation_id)!;
  expect(recreated.replacement!.version).toBe(snapshot.version);
  expect(recreated.item).toEqual({proposal_set_id:first.proposal_set_id,source_ref:first.source_ref});
  expect(snapshot.annotation.term_id).toBe(first.term_id);
  expect(snapshot.annotation.axes_values).toEqual(first.axes_values);
  expect(snapshot.annotation.axes_defaulted ?? []).toEqual(first.axes_defaulted.filter(axis=>axis!=='experiencer'));
  const replacementDetails=firstRow.getByText(/^Replacement:/);
  await expect(replacementDetails).toBeHidden();
  await firstRow.getByText('Resolution details',{exact:true}).click();
  await expect(replacementDetails).toBeVisible();
  await expect(replacementDetails).toContainText(recreated.replacement!.annotation_id);
  await page.setViewportSize({width:600,height:900});
  await page.getByRole('navigation',{name:'Select view'}).getByRole('button',{name:/^Findings/}).click();
  expect(await replacementDetails.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('reanchor-resolved-narrow.png')});
  await page.setViewportSize({width:1280,height:900});
  expect(snapshot.annotation.provenance.actor.actor_id).toBe(s.pseudonyms.adjudicator);
  expect(snapshot.annotation.provenance.source_refs).toContain(`${first.source_ref.annotation_id}:${first.source_ref.version}`);
  const cpStart=Array.from(s.text.slice(0,start)).length,cpEnd=Array.from(s.text.slice(0,end)).length;
  expect(snapshot.evidence[0].mention.segments).toEqual([{start:cpStart,end:cpEnd}]);
  expect(Array.from(s.text).slice(cpStart,cpEnd).join('')).toBe('Ataxia 😀new');
  expect(resolution.find(item=>item.outcome==='dismissed')).toMatchObject({reviewer_id:s.pseudonyms.adjudicator,reason:'The corrected sentence no longer supports this finding.'});
  expect(await (await authenticatedRequest(page,documentPath(s,'reanchor-items'))).json()).toEqual(s.pending);
  await page.reload();await expect(panel(page)).toContainText('0 pending · 2 resolved');
  const other=await browser.newContext({baseURL:test.info().project.use.baseURL});
  try {
    const second=await other.newPage();await loginExisting(second,s.users.second_reviewer);
    await openCase(second,{projectKey:s.project,documentId:s.document_id,task:'review'});
    await expect(panel(second)).toContainText('2 pending · 0 resolved');
    const response=await authenticatedRequest(second,`/api/v1/assignments/${s.second_assignment_id}/open`,'POST');
    expect(response.ok()).toBeTruthy();const own=await response.json() as Opened;
    expect(own.view.draft.reanchor_resolutions??[]).toEqual([]);
    expect(own.view.draft.reanchor_inputs).toEqual(saved.view.draft.reanchor_inputs);
  } finally {await other.close();}
  await page.locator('.sidebar [data-list-key^="target:"]').click();
  await page.getByRole('button',{name:/^Confirm/}).click();
  await submitCase(page);
  const result=await workspace(page,s);
  expect(result.read_only).toBe(true);
  const submission=result.view.submissions!.at(-1)!;
  expect(submission.reanchor_inputs).toEqual(saved.view.draft.reanchor_inputs);
  expect(submission.reanchor_resolutions).toEqual(resolution);
  await page.getByRole('button',{name:'Stay in case',exact:true}).click();
  await expect(panel(page).getByRole('button',{name:'Re-create here'})).toHaveCount(0);
  await expect(panel(page).getByRole('button',{name:'Dismiss with reason'})).toHaveCount(0);
});
async function nativeSelection(surface:Locator) {
  return surface.evaluate(element=>{
    const selection=window.getSelection()!;
    const offset=(node:Node|null,local:number)=>{
      const run=(node?.nodeType===Node.ELEMENT_NODE?node as Element:node?.parentElement)?.closest<HTMLElement>('.run');
      return run && element.contains(run)?Number(run.dataset.start)+local:null;
    };
    return {anchor:offset(selection.anchorNode,selection.anchorOffset),focus:offset(selection.focusNode,selection.focusOffset),text:selection.toString()};
  });
}
/** UTF16 DOM points only; server windows below remain absolute codepoints. */
async function point(surface:Locator,offset:number,edge:'start'|'end') {
  return surface.evaluate((element,{offset,edge})=>{
    for(const run of element.querySelectorAll<HTMLElement>('.run')) {
      const start=Number(run.dataset.start),node=run.firstChild;
      if(node && start<=offset && offset<start+(node.textContent?.length??0)) {
        const local=offset-start,value=node.textContent??'';
        const units=(value.codePointAt(local)??0)>0xffff?2:1;
        const range=document.createRange();range.setStart(node,local);range.setEnd(node,local+units);
        const rect=range.getBoundingClientRect();
        return {x:edge==='start'?rect.left+0.25:rect.right-0.25,y:rect.top+rect.height/2};
      }
    }
    throw new Error(`Missing literal character at UTF16 ${offset}`);
  },{offset,edge});
}
async function nativeAcrossExpiry(page:Page,s:Scenario,button:Locator,method:'pointer'|'Shift',writes:string[]) {
  await button.click();await left(page).scrollIntoViewIfNeeded();
  const marker=left(page).locator('.run--context');await expect(marker).not.toHaveCount(0);
  // The context button belongs to the last pending item, now a distinct second
  // producer finding. Select inside that revealed window, not the first match.
  const start=s.text.lastIndexOf('😀new'),end=start+'😀new'.length;
  const a=await point(left(page),start,'start'),b=await point(left(page),end-1,'end');
  // Native drag or held-Shift pointer extension establishes the unfinished range.
  // No synthetic JS caret/range or unsupported caret-arrow assumption.
  if(method==='Shift') {
    await page.mouse.click(b.x,b.y);
    await page.keyboard.down('Shift');
    await page.mouse.move(a.x,a.y);await page.mouse.down();
  } else {
    await page.mouse.move(a.x,a.y);await page.mouse.down();
    await page.mouse.move(b.x,b.y,{steps:6});
  }
  const before=await nativeSelection(left(page));
  expect(before.text).toContain('😀new');expect(before.anchor).not.toBeNull();expect(before.focus).not.toBeNull();
  if(method==='Shift')expect(before.anchor!).toBeGreaterThan(before.focus!);
  else {expect(before.anchor).toBe(start);expect(before.focus).toBe(end);}
  expect(writes).toEqual([]);
  // Wait for the actual 2000ms display timer while selection is unfinished.
  await expect(marker).toHaveCount(0,{timeout:3500});
  expect(await nativeSelection(left(page))).toEqual(before);expect(writes).toEqual([]);
  await page.mouse.up();
  if(method==='Shift')await page.keyboard.up('Shift');
  await expect(page.getByRole('region',{name:'New finding',exact:true}).getByRole('heading',{name:'New finding',exact:true})).toBeVisible();
  // Completion may prepare ordinary pending UI, but saving still needs a term.
  expect(writes).toEqual([]);
  // A marked span is discarded (the inspector at wide widths, the New finding bar at narrow ones).
  await page.locator('.inspector-pane, .pending-bar').getByRole('button',{name:'Discard',exact:true}).click();
}

for(const width of [1280,1024,600])test(`real pending contexts preserve producer data, owned scroll and transient native selection at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const s=await scenario(page);await ready(page,s);
  const before=await workspace(page,s),writes=writesSince(page);
  expect(before.view.key.mode).toBe('review');
  const response=await authenticatedRequest(page,documentPath(s,'reanchor-items'));expect(response.ok()).toBeTruthy();
  const items=await response.json() as Item[];expect(items).toEqual(s.pending);
  await page.locator('.case-version-controls > summary').click();
  await expect(page.getByRole('button',{name:'Compare',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Compare',exact:true}).click();
  const comparison=page.getByRole('region',{name:'Comparison',exact:true});
  const version=comparison.getByLabel('Text version',{exact:true});
  await version.selectOption(s.old_document_id);await expect(version).toHaveValue(s.old_document_id);
  const annotations=comparison.getByLabel('Annotations',{exact:true});
  await annotations.selectOption('text');await expect(annotations).toHaveValue('text');
  await expect(annotations.locator('option:checked')).toHaveText('Text only');
  await expect(comparison.locator('.text-container')).toHaveText(s.old_text);
  await expect(comparison.getByRole('region',{name:'Needs review after the text change',exact:true})).toHaveCount(0);
  await expect(comparison.getByLabel('Couple scrolling',{exact:true})).not.toBeChecked();
  await expect(comparison.getByLabel('Couple scrolling',{exact:true})).toBeDisabled();
  await expect(panel(page).getByRole('heading')).toHaveText(`Needs review after the text change (${items.length})`);
  const rows=panel(page).locator('ol > li');await expect(rows).toHaveCount(items.length);
  for(let i=0;i<items.length;i++) {
    const row=rows.nth(i),item=items[i];
    expect(item.reason).toBe('changed_segment');
    await expect(row.getByRole('button').first()).toContainText(`${item.term_id}`);await expect(row.getByRole('button').first()).toContainText(item.layer_id);
    await expect(row.getByRole('button').first()).toContainText('Seizure');
    await expect(row.getByText('The evidence text changed.',{exact:true})).toBeVisible();
    await expect(row.locator('[data-current-context]')).toHaveText(item.new_context.text);
    await expect(row.locator('[data-old-context]')).toBeHidden();
    await row.getByText('Original context and text changes',{exact:true}).click();
    await expect(row.locator('[data-old-context]')).toBeVisible();
    expect(await row.locator('[data-old-context]').textContent()).toBe(item.old_context.text);
    await expect(row.locator('literal')).toHaveCount(0);
    expect(await row.locator('[data-current-context]').textContent()).toBe(item.new_context.text);
    const old=Array.from(s.old_text),next=Array.from(s.text);
    expect(old.slice(item.old_context.start,item.old_context.end).join('')).toBe(item.old_context.text);
    expect(next.slice(item.new_context.start,item.new_context.end).join('')).toBe(item.new_context.text);
    const diff=row.locator('[data-old-start]');await expect(diff).toHaveAttribute('data-old-start',String(item.old_context.start));
    await expect(diff).toHaveAttribute('data-new-start',String(item.new_context.start));
    expect(item.diff.filter(op=>op.op!=='insert').map(op=>op.old_text).join('')).toBe(item.old_context.text);
    expect(item.diff.filter(op=>op.op!=='delete').map(op=>op.new_text).join('')).toBe(item.new_context.text);
    await expect(row.locator('.translation-diff del')).not.toHaveCount(0);await expect(row.locator('.translation-diff ins')).not.toHaveCount(0);
  }
  await panel(page).locator(':scope > details > summary').click();await expect(rows.first()).toBeHidden();
  await panel(page).locator(':scope > details > summary').click();await expect(rows.first()).toBeVisible();
  const button=rows.last().getByRole('button').first();await button.scrollIntoViewIfNeeded();
  const otherBefore=await comparison.locator('.text-container').evaluate(el=>el.scrollTop);
  const windowBefore=await page.evaluate(()=>({x:scrollX,y:scrollY}));
  await left(page).evaluate(el=>{el.scrollTop=0;});await button.click();
  expect(await page.evaluate(()=>({x:scrollX,y:scrollY}))).toEqual(windowBefore);
  expect(await comparison.locator('.text-container').evaluate(el=>el.scrollTop)).toBe(otherBefore);
  expect(await left(page).evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  const item=items.at(-1)!;
  expect(await left(page).locator('.run--context').allTextContents()).not.toHaveLength(0);
  expect((await left(page).locator('.run--context').allTextContents()).join('')).toBe(item.new_context.text);
  const first=left(page).locator('.run--context').first();
  expect(await first.getAttribute('data-start')).toBe(String(Array.from(s.text).slice(0,item.new_context.start).join('').length));
  await left(page).scrollIntoViewIfNeeded();await expect(first).toBeInViewport();
  const geometry=await first.evaluate(mark=>{const pane=mark.closest('.text-container')!;const a=mark.getBoundingClientRect(),b=pane.getBoundingClientRect();return {top:a.top,bottom:a.bottom,paneTop:b.top,paneBottom:b.bottom};});
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.paneTop-2);expect(geometry.bottom).toBeLessThanOrEqual(geometry.paneBottom+2);
  await expect(left(page).locator('.run--context')).toHaveCount(0,{timeout:3500});
  expect(writes).toEqual([]);expect((await workspace(page,s)).view.draft).toEqual(before.view.draft);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(width===1280) {
    await nativeAcrossExpiry(page,s,button,'pointer',writes);
    await nativeAcrossExpiry(page,s,button,'Shift',writes);
    // Actual human adoption must retain source ancestry without an AI badge.
    const offered=(before.view.available_inputs??[]).find(value=>value.proposal_set_id===s.metadata.id)!;
    await page.locator('.sidebar [data-list-key^="target:"]').filter({hasText:'HP:0001252'}).click();
    const source=page.getByRole('region',{name:'Proposal source',exact:true});
    await expect(source).toContainText(`Carried over from version ${s.metadata.source_version}`);
    const actor=s.metadata.actors.find(value=>value.actor_id===offered.annotation.provenance.actor.actor_id)!;
    expect(actor).toBeDefined();
    expect(actor.actor_id).toBe('ontocurator-reanchor');
    for(const value of [actor.name??actor.actor_id,actor.version,actor.model,actor.run_id]) {
      if(typeof value==='string' && value)await expect(source).toContainText(value);
    }
    await expect(source).toContainText('score 0.91');await expect(source).toContainText(s.metadata.annotation_set_id);
    await page.getByRole('button',{name:/Edit & Replace/}).click();
    await expect(page.locator('.sidebar [data-list-key^="annotation:"]')).toHaveCount(1);
    await expect(page.locator('.status-badge')).toContainText('Saved');
    const adopted=((await workspace(page,s)).view.draft.annotations??[]).find(value=>value.annotation.provenance.actor.kind==='human')!;
    expect(adopted).toBeDefined();expect(adopted.annotation.provenance.actor.actor_id).toBe(s.pseudonyms.adjudicator);
    expect(adopted.annotation.provenance.source_refs).toContain(`${offered.annotation.annotation_id}:${offered.version}`);
    await expect(page.locator('.sidebar [data-list-key^="annotation:"] .badge-ai')).toHaveCount(0);
  }
});

test('ordinary mounted annotate stays blind; same-assignment assisted API carrier and current revocation enforce provenance privacy',async({page,browser})=>{
  const s=await scenario(page,true),inventoryReads:string[]=[];
  page.on('request',request=>{if(request.method()==='GET' && /\/(proposal-sets|reanchor-items)(\/|\?|$)/.test(new URL(request.url()).pathname))inventoryReads.push(request.url());});
  await ready(page,s);const opened=await workspace(page,s);
  // Actual App annotation assignments deliberately open blind/independent.
  expect(opened.view.key.mode).toBe('independent');
  expect(opened.view.available_inputs??[]).toEqual([]);expect(opened.view.proposal_sets??[]).toEqual([]);
  await expect(page.getByRole('region',{name:'Reference annotations',exact:true})).toHaveCount(0);
  const source=page.getByRole('region',{name:'Proposal source',exact:true});
  await expect(source).toHaveCount(0);await expect(panel(page)).toHaveCount(0);expect(inventoryReads).toEqual([]);
  // Real API evidence under the SAME current cookie/annotate assignment. This
  // existing endpoint supports assisted; it does not mount an alternate App.
  const body:components['schemas']['OpenWorkspaceRequest']={project_key:s.project,document_id:s.document_id,mode:'assisted'};
  const assisted=await authenticatedRequest(page,'/api/v1/workspaces/open','POST',body);expect(assisted.ok()).toBeTruthy();
  const current=await assisted.json() as components['schemas']['OpenWorkspaceResponse'];
  expect(current.view.key).toMatchObject({project_key:s.project,document_id:s.document_id,annotator_id:s.pseudonyms.annotator,mode:'assisted'});
  expect(current.view.proposal_sets??[]).toHaveLength(1);
  const metadata=current.view.proposal_sets![0];
  expect(metadata).toMatchObject({id:s.metadata.id,document_id:s.document_id,annotation_set_id:s.metadata.annotation_set_id,origin:'reanchor',source_document_id:s.old_document_id,source_version:s.metadata.source_version,actors:s.metadata.actors});
  const offered=(current.view.available_inputs??[]).filter(value=>value.proposal_set_id===metadata.id);
  expect(offered).toHaveLength(s.children[0].result.carried);
  expect(offered.every(value=>value.document_id===s.document_id && value.annotation.document_id===s.document_id)).toBe(true);
  const actor=metadata.actors.find(value=>value.actor_id===offered[0].annotation.provenance.actor.actor_id)!;
  expect(actor).toBeDefined();expect(actor.actor_id).toBe('ontocurator-reanchor');
  expect(offered[0].notes).toContain('score 0.91');
  expect(inventoryReads).toEqual([]);await expect(source).toHaveCount(0);await expect(panel(page)).toHaveCount(0);
  await test.info().attach('actual-assisted-api-carrier',{body:Buffer.from(JSON.stringify({key:current.view.key,proposal_sets:current.view.proposal_sets,offered})),contentType:'application/json'});
  const denied=await authenticatedRequest(page,`/api/v1/projects/${encodeURIComponent(s.project)}/proposal-sets/${s.metadata.id}`);
  expect([403,404]).toContain(denied.status());
  const pendingDenied=await authenticatedRequest(page,documentPath(s,'reanchor-items'));expect([403,404]).toContain(pendingDenied.status());
  const management=await browser.newContext({baseURL:test.info().project.use.baseURL});
  try {
    const lead=await management.newPage();await loginExisting(lead,s.users.lead);
    const revoked=await authenticatedRequest(lead,`/api/v1/assignments/${s.assignment_id}/revoke`,'POST',{reason:'Current exact provenance authority removed'});expect(revoked.ok()).toBeTruthy();
  } finally {await management.close();}
  const stale=await authenticatedRequest(page,'/api/v1/workspaces/open','POST',body);expect([403,404]).toContain(stale.status());
  const taskStale=await authenticatedRequest(page,`/api/v1/assignments/${s.assignment_id}/open`,'POST');expect([403,404]).toContain(taskStale.status());
  await page.reload();await expect(page.getByRole('heading',{name:'This task is no longer assigned to you.',exact:true})).toBeVisible();await expect(page.locator('.reference-item')).toHaveCount(0);await expect(source).toHaveCount(0);await expect(panel(page)).toHaveCount(0);
});
