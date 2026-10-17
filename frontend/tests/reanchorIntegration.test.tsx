import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type ReanchorItem, type ProposalSetView, type ProjectSummary } from '../src/api/client';
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
  vi.spyOn(api,'getAnnotationVersion').mockResolvedValue(historical);vi.spyOn(api,'getReanchorItems').mockResolvedValue([item()]);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('shows real review-workspace pending inputs and context display without mutating the draft or save queue',async()=>{
  const view=workspaceFixture('target').view;view.key.mode='review';view.scope.mode='review';
  const next={start:0,end:2,text:Array.from(view.document.text).slice(0,2).join('')};
  const pending=item({new_context:next,diff:[{op:'replace',old_start:100,old_end:item().old_context.end,new_start:0,new_end:2,old_text:item().old_context.text,new_text:next.text}]});
  vi.mocked(api.getReanchorItems).mockResolvedValue([pending]);
  const command=vi.spyOn(api,'applyCommand'), submit=vi.spyOn(api,'submitWorkspace');
  const before=JSON.stringify(view.draft);
  const mounted=render(<CaseScreen view={view} workspaceId="w" onClose={()=>{}}/>);
  await screen.findByRole('heading',{name:'Needs review after the text change (1)'});
  fireEvent.click(screen.getByRole('button',{name:'HP:1 · hpo'}));
  await waitFor(()=>expect(mounted.container.querySelector('.run--context')?.textContent).toBe(next.text));
  expect(command).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();expect(JSON.stringify(view.draft)).toBe(before);
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
  mounted.rerender(<CaseViewer {...props} annotations={refKey(ownRef)}/>);await screen.findByText('HP:old');expect(api.getReanchorItems).not.toHaveBeenCalled();
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
