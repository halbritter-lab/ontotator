import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ValidationError, type Draft, type ReanchorItem, type ProposalSetView, type ProjectSummary } from '../src/api/client';
import { CaseScreen } from '../src/app/CaseScreen';
import { CaseViewer } from '../src/variants/CaseViewer';
import { PendingReanchorPanel } from '../src/variants/ReanchorPanel';
import { workspaceFixture } from './assignments';
import { caseDetail, historical, ownRef } from './variantFixtures';
import { refKey } from '../src/variants/versionState';
import { item } from './reanchorFixtures';
const leadProject: ProjectSummary = {
  project_key: 'pkg', name: 'Reanchor browser project', description: null,
  roles: ['lead'], allowed_modes: [], document_count: 3, can_manage: true,
};
beforeEach(()=>{
  vi.spyOn(api,'getCase').mockResolvedValue(caseDetail); vi.spyOn(api,'resolveTermLabels').mockResolvedValue([]);vi.spyOn(api,'listMyTasks').mockResolvedValue([]);
  vi.spyOn(api,'getVariantText').mockImplementation(async (_project,doc)=>({document_id:doc,text:'Immutable '+doc,text_sha256:'text'}));
  vi.spyOn(api,'listAnnotationVersions').mockResolvedValue([ownRef,{...ownRef,kind:'proposals',id:'4',label:'Offered tool set'}]);
  vi.spyOn(api,'listTextLayers').mockResolvedValue([]);
  vi.spyOn(api,'getAnnotationVersion').mockResolvedValue(historical);vi.spyOn(api,'getReanchorItems').mockResolvedValue([item()]);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('shows real review-workspace pending inputs and context display without mutating the draft or save queue',async()=>{
  const view=workspaceFixture('target').view;view.key.mode='review';view.scope.mode='review';
  const next={start:0,end:2,text:Array.from(view.document.text).slice(0,2).join('')};
  const pending=item({new_context:next,diff:[{op:'replace',old_start:100,old_end:item().old_context.end,new_start:0,new_end:2,old_text:item().old_context.text,new_text:next.text}]});
  view.pending_reanchor_items=[pending];
  const command=vi.spyOn(api,'applyCommand'), submit=vi.spyOn(api,'submitWorkspace');
  const before=JSON.stringify(view.draft);
  const mounted=render(<CaseScreen view={view} workspaceId="w" onClose={()=>{}}/>);
  await screen.findByRole('heading',{name:'Needs review after the text change (1)'});
  fireEvent.click(screen.getByRole('button',{name:'HP:1, hpo'}));
  await waitFor(()=>expect(mounted.container.querySelector('.run--context')?.textContent).toBe(next.text));
  expect(command).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();expect(JSON.stringify(view.draft)).toBe(before);
  expect(api.getReanchorItems).not.toHaveBeenCalled();
});

function editableReanchor() {
  const view=workspaceFixture('target','review').view;
  view.document.text='A 😀new finding.';
  const pending=item({layer_id:'phenotype',new_context:{start:0,end:15,text:view.document.text}});
  view.pending_reanchor_items=[pending];
  view.draft.reanchor_inputs=[{proposal_set_id:pending.proposal_set_id,source_ref:pending.source_ref}];
  return {view,pending};
}
function selectCurrentText() {
  const text=document.querySelector('.app-layout > .center-pane .text-container')!;
  const node=text.querySelector('.run')!.firstChild!;
  const range=document.createRange();range.setStart(node,2);range.setEnd(node,7);
  window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);fireEvent.mouseUp(text);
}
it('keeps diagnostic items dismissible when the original finding type is unavailable',async()=>{
  const {view,pending}=editableReanchor();view.pending_reanchor_items=[{...pending,type_id:null}];
  render(<CaseScreen view={view} workspaceId="w" onClose={()=>{}}/>);
  expect(screen.getByRole('button',{name:'Re-create here'})).toHaveProperty('disabled',true);
  expect(screen.getByRole('button',{name:'Dismiss with reason'})).toHaveProperty('disabled',false);
  expect(screen.getByText(/The original finding type is unavailable/)).toBeTruthy();
  await act(async()=>{});
});
it('returns a deleted replacement to pending and cancels re-creation without saving or resolving',async()=>{
  const {view,pending}=editableReanchor();
  view.draft.reanchor_resolutions=[{item:{proposal_set_id:4,source_ref:pending.source_ref},outcome:'recreated',replacement:{annotation_id:'deleted-copy',version:'gone'},reviewer_id:'alice'}];
  const apply=vi.spyOn(api,'applyCommand'),resolve=vi.spyOn(api,'resolveReanchor');
  render(<CaseScreen view={view} workspaceId="w" onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Re-create here'}));
  await screen.findByText(/Select supporting text to re-create HP:1/);
  selectCurrentText();
  await screen.findByRole('heading',{name:'Re-create finding on corrected text'});
  expect(screen.getByRole('button',{name:'Save re-created finding'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(screen.getByText('1 pending, 0 resolved')).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();expect(api.getReanchorItems).not.toHaveBeenCalled();
});
it('retains a failed re-creation, then resolves only the exact saved replacement version with current codepoint offsets',async()=>{
  const {view,pending}=editableReanchor();
  let stored=structuredClone(view.draft);
  const apply=vi.spyOn(api,'applyCommand').mockRejectedValueOnce(new ValidationError('Cannot save this finding')).mockImplementation(async(_id,envelope)=>{
    const payload=envelope.payload as {annotation_id:string;term_id:string;segments:{start:number;end:number}[]};
    const annotation=structuredClone(historical.annotations[0]);annotation.version='saved-version';
    Object.assign(annotation.annotation,{annotation_id:payload.annotation_id,term_id:payload.term_id});
    annotation.annotation.provenance.source_refs=[`${pending.source_ref.annotation_id}:${pending.source_ref.version}`];
    stored={...stored,revision:1,annotations:[annotation]};return stored;
  });
  const resolve=vi.spyOn(api,'resolveReanchor').mockImplementation(async(_id,envelope)=>{
    const payload=envelope.payload as {item:{proposal_set_id:number;source_ref:ReanchorItem['source_ref']};replacement:{annotation_id:string;version:string}};
    stored={...stored,revision:2,reanchor_resolutions:[{...payload,outcome:'recreated',reviewer_id:'alice'}]};return stored;
  });
  render(<CaseScreen view={view} workspaceId="w" onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Re-create here'}));await screen.findByText(/Select supporting text to re-create HP:1/);selectCurrentText();
  fireEvent.click(await screen.findByRole('button',{name:'Save re-created finding'}));
  await screen.findByText('Cannot save this finding');expect(resolve).not.toHaveBeenCalled();
  expect(screen.getByRole('heading',{name:'Re-create finding on corrected text'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Save re-created finding'}));
  await screen.findByRole('button',{name:'Complete text-change review'});
  expect(resolve).not.toHaveBeenCalled();
  expect(screen.getByText('1 pending, 0 resolved')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Complete text-change review'}));
  await screen.findByText('Re-created');
  expect(apply).toHaveBeenLastCalledWith('w',expect.objectContaining({payload:expect.objectContaining({command:'recreate_reanchor',item:{proposal_set_id:pending.proposal_set_id,source_ref:pending.source_ref},term_id:'HP:1',layer_id:'phenotype',segments:[{start:2,end:6}]})}));
  expect(resolve).toHaveBeenCalledWith('w',expect.objectContaining({expected_revision:1,payload:expect.objectContaining({outcome:'recreated',replacement:{annotation_id:stored.annotations![0].annotation.annotation_id,version:'saved-version'}})}));
  expect(screen.getByText('0 pending, 1 resolved')).toBeTruthy();
});
it('reuses a saved edited finding and explicitly pins its current version without creating another copy',async()=>{
  const {view,pending}=editableReanchor();
  const copy=structuredClone(historical.annotations[0]);copy.version='original-version';
  copy.annotation.provenance.source_refs=[`${pending.source_ref.annotation_id}:${pending.source_ref.version}`];
  view.draft.annotations=[copy];
  view.draft.reanchor_resolutions=[{item:{proposal_set_id:4,source_ref:pending.source_ref},outcome:'recreated',replacement:{annotation_id:copy.annotation.annotation_id,version:copy.version},reviewer_id:'alice'}];
  const edited=structuredClone(copy);edited.version='edited-version';edited.annotation.note='Rechecked supporting text';
  const changed={...view.draft,revision:1,annotations:[edited],reanchor_resolutions:[]};
  const apply=vi.spyOn(api,'applyCommand').mockResolvedValue(changed);
  const resolve=vi.spyOn(api,'resolveReanchor').mockRejectedValueOnce(new ValidationError('Link failed')).mockResolvedValue({...changed,revision:2,
    reanchor_resolutions:[{...view.draft.reanchor_resolutions[0],replacement:{annotation_id:copy.annotation.annotation_id,version:edited.version}}]});
  const mounted=render(<CaseScreen view={view} workspaceId="w" onClose={()=>{}}/>);
  expect(screen.getByText('0 pending, 1 resolved')).toBeTruthy();
  fireEvent.click(mounted.container.querySelector('[data-list-key="annotation:old"]')!);
  fireEvent.change(screen.getByRole('textbox',{name:'Note'}),{target:{value:edited.annotation.note}});
  fireEvent.blur(screen.getByRole('textbox',{name:'Note'}));
  await screen.findByText('1 pending, 0 resolved');
  expect(screen.getByText('1 pending, 0 resolved')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Re-create here'}));
  fireEvent.click(await screen.findByRole('button',{name:'Complete text-change review'}));
  await screen.findByText('Link failed');expect(apply).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Complete text-change review'}));
  await screen.findByText('0 pending, 1 resolved');
  expect(resolve).toHaveBeenLastCalledWith('w',expect.objectContaining({payload:{item:{proposal_set_id:4,source_ref:pending.source_ref},outcome:'recreated',replacement:{annotation_id:copy.annotation.annotation_id,version:'edited-version'}}}));
  expect(apply).toHaveBeenCalledTimes(1);
});
it('retains the saved replacement after a resolution failure and retries linking without a duplicate create',async()=>{
  const {view,pending}=editableReanchor();let saved=structuredClone(view.draft);
  const apply=vi.spyOn(api,'applyCommand').mockImplementation(async(_id,envelope)=>{
    const payload=envelope.payload as {annotation_id:string};const copy=structuredClone(historical.annotations[0]);
    copy.annotation.annotation_id=payload.annotation_id;copy.version='saved-version';
    copy.annotation.provenance.source_refs=[`${pending.source_ref.annotation_id}:${pending.source_ref.version}`];
    saved={...saved,revision:1,annotations:[copy]};return saved;
  });
  const resolve=vi.spyOn(api,'resolveReanchor').mockRejectedValueOnce(new ValidationError('Resolution failed')).mockImplementation(async(_id,envelope)=>{
    const payload=envelope.payload as NonNullable<Draft['reanchor_resolutions']>[number];
    return {...saved,revision:2,reanchor_resolutions:[{...payload,reviewer_id:'alice'}]};
  });
  render(<CaseScreen view={view} workspaceId="w" onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Re-create here'}));await screen.findByText(/Select supporting text to re-create HP:1/);selectCurrentText();
  fireEvent.click(await screen.findByRole('button',{name:'Save re-created finding'}));
  fireEvent.click(await screen.findByRole('button',{name:'Complete text-change review'}));
  await screen.findByText('Resolution failed');expect(apply).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Complete text-change review'}));
  await screen.findByText('0 pending, 1 resolved');expect(apply).toHaveBeenCalledTimes(1);expect(resolve).toHaveBeenCalledTimes(2);
});
it('does not select an arbitrary replacement when multiple exact-source copies exist',async()=>{
  const {view,pending}=editableReanchor();const first=structuredClone(historical.annotations[0]);
  first.annotation.provenance.source_refs=[`${pending.source_ref.annotation_id}:${pending.source_ref.version}`];
  const second=structuredClone(first);second.annotation.annotation_id='other-copy';
  view.draft.annotations=[first,second];const apply=vi.spyOn(api,'applyCommand'),resolve=vi.spyOn(api,'resolveReanchor');
  render(<CaseScreen view={view} workspaceId="w" onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Re-create here'}));
  await screen.findByText('Select the replacement finding in the findings list, then choose Complete text-change review.');
  expect(screen.queryByRole('button',{name:'Complete text-change review'})).toBeNull();
  expect(screen.queryByRole('heading',{name:'Re-create finding on corrected text'})).toBeNull();
  expect(apply).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();
});
it('restores reviewer-specific dismissal audit after reload and hides actions in a read-only workspace',async()=>{
  const {view,pending}=editableReanchor();
  const next:Draft={...view.draft,revision:1,reanchor_resolutions:[{item:{proposal_set_id:pending.proposal_set_id,source_ref:pending.source_ref},outcome:'dismissed',reason:'No longer supported',reviewer_id:'alice'}]};
  const resolve=vi.spyOn(api,'resolveReanchor').mockResolvedValue(next);
  const mounted=render(<CaseScreen view={view} workspaceId="w" onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Re-create here'}));await screen.findByText(/Select supporting text to re-create HP:1/);selectCurrentText();
  await screen.findByRole('heading',{name:'Re-create finding on corrected text'});
  fireEvent.click(screen.getByRole('button',{name:'Dismiss with reason'}));
  fireEvent.change(screen.getByRole('textbox',{name:/Reason for dismissal/}),{target:{value:'No longer supported'}});
  fireEvent.click(screen.getByRole('button',{name:'Save dismissal'}));
  await screen.findByText('Dismissed');expect(resolve).toHaveBeenCalledWith('w',expect.objectContaining({payload:{item:{proposal_set_id:4,source_ref:pending.source_ref},outcome:'dismissed',reason:'No longer supported'}}));
  expect(screen.queryByRole('heading',{name:'Re-create finding on corrected text'})).toBeNull();
  mounted.unmount();render(<CaseScreen view={{...view,draft:next}} workspaceId="w" onClose={()=>{}} readOnly/>);
  await act(async()=>{});
  expect(screen.getByText('Reviewed by alice: No longer supported')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Re-create here'})).toBeNull();expect(screen.queryByRole('button',{name:'Dismiss with reason'})).toBeNull();
});
it('uses inline actual-workspace offered metadata without ordinary public prefetch and never loads annotate pending inventory',async()=>{
  const view=workspaceFixture('target').view;
  const metadata:ProposalSetView={id:4,document_id:'target',annotation_set_id:'carried',set_kind:'tool_output',bundle_id:null,actors:[],origin:'reanchor',source_document_id:'old',source_version:7,imported_at:'2026-10-16T00:00:00Z',imported_by_pseudonym:null};
  view.available_inputs=[{...historical.annotations[0],document_id:'target',proposal_set_id:4,notes:[]}];view.proposal_sets=[metadata];
  const get=vi.spyOn(api,'getProposalSet');
  render(<CaseScreen view={view} workspaceId="w" onClose={()=>{}}/>);
  await act(async()=>{});expect(get).not.toHaveBeenCalled();expect(api.getReanchorItems).not.toHaveBeenCalled();
});
it('loads viewer pending items only for an actually offered proposal ref, never Text only or own versions',async()=>{
  vi.spyOn(api,'listProjects').mockResolvedValue([leadProject]);
  const props={projectKey:'pkg',caseId:caseDetail.case_id,variant:'target',username:'alice',onNavigate:vi.fn()};
  const mounted=render(<CaseViewer {...props}/>);await screen.findByText('Immutable target');expect(api.getReanchorItems).not.toHaveBeenCalled();
  mounted.rerender(<CaseViewer {...props} annotations={refKey(ownRef)}/>);await screen.findAllByText('HP:old');expect(api.getReanchorItems).not.toHaveBeenCalled();
  mounted.rerender(<CaseViewer {...props} annotations={refKey({kind:'proposals',id:'4'})}/>);
  await screen.findByRole('heading',{name:'Needs review after the text change (1)'});
  expect(api.getReanchorItems).toHaveBeenCalledTimes(1);expect(api.getReanchorItems).toHaveBeenCalledWith('pkg','target');
  mounted.rerender(<CaseViewer {...props} annotations="text"/>);expect(screen.queryByRole('heading',{name:/Needs review/})).toBeNull();
  expect(api.getReanchorItems).toHaveBeenCalledTimes(1);
});
it('ignores old pending replies after document/ref/permission context replacement',async()=>{
  let finish!:(value:ReanchorItem[])=>void;
  vi.mocked(api.getReanchorItems).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const props={projectKey:'p',documentId:'first',scope:'alice:proposals4',enabled:true,onContext:vi.fn()};
  const mounted=render(<PendingReanchorPanel {...props}/>);await waitFor(()=>expect(api.getReanchorItems).toHaveBeenCalledTimes(1));
  mounted.rerender(<PendingReanchorPanel {...props} documentId="second" scope="bob:text" enabled={false}/>);
  await act(async()=>finish([item()]));expect(screen.queryByRole('heading')).toBeNull();expect(api.getReanchorItems).toHaveBeenCalledTimes(1);
});

it('retains the actual selected document identity for an offered pending-only proposal ref with no annotations',async()=>{
  vi.spyOn(api,'listProjects').mockResolvedValue([leadProject]);
  vi.mocked(api.getAnnotationVersion).mockResolvedValue({ref:{...ownRef,kind:'proposals',id:'4'},annotations:[],evidence:[]});
  render(<CaseViewer projectKey="pkg" caseId={caseDetail.case_id} variant="target" username="alice" onNavigate={()=>{}} annotations={refKey({kind:'proposals',id:'4'})}/>);
  await screen.findByRole('heading',{name:'Needs review after the text change (1)'});
  expect(api.getReanchorItems).toHaveBeenCalledWith('pkg','target');
});

it('blocks submission for an invalidated frozen reanchor resolution and focuses its repair queue',async()=>{
  const {view,pending}=editableReanchor();
  view.draft.reanchor_resolutions=[{item:{proposal_set_id:pending.proposal_set_id,source_ref:pending.source_ref},outcome:'recreated',replacement:{annotation_id:'deleted',version:'old'},reviewer_id:'alice'}];
  const submit=vi.spyOn(api,'submitWorkspace');
  render(<CaseScreen view={view} workspaceId="reanchor-submit" onClose={()=>{}}/>);
  const disclosure = screen.getByRole('button', {name:'HP:1, phenotype'}).closest('details')!;
  disclosure.open = false;
  fireEvent.click(screen.getByRole('button',{name:/Finish & submit/}));
  const dialog=await screen.findByRole('dialog',{name:'Submit text'});
  expect(within(dialog).getByRole('heading',{level:3,name:'Findings after text correction'})).toBeTruthy();
  expect(within(dialog).getByText('Re-create or dismiss 1 finding after text correction before submitting.')).toBeTruthy();
  expect(within(dialog).getByRole('button',{name:'Submit text'}).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(within(dialog).getAllByRole('button',{name:/^Go to /})[0]);
  await waitFor(()=>expect(screen.getByRole('button',{name:'HP:1, phenotype'})).toBe(document.activeElement));
  expect(disclosure.open).toBe(true);
  expect(submit).not.toHaveBeenCalled();
});
