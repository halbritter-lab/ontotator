import { SearchPreferencesSection } from "./SearchPreferencesSection";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { api, type OwnProfilePatch, type Profile } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { LanguagesField } from "../admin/LanguagesField";
import { Button, Checkbox, Dialog, InlineMessage, TextInput } from "../ui";
import type { Route, RouteLeaveGuard } from "../app/router";
import { PracticeSection } from "../practice/PracticeSection";
import { RouteLink } from "../documents/RowCells";

/** The future app controller can refresh displayed identity from the saved response. */
export interface ProfilePageProps {
  onSaved?: (profile: Profile) => void;
  routeLeaveRef?: MutableRefObject<RouteLeaveGuard | null>;
  leaveGuardRef?: MutableRefObject<((proceed: () => void) => void) | null>;
  /** Profile › Practice: "Continue" opens My tasks. */
  onNavigate?: (route: Route) => void;
  /** The task the user came from: shows "Back to the task". */
  backToTask?: number;
  /** The project whose Documents page the user came from: shows "Back to Documents". */
  backToDocuments?: string;
}

function profileChanges(baseline: Profile, draft: Profile): OwnProfilePatch {
  const change: OwnProfilePatch = {};
  if (draft.display_name !== baseline.display_name) change.display_name = draft.display_name;
  const email = draft.email?.trim() || null;
  const orcid = draft.orcid?.trim() || null;
  if (email !== baseline.email) change.email = email;
  if (orcid !== baseline.orcid) change.orcid = orcid;
  if (draft.orcid_consent !== baseline.orcid_consent) change.orcid_consent = draft.orcid_consent;
  if (draft.qualification !== baseline.qualification) change.qualification = draft.qualification ?? null;
  if (JSON.stringify([...draft.languages].sort()) !== JSON.stringify([...baseline.languages].sort())) change.languages = draft.languages;
  return change;
}

function passwordProblem(username: string, next: string, repeat: string): string | undefined {
  const normalized = next.normalize("NFC");
  if (/[\uD800-\uDFFF]/u.test(normalized)) return "The password contains characters that are not valid Unicode text.";
  const length = Array.from(normalized).length;
  if (length < 12) return "The password must have at least 12 characters.";
  if (length > 256) return "The password must have at most 256 characters.";
  if (normalized !== repeat.normalize("NFC")) return "The new passwords must match.";
  // Usernames are restricted to ASCII. Include the non-ASCII full casefolds
  // that can reduce to ASCII, without treating dotless i as an ASCII i.
  const folds: Record<string, string> = { "ß": "ss", "ſ": "s", "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };
  // Python str.strip includes NEL/C0 separators and retains FEFF, unlike JS trim.
  const stripForComparison = (text: string) => text.replace(/^[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/g, "");
  const folded = stripForComparison(normalized).toLowerCase().replace(/[ßſﬀﬁﬂﬃﬄﬅﬆ]/g, (letter) => folds[letter]);
  if (folded === stripForComparison(username.normalize("NFC")).toLowerCase()) return "The password must differ from the username.";
}

export function ProfilePage({ backToTask, backToDocuments, onSaved, routeLeaveRef, leaveGuardRef, onNavigate }: ProfilePageProps): JSX.Element {
  const [searchDirty, setSearchDirty] = useState(false);
  const [model, setModel] = useState<{ baseline: Profile; draft: Profile } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<"profile" | "password" | null>(null);
  const [saveError, setSaveError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<unknown>();
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwords, setPasswords] = useState({ current: "", next: "", repeat: "" });
  const alive = useRef(false);
  const [leaving, setLeaving] = useState<{ resolve?: (allowed: boolean) => void; proceed?: () => void } | null>(null);
  const pendingLeave = useRef<typeof leaving>(null);
  const dirty = searchDirty || (!!model && Object.keys(profileChanges(model.baseline, model.draft)).length > 0);
  const latest = useRef({ dirty, busy, save: async (): Promise<boolean> => false });
  const closeLeave = (allowed: boolean) => {
    const request = pendingLeave.current; pendingLeave.current = null; setLeaving(null);
    request?.resolve?.(allowed); if (allowed && alive.current) request?.proceed?.();
  };
  useEffect(() => {
    let pending: Promise<boolean> | null = null;
    const guard = () => {
      if (latest.current.busy) return Promise.resolve(false);
      if (!latest.current.dirty) return Promise.resolve(true);
      if (!pending) pending = new Promise<boolean>(resolve => {
        const request = { resolve: (allowed: boolean) => { pending = null; resolve(allowed); } };
        pendingLeave.current = request; setLeaving(request);
      });
      return pending;
    };
    const logout = (proceed: () => void) => {
      if (latest.current.busy || pendingLeave.current) return;
      if (!latest.current.dirty) { proceed(); return; }
      const request = { proceed }; pendingLeave.current = request; setLeaving(request);
    };
    if (routeLeaveRef) routeLeaveRef.current = guard;
    if (leaveGuardRef) leaveGuardRef.current = logout;
    const unload = (event: BeforeUnloadEvent) => { if (latest.current.dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => {
      if (routeLeaveRef?.current === guard) routeLeaveRef.current = null;
      if (leaveGuardRef?.current === logout) leaveGuardRef.current = null;
      window.removeEventListener("beforeunload", unload); pendingLeave.current?.resolve?.(false); pendingLeave.current = null;
    };
  }, [routeLeaveRef, leaveGuardRef]);

  useEffect(() => {
    alive.current = true;
    let active = true;
    setLoading(true);
    setLoadError(undefined);
    void api.getProfile().then((profile) => {
      if (active) {
        setModel({ baseline: profile, draft: { ...profile, languages: [...profile.languages] } });
        setLoading(false);
      }
    }).catch((error: unknown) => {
      if (active) { setLoadError(error); setLoading(false); }
    });
    return () => { active = false; alive.current = false; };
  }, [retry]);

  const edit = (change: Partial<Profile>) => {
    setModel((current) => current && { ...current, draft: { ...current.draft, ...change } });
    setSaved(false);
    setSaveError(undefined);
  };
  const save = async () => {
    if (!model || busy) return false;
    const { baseline, draft } = model;
    const change = profileChanges(baseline, draft);
    setSaveError(undefined);
    setSaved(false);
    if (!Object.keys(change).length) { setSaved(true); return true; }
    setBusy("profile");
    try {
      const response = await api.updateOwnProfile(change);
      if (!alive.current) return false;
      setModel({ baseline: response, draft: { ...response, languages: [...response.languages] } });
      setSaved(true);
      onSaved?.(response);
      return true;
    } catch (error: unknown) {
      if (alive.current) setSaveError(error);
      return false;
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  latest.current = { dirty, busy, save };
  const changePassword = async () => {
    if (!model || busy) return;
    setPasswordSaved(false);
    const problem = passwordProblem(model.baseline.username, passwords.next, passwords.repeat);
    setPasswordError(problem ? new Error(problem) : undefined);
    if (problem) return;
    setBusy("password");
    try {
      await api.changePassword(passwords.current, passwords.next);
      if (!alive.current) return;
      setPasswords({ current: "", next: "", repeat: "" });
      setPasswordSaved(true);
    } catch (error: unknown) {
      if (alive.current) setPasswordError(error);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  if (!model) return <section>
    <h1>Profile</h1>
    {loading ? <InlineMessage tone="info">Loading profile…</InlineMessage> : <>
      <ErrorNotice error={loadError} />
      <Button onClick={() => setRetry((value) => value + 1)}>Retry</Button>
    </>}
  </section>;

  const draft = model.draft;
  return <div className="density-compact">
    <section className="detail-section">
      {backToTask !== undefined && <RouteLink route={{ name: "task", assignmentId: backToTask }} onNavigate={onNavigate}>Back to the task</RouteLink>}
      {backToTask === undefined && backToDocuments !== undefined && <RouteLink route={{ name: "projectDocuments", key: backToDocuments }} onNavigate={onNavigate}>Back to Documents</RouteLink>}
      <h1>Profile</h1>
      <dl>
        <dt>Username</dt><dd>{model.baseline.username}</dd>
        <dt>Pseudonym</dt><dd>{model.baseline.pseudonym}<div className="field-hint">Your pseudonym appears in exports instead of your name.</div></dd>
      </dl>
      <form aria-label="Profile" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <TextInput id="profile-display-name" label="Display name" required value={draft.display_name} disabled={!!busy} onChange={(event) => edit({ display_name: event.target.value })} />
        <TextInput id="profile-email" label="E-mail" type="email" value={draft.email ?? ""} disabled={!!busy} onChange={(event) => edit({ email: event.target.value })} />
        <LanguagesField id="profile-languages" label="Languages you can read" value={draft.languages} disabled={!!busy} onChange={(languages) => edit({ languages })} />
        <TextInput id="profile-qualification" label="Qualification" maxLength={200} value={draft.qualification ?? ""} disabled={!!busy} onChange={event => edit({ qualification: event.target.value })} hint="Required before submitting a translation review." />
        <TextInput id="profile-orcid" label="ORCID" value={draft.orcid ?? ""} disabled={!!busy} onChange={(event) => edit({ orcid: event.target.value })} />
        <Checkbox id="profile-consent" label="Name me (display name and ORCID) as a contributor in exports" checked={draft.orcid_consent} disabled={!!busy} onChange={(event) => edit({ orcid_consent: event.target.checked })} />
        {saveError != null && <ErrorNotice error={saveError} />}
        {saved && <InlineMessage tone="success">Saved.</InlineMessage>}
        <Button type="submit" variant="primary" disabled={!!busy} loading={busy === "profile"}>Save</Button>
      </form>
    </section>
    <SearchPreferencesSection pseudonym={model.baseline.pseudonym} onDirty={setSearchDirty} />
    <PracticeSection onNavigate={onNavigate} />
    <section className="detail-section">
      <h2>Change password</h2>
      <form aria-label="Change password" onSubmit={(event) => { event.preventDefault(); void changePassword(); }}>
        <TextInput id="password-current" label="Current password" type="password" autoComplete="current-password" required value={passwords.current} disabled={!!busy}
          onChange={(event) => { setPasswordSaved(false); setPasswords({ ...passwords, current: event.target.value }); }} />
        <TextInput id="password-new" label="New password" type="password" autoComplete="new-password" required hint="Use 12–256 characters." value={passwords.next} disabled={!!busy}
          onChange={(event) => { setPasswordSaved(false); setPasswords({ ...passwords, next: event.target.value }); }} />
        <TextInput id="password-repeat" label="Repeat new password" type="password" autoComplete="new-password" required value={passwords.repeat} disabled={!!busy}
          onChange={(event) => { setPasswordSaved(false); setPasswords({ ...passwords, repeat: event.target.value }); }} />
        {passwordError != null && <ErrorNotice error={passwordError} />}
        {passwordSaved && <InlineMessage tone="success">Password changed. Other sessions were logged out.</InlineMessage>}
        <Button type="submit" disabled={!!busy} loading={busy === "password"}>Change password</Button>
      </form>
    </section>
    {leaving && <Dialog open title="Unsaved profile changes" onClose={busy ? undefined : () => closeLeave(false)}>
      <p>Your profile changes have not been saved.</p>{searchDirty && <p>Cancel and save Search preferences before leaving, or discard changes.</p>}
      <Button disabled={!!busy} onClick={() => closeLeave(false)}>Cancel</Button>
      <Button disabled={!!busy} variant="danger" onClick={() => closeLeave(true)}>{leaving.proceed ? "Discard and log out" : "Discard changes and leave"}</Button>
      <Button disabled={searchDirty} loading={busy === "profile"} onClick={() => { void latest.current.save().then(ok => { if (ok && alive.current) closeLeave(true); }); }}>{leaving.proceed ? "Save and log out" : "Save and leave"}</Button>
    </Dialog>}
  </div>;
}
