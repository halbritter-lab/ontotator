# Frequently asked questions

Short answers to problems people often meet. Each answer links to the chapter with the full steps.

Your problem is not listed? For an error message, a page that does not load or a crash, [report a technical problem](getting-started.md#report-a-technical-problem) to the system administrators. For questions about the texts or the rules, ask your project lead.

## Logging in

### I forgot my password

Ask a system administrator for a reset code. Ontotator sends no e-mail. Then click **I have a setup or reset code** on the login page and set a new password. See [Set your password with a setup or reset code](getting-started.md#set-your-password-with-a-setup-or-reset-code). Administrators: see [Issue a new setup or reset code](admin.md#issue-a-new-setup-or-reset-code).

### The login says "Username or password is wrong, or the account is temporarily locked."

Check the spelling of your username. After 5 wrong passwords within 15 minutes, login for that username from your network is locked for up to 15 minutes; wait and try again. If you no longer know the password, ask an administrator for a reset code.

### My setup or reset code does not work

Codes work once and expire: setup codes after 24 hours, reset codes after 2 hours. A newer code also cancels an older one. Ask an administrator for a new code. Capital letters, spaces and hyphens in the code do not matter.

### A login window appears while I am working

Your session has ended. Log in again in that window. Your unsaved edits stay in the open editor and are saved after you log in. See [Log in](getting-started.md#log-in).

### The page says "The page is out of date; reload it." or "Your page is out of date."

Reload the page in the browser, then repeat the last action. If the message asks you to, log in again ([Log in](getting-started.md#log-in)).

## Tasks and projects

### I see an error message that is not explained here

Click **Technical problem…** in the sidebar, or **Report a technical problem…** in the editor under **More**. Describe what you did. Ontotator adds the last error it received. The report goes to the system administrators and does not pause your task. See [Report a technical problem](getting-started.md#report-a-technical-problem).

### The page says "Something went wrong while displaying this text."

The editor could not show the text. Your saved changes are kept on the server. Click **Reload case**. If it happens again, click **Report a technical problem…** on the same screen: the error message is added to the report for you.

### The page says "Something went wrong while displaying this page."

A screen outside the editor, such as My tasks, Documents or a page under Administration, could not be shown. Work that was already saved is kept on the server, and the sidebar still works: open another page there, click **Go to My tasks**, or click **Reload page**. If it happens again, click **Report a technical problem…** on the same screen: the error message is added to the report for you.

### The page says "The project is busy right now."

Another operation, often a running import, is holding the project. What you just did was not applied, so nothing needs undoing. Wait a moment and click **Retry**, or repeat the action. In the editor the save status says **Project busy – changes not saved**, and your unsaved edits stay on the page until the save goes through.

### After login I see Projects, not My tasks

Ontotator opens the project you used last. The first time, leads and administrators see **Projects** and everyone else **My tasks**. Click **My tasks** in the sidebar. See [Log in](getting-started.md#log-in).

### My tasks is empty

A project lead has not assigned you a text yet. Assigned texts appear under **My tasks** automatically. Also check the status tabs: **All** shows every task. See [See your tasks](getting-started.md#see-your-tasks).

### I see "You are not a member of any project yet."

Ask your project lead or an administrator to add you to a project, then click **My tasks** or reload the page. Leads: see [Add a member](lead-settings.md#add-a-member).

### A task opens with "Task not found or not yours"

The task was removed or given to someone else, or you followed a link meant for another person. Go back to **My tasks** ([See your tasks](getting-started.md#see-your-tasks)).

### My task is paused

A problem report pauses the task, yours or the lead's. A one-line banner *Task paused: …* above the text gives the reason; click **Show more** to read all of it. You can read your saved work but not change or submit it. If you reported the problem yourself, you can resume with a reason. If the lead paused it, only the lead can release it. See [Resume a paused task or withdraw a report](annotator.md#resume-a-paused-task-or-withdraw-a-report).

### My submitted task is read-only

A submission cannot be edited. To change your work, open the task, choose **More** › **Work rounds** and click **Continue from this submission**. Your findings are carried into a new round; check them, make your changes and submit again. See [Start a new work round](annotator.md#start-a-new-work-round). A lead can also reopen your task; it then shows **Reopened** with the lead's reason.

### I cannot open project settings, Ontologies or New project

Project settings are for project leads. **Ontologies**, **Users**, **Technical reports** and **New project** are for system administrators. The page tells you whom to ask. See [Roles](README.md#roles).

## Annotating

### Why is "Finish & submit" disabled?

Only for the moment a submit is running. Otherwise the button stays available, and if something is still open it shows how many items. Click **Next open item** to jump to one, or open the submit dialog: it lists every open item with **Go to**. Typical open items are undecided proposals, carried findings not yet checked, findings after a text correction, or values not yet chosen. See [Submit the text](annotator.md#submit-the-text).

### The submit dialog shows "Values not chosen yet"

Some findings still have prefilled values you did not confirm. Click **Confirm as shown** per finding, or **Confirm all as shown**, or **Go to** the finding and choose another value. In some projects you must confirm them before you can submit. See [Confirm values and acknowledge warnings in the submit dialog](annotator.md#confirm-values-and-acknowledge-warnings-in-the-submit-dialog).

### The submit dialog shows "Modifier warnings"

A finding uses a modifier term (such as a severity) as the finding itself, or has two modifiers of one kind. Check it with **Go to**. If it is correct, submit anyway with the button that names the number of warnings. See [Add modifiers to a finding](annotator.md#add-modifiers-to-a-finding).

### Submitting fails with "Replace obsolete terms" or "Replace unknown terms"

The project moved to a newer ontology release and a term in your draft, or in a proposal you confirmed, is retired or no longer exists there. Your task stays open and your draft is kept. Pick another term for that finding, or reject or replace the affected proposal. Then submit again. See [Change term, note or delete a finding](annotator.md#change-term-note-or-delete-a-finding).

### "Add finding without a text span" is disabled

Your project requires a text span for every finding. Mark the text passage instead. See [Add a finding without a text span](annotator.md#add-a-finding-without-a-text-span).

### The save status says "Changed elsewhere – reload required"

The same task was changed in another window or by someone else. Click **Reload case**. See [The editor screen](annotator.md#the-editor-screen).

### The save status says "Offline – changes not saved"

The connection to the server is lost. Keep the window open; your input stays in the editor. When the connection is back, saving usually resumes on its own; if the status stays, click **Retry**. See [The editor screen](annotator.md#the-editor-screen).

### The term search does not find the right term

The search compares your words with term names and synonyms; it does not understand meaning. Terms whose name or synonym equals your words come first, then terms whose name or synonym contains all your words; other similar terms follow in a shuffled order, those tagged **Weak match** last. Enter takes a weak match only after you choose it. Read all hits, then try another word, a synonym, the English name or a code. See [Search a term](annotator.md#search-a-term).

## Translation review

### I cannot submit my review: "Your qualification is required to submit."

Add your qualification (for example "physician, native German speaker") in your profile, then submit again. Use the link **Add your qualification in your profile**; after saving, **Back to the task** returns you to the review. See [Edit your profile](getting-started.md#edit-your-profile).

### What does "automatic check failed" mean?

The translation tool checked its own output and found a possible problem, for example numbers or units that differ from the source. Click **Details** to read the check, what the tool reported and what to do if the translation is right anyway. Open **Technical details** for the technical code of the check. If Ontotator has no description for a check, ask the project lead what it checks. See [Review a translation](annotator.md#review-a-translation).

## Consolidating

### Why is "Submit consolidation" disabled?

Some groups are still open. Decide each open group first; the progress card counts what is left. See [Finish a consolidation](consolidator.md#finish-a-consolidation).

### I submitted a consolidation with a mistake

A submitted consolidation cannot be changed. Tell the lead: they can start a new consolidation on the text, which can include yours as one of the submissions. See [Finish a consolidation](consolidator.md#finish-a-consolidation) and [Accept a consolidation](lead-results.md#accept-a-consolidation).

### "Could not add the finding. Nothing changed."

The finding was not saved, for example because the connection dropped. Reload the page and add it again. If it keeps failing, tell your lead. See [Add a finding everyone missed](consolidator.md#add-a-finding-everyone-missed).

### The consolidation asks me to "Check before you submit"

The result has findings with values filled in by default, modifier terms used as findings, or modifier warnings. Check them; if they are correct, submit with the warnings. See [Finish a consolidation](consolidator.md#finish-a-consolidation).

## Leading a project

### I cannot accept a result

In projects where the consolidator of a text may not be one of its annotators, you cannot choose a result you made yourself. Another lead must choose it. See [Accept a result or compare results](lead-results.md#accept-a-result-or-compare-results).

### My uploaded texts do not show up

An import runs in the background; reload **Documents** when it is done. If the project plan for new imports is **Plan nothing; I plan texts on Documents**, the new texts show as *Not decided* until you plan them. See [Upload texts](lead-documents.md#upload-texts).

### The upload says "The file name is not a valid text ID."

For plain text, each file name without `.txt` becomes the text ID. Rename the file: letters, digits, dots, hyphens and underscores, up to 128 characters, starting with a letter or digit. See [Prepare files for upload](lead-documents.md#prepare-files-for-upload).

### I cannot change the ontology release or the task profile

The ontology release can be chosen freely only until the first work is submitted; after that, use **Move to another release**. The task profile can only be replaced before work starts, and only by a file with the same ontology ID as the project (upper and lower case count as the same) and the checksum of the chosen release. See [Move a started project to a newer release](lead-settings.md#move-a-started-project-to-a-newer-release) and [Replace the task profile](lead-settings.md#replace-the-task-profile).

### I uploaded a translation file, but term searches do not use it

The project froze its translations at the first use of its ontology. A later file reaches it only when a lead clicks **Use the newest translations** under **Settings**, tab **Ontology**, card **Translations**. Findings do not change. See [Use the newest translations](lead-settings.md#use-the-newest-translations).

### My bundle is refused: the ontology settings do not match

The check names, per text, what the bundle uses, what the project uses and who can change it: a lead changes the release, branches or annotation scheme under **Settings**, tab **Ontology**; the ontology ID of a project cannot change. See [What must match a bundle](lead-settings.md#what-must-match-a-bundle).

### A text has no assign button

The text is not in the work plan. Plan it first. See [Add a text to the plan](lead-documents.md#add-a-text-to-the-plan).

### A task is still paused after I closed the report

Closing a report does not always release the pause. The row shows **Resume task…**; click it and release the pause. See [Decide on a problem report](lead-results.md#decide-on-a-problem-report).

### I chose myself as consolidator: where do I work?

While your consolidation runs, **Open consolidation** in the text card opens your task, as does **Open my task** in the row on **Documents** or the row in **My tasks**. After you submitted, **Open consolidation** shows the read-only result. See [Start a consolidation](lead-results.md#start-a-consolidation).

### The consolidator list does not show a person

Only you and the members with the **Consolidator** role are listed; the hint under the list says so and links **Settings → People**. Give the role first. See [Change a member's roles](lead-settings.md#change-a-members-roles).

### The export asks me to tick a box

Some texts still need your decision or have no final result. Either decide them in **Documents** first, or tick the box to export the ready results and leave the others out. See [Export final results](lead-results.md#export-final-results).

### I cannot remove a lead

A project needs at least one lead. Add another lead first, then remove the role. See [Change a member's roles](lead-settings.md#change-a-members-roles).

### "Save changes" is disabled in the settings

Nothing has changed yet. The button turns on as soon as you edit a field. **People** and **Guidelines** save on their own and have no save button. See [Open project settings](lead-settings.md#open-project-settings).

## Administration

### I cannot close the setup-code dialog

Tick **I have handed over or stored the code** first. The code is shown only once. See [Hand over a setup or reset code](admin.md#hand-over-a-setup-or-reset-code).

### "You cannot remove your own administrator role."

This protects you from locking yourself out. Another system administrator must do it; you also cannot deactivate yourself. The last active system administrator always keeps the role. See [Edit a user's profile and administrator role](admin.md#edit-a-users-profile-and-administrator-role).

### An ontology upload is refused

The file could not be read, is too large, or is an incomplete HPO release. Read the detail below the message and upload a complete release. See [Upload ontology releases and translation files](admin.md#upload-ontology-releases-and-translation-files).

### A user sent a technical report

Open **Administration** › **Technical reports**. Mark it as done when it is handled. Reports are not sent anywhere; copy one into an issue by hand and leave out clinical content. See [Handle technical reports](admin.md#handle-technical-reports).

### The administrator lost the password

This is fixed on the server, not in the app. See [Lost admin password](../operations.md#lost-admin-password) in the server operations guide.
