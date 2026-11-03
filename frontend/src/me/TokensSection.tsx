import { useEffect, useId, useRef, useState } from "react";
import { api, type ApiToken, type ApiTokenScope, type CreateApiToken, type CreatedApiToken } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { formatDateTime } from "../app/labels";
import { Button, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, EmptyValue, InlineMessage, StatusBadge, TextInput, type Column, type StatusTone } from "../ui";

/** Whose tokens the section shows (issue 305): the user's own, one project's (leads) or all (admins). */
export type TokensSectionMode = { kind: "personal" } | { kind: "project"; projectKey: string } | { kind: "admin" };

export const SCOPE_LABELS: Record<ApiTokenScope, string> = {
  read: "Read",
  import: "Import",
  export: "Export",
  "project-admin": "Project administration",
  admin: "System administration",
};
const SCOPE_HINTS: Record<ApiTokenScope, string> = {
  read: "Read projects, texts, results and progress.",
  import: "Upload and import texts.",
  export: "Start exports and download them.",
  "project-admin": "Change project settings, members and assignments, start consolidation.",
  admin: "Upload ontologies and translations, manage user accounts.",
};
const KIND_LABELS: Record<ApiToken["kind"], string> = { personal: "Personal", project: "Project", system: "System" };
const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;

type TokenState = "Active" | "Expired" | "Revoked";
const STATE_TONES: Record<TokenState, StatusTone> = { Active: "success", Expired: "neutral", Revoked: "danger" };

export function tokenState(token: ApiToken, now = Date.now()): TokenState {
  if (token.revoked_at) return "Revoked";
  return new Date(token.expires_at).getTime() <= now ? "Expired" : "Active";
}

function client(mode: TokensSectionMode) {
  switch (mode.kind) {
    case "personal": return { list: () => api.listMyTokens(), create: (body: CreateApiToken) => api.createMyToken(body), revoke: (id: number) => api.revokeMyToken(id) };
    case "project": return { list: () => api.listProjectTokens(mode.projectKey), create: (body: CreateApiToken) => api.createProjectToken(mode.projectKey, body), revoke: (id: number) => api.revokeProjectToken(mode.projectKey, id) };
    case "admin": return { list: () => api.adminListTokens(), create: (body: CreateApiToken) => api.adminCreateSystemToken(body), revoke: (id: number) => api.adminRevokeToken(id) };
  }
}

const INTRO: Record<TokensSectionMode["kind"], string> = {
  personal: "A token lets a script or another program use Ontotator as you, without your password. It can do only what its scopes allow and what you may do yourself. Annotation work always needs the browser.",
  project: "A project token lets a script work in this project only, as the lead who created it. It stops working when that lead leaves the project or loses the lead role.",
  admin: "Every API token of this server. A system token belongs to an administrator and is the only kind that may hold the System administration scope.",
};

/** Profile › API tokens, Project settings › People › Project API tokens and Server settings › API tokens. */
export function TokensSection({ mode }: { mode: TokensSectionMode }): JSX.Element {
  const id = useId();
  const projectKey = mode.kind === "project" ? mode.projectKey : undefined;
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>(["read"]);
  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const alive = useRef(true);
  const calls = client(mode);
  const offered: ApiTokenScope[] = mode.kind === "admin" ? ["read", "import", "export", "project-admin", "admin"] : ["read", "import", "export", "project-admin"];

  useEffect(() => {
    alive.current = true;
    let active = true;
    setTokens(null); setLoadError(undefined);
    calls.list().then(value => { if (active) setTokens(value); }, failure => { if (active) setLoadError(failure); });
    return () => { active = false; alive.current = false; };
    // calls depends only on the mode's kind and project key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.kind, projectKey, retry]);

  const closeForm = () => { setAdding(false); setName(""); setScopes(["read"]); setDays(String(DEFAULT_DAYS)); };
  const create = async () => {
    const lifetime = Number(days);
    if (!scopes.length) { setError(new Error("Choose at least one scope.")); return; }
    if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > MAX_DAYS) { setError(new Error(`A token is valid for 1 to ${MAX_DAYS} days.`)); return; }
    setBusy(true); setError(undefined);
    try {
      const result = await calls.create({ name, scopes, expires_in_days: lifetime });
      if (!alive.current) return;
      setTokens(current => [result.token, ...(current ?? [])]);
      setCreated(result);
      closeForm();
    } catch (failure) { if (alive.current) setError(failure); } finally { if (alive.current) setBusy(false); }
  };
  const revoke = async (token: ApiToken) => {
    setBusy(true); setError(undefined);
    try {
      const result = await calls.revoke(token.id);
      if (!alive.current) return;
      setTokens(current => (current ?? []).map(item => item.id === result.id ? result : item));
      setRevoking(null);
    } catch (failure) { if (alive.current) setError(failure); } finally { if (alive.current) setBusy(false); }
  };

  const columns: Column<ApiToken>[] = [
    { id: "name", header: "Name", cell: token => token.name, rowHeader: true },
    ...(mode.kind === "admin" ? [{ id: "kind", header: "Kind", cell: (token: ApiToken) => KIND_LABELS[token.kind] }] : []),
    ...(mode.kind !== "personal" ? [{ id: "owner", header: "Owner", cell: (token: ApiToken) => `${token.owner_display_name} (${token.owner})` }] : []),
    ...(mode.kind === "admin" ? [{ id: "project", header: "Project", cell: (token: ApiToken) => token.project_key ?? <EmptyValue /> }] : []),
    { id: "scopes", header: "Scopes", cell: token => token.scopes.map(scope => SCOPE_LABELS[scope]).join(", ") },
    { id: "expires", header: "Expires", cell: token => <time dateTime={token.expires_at}>{formatDateTime(token.expires_at)}</time> },
    { id: "used", header: "Last used", cell: token => token.last_used_at ? <time dateTime={token.last_used_at}>{formatDateTime(token.last_used_at)}</time> : <EmptyValue /> },
    { id: "state", header: "Status", cell: token => { const state = tokenState(token); return <StatusBadge tone={STATE_TONES[state]}>{state}</StatusBadge>; } },
    { id: "actions", header: <span className="visually-hidden">Actions</span>, cell: token => tokenState(token) === "Active"
      ? <Button size="sm" disabled={busy} aria-label={`Revoke ${token.name}`} onClick={() => { setError(undefined); setRevoking(token); }}>Revoke…</Button> : null },
  ];

  const heading = mode.kind === "project" ? "Project API tokens" : "API tokens";
  const project = mode.kind === "project";
  return <section aria-label={heading} className={project ? "settings-card" : "detail-section"}>
    <h2 className={project ? "settings-card-title" : undefined}>{heading}</h2>
    <p>{INTRO[mode.kind]}</p>
    {tokens === null && loadError === undefined && <InlineMessage tone="info">Loading tokens…</InlineMessage>}
    {loadError !== undefined && <><ErrorNotice error={loadError} /><Button onClick={() => setRetry(value => value + 1)}>Try again</Button></>}
    {tokens !== null && (tokens.length ? <DataTable label={heading} columns={columns} rows={tokens} rowKey={token => String(token.id)} /> : <EmptyState title="No API tokens yet." />)}
    {error !== undefined && !revoking && <ErrorNotice error={error} />}
    {!adding ? <Button disabled={tokens === null} onClick={() => { setError(undefined); setAdding(true); }}>{mode.kind === "admin" ? "New system token…" : "New token…"}</Button>
      : <form aria-label="New API token" onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) void create(); }}>
        <fieldset disabled={busy}>
          <legend className="settings-subheading">{mode.kind === "admin" ? "New system token" : "New token"}</legend>
          <TextInput id={`${id}-name`} label="Token name" required maxLength={100} autoFocus value={name} hint="Say what uses it, for example the name of the script." onChange={event => setName(event.target.value)} />
          <fieldset><legend>Scopes</legend>
            {offered.map(scope => <Checkbox key={scope} id={`${id}-scope-${scope}`} label={SCOPE_LABELS[scope]} hint={SCOPE_HINTS[scope]} checked={scopes.includes(scope)}
              onChange={event => setScopes(event.target.checked ? offered.filter(item => item === scope || scopes.includes(item)) : scopes.filter(item => item !== scope))} />)}
          </fieldset>
          <TextInput id={`${id}-days`} label="Valid for (days)" type="number" min={1} max={MAX_DAYS} required value={days} hint={`1 to ${MAX_DAYS} days.`} onChange={event => setDays(event.target.value)} />
          <div className="settings-section-actions">
            <Button type="submit" variant="primary" loading={busy}>Create token</Button>
            <Button onClick={closeForm}>Cancel</Button>
          </div>
        </fieldset>
      </form>}
    {created && <NewTokenDialog created={created} onClose={() => setCreated(null)} />}
    <ConfirmDialog open={revoking !== null} tone="danger" busy={busy} title={revoking ? `Revoke the token ${revoking.name}?` : ""} confirmLabel="Revoke token"
      message={<><p>Every script that uses this token stops working at once. This cannot be undone.</p>{error !== undefined && <ErrorNotice error={error} />}</>}
      onCancel={() => { if (!busy) { setRevoking(null); setError(undefined); } }}
      onConfirm={() => { if (revoking) void revoke(revoking); }} />
  </section>;
}

function NewTokenDialog({ created, onClose }: { created: CreatedApiToken; onClose: () => void }): JSX.Element {
  const [copy, setCopy] = useState<"copied" | "failed" | null>(null);
  const copyToken = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(created.secret);
      setCopy("copied");
    } catch { setCopy("failed"); }
  };
  return <Dialog open title={`New token ${created.token.name}`} size="sm" onClose={onClose}
    footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
    <p>This token is shown only once. Store it now, for example in your password manager.</p>
    <p className="code-once-value"><code>{created.secret}</code></p>
    <p>Send it as <code>Authorization: Bearer</code> followed by the token.</p>
    <Button onClick={() => { void copyToken(); }}>{copy === "copied" ? "Copied" : "Copy token"}</Button>
    {copy === "failed" && <InlineMessage tone="error">Could not copy to the clipboard. Select and copy the token manually.</InlineMessage>}
  </Dialog>;
}
