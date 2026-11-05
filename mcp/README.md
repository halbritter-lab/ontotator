# Ontotator MCP server

`ontotator-mcp` lets an MCP client, such as Claude Desktop or Claude Code, set up and run an [Ontotator](../README.md) project for you: upload ontologies, create a project, import texts and machine proposals, assign people, follow progress and agreement, accept agreeing results and download exports. It runs on your computer, speaks MCP over stdio and calls the HTTP API of your Ontotator instance with an [API token](../docs/operations.md#api-tokens).

What it does not do: annotation, review and translation review stay in the web interface. No tool reads or writes annotators' drafts or submissions, and the server refuses such routes to every API token anyway.

## Install

You need [uv](https://docs.astral.sh/uv/). Install the command from the repository:

```bash
uv tool install "git+https://github.com/halbritter-lab/ontotator#subdirectory=mcp"
which ontotator-mcp
```

From a checkout, `uv tool install ./mcp` does the same. Without installing, `uvx --from "git+https://github.com/halbritter-lab/ontotator#subdirectory=mcp" ontotator-mcp` runs it directly.

## Create a token

Create a token in Ontotator with only the scopes you need (see [Scopes](#scopes)):

- **Project token** (Settings › People › **Project API tokens**, leads): works in one project only and acts as you. Best for day-to-day project work. It cannot list projects or ontologies, because those routes are not part of a project; `whoami` then names the token's project.
- **Personal token** (Profile › **API tokens**): acts as you in every project you are a member of.
- **System token** (**Server settings** › **API tokens**, administrators): the only kind with the `admin` scope, for ontology and translation uploads, new projects and the user list.

The token is shown once. Store it like a password: the MCP client keeps it in its configuration file in plain text, so prefer a project token with a short lifetime and revoke it when the work is done.

## Configure

| Variable | Meaning |
| --- | --- |
| `ONTOTATOR_URL` | Address of the instance, for example `https://ontotator.example.org`. Plain `http` is accepted only for `localhost` and loopback addresses, or for another host with `ONTOTATOR_ALLOW_HTTP=1`. |
| `ONTOTATOR_TOKEN` | The API token (`ott_...`). It is sent only as `Authorization: Bearer` to `ONTOTATOR_URL`, never logged, never part of a tool result, and not sent again after a redirect. |
| `ONTOTATOR_ALLOW_HTTP` | `1` allows plain `http` to another host, for a trusted network only. |
| `ONTOTATOR_TIMEOUT` | Seconds per HTTP request (default 60). |
| `ONTOTATOR_JOB_TIMEOUT` | Seconds a tool waits for an import or export job (default 900). |
| `ONTOTATOR_MCP_FILES_DIR` | Required for local files. The folders the tools may read local files from and write downloads to, as absolute paths (or starting with `~`), several separated by `:` (`;` on Windows). Unset, the server still starts, but every tool that reads or writes a local file refuses; the other tools work. |

### Local files

Some tools read a file from your computer and upload it to Ontotator: `upload_texts`, `upload_ontology_files`, `publish_guideline`, and `create_project` and `set_task_profile` with `profile_path`. `download_export` and `download_project_archive` write a file on your computer. Their descriptions say so, paths must be absolute (or start with `~`), and each result names the absolute path it read or wrote (`local_files`, or `path` for a download).

These tools need `ONTOTATOR_MCP_FILES_DIR`, set to the folders that hold your Ontotator files, for example `~/ontotator`. Without it they refuse and name the variable; the tools without local files work as before. A model that follows instructions hidden in a text, a guideline or a web page could otherwise be talked into uploading a file you did not mean to share, such as a key or a password file. The server resolves each path (following symbolic links) and refuses any file outside these folders, for uploads and downloads alike. Keep only Ontotator files there, and check the paths in the client's tool calls before you approve them.

### Claude Code

```bash
claude mcp add ontotator \
  --env ONTOTATOR_URL=https://ontotator.example.org \
  --env ONTOTATOR_TOKEN=ott_your_token \
  --env ONTOTATOR_MCP_FILES_DIR="$HOME/ontotator" \
  -- ontotator-mcp
```

Add `--scope user` to use it in every folder. `claude mcp list` shows whether it started.

### Claude Desktop

Add the server to `claude_desktop_config.json` (Settings › Developer › **Edit Config**) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "ontotator": {
      "command": "ontotator-mcp",
      "env": {
        "ONTOTATOR_URL": "https://ontotator.example.org",
        "ONTOTATOR_TOKEN": "ott_your_token",
        "ONTOTATOR_MCP_FILES_DIR": "/Users/you/ontotator"
      }
    }
  }
}
```

If the client cannot find the command, give its full path (`which ontotator-mcp`), or use `"command": "uvx"` with `"args": ["--from", "git+https://github.com/halbritter-lab/ontotator#subdirectory=mcp", "ontotator-mcp"]`.

Ask the client to call `whoami` first: it shows who the token acts as and the server's version.

## Tools

Every tool description names the token scope it needs and whether it changes data; the MCP annotations say the same (`readOnlyHint`, `destructiveHint`, `idempotentHint`). Tools with a `confirm` argument (`set_ontology_pins`, `distribute_texts`, `update_work_plan`, `accept_agreeing_texts`, `set_member_roles`) only do a dry run without it (`set_member_roles` needs `confirm` only to take roles away or remove a person, which logs the person out, revokes their tokens and, with `revoke_assignments`, withdraws their open tasks; adding roles is applied at once); the client should show you the dry run before it confirms. Imports and exports are server jobs: the tools wait for them by default, and `get_job` polls one.

### Scopes

A token can do only what both its scopes and its owner's roles allow. Many tools also need `read`, because they read the project before they act. Polling a job (`get_job`, and the tools that wait for their import or export) works with any of `read`, `import` and `export`, so `import` alone can stage and import texts and `export` alone can start and download exports.

| Tool | Token scopes | Effect | What it does |
| --- | --- | --- | --- |
| `whoami` | read | reads | Who the API token acts as, and the server's version and address. |
| `list_projects` | read | reads | The projects the token's owner is a member of, with roles and text counts. |
| `list_ontologies` | read | reads | Ontology releases on the server with their SHA-256 and translations. |
| `list_ontology_files` | admin | reads | Every uploaded ontology and translation file, with the projects using it. |
| `upload_ontology_files` | admin | adds | Upload ontology releases (OBO Graph JSON) or Babelon translation files (.tsv). |
| `list_project_templates` | read | reads | Project templates (ready task profiles) and the ontologies each needs. |
| `create_project` | admin | adds | Create a project from a template or a task profile. |
| `get_project_settings` | read | reads | A project's settings: name, languages, rules, task profile and pins. |
| `update_project_settings` | project-admin | overwrites | Change project settings; fields not named keep their value. |
| `set_task_profile` | project-admin | overwrites | Replace the project's task profile (layers, annotation types, value axes). |
| `set_ontology_pins` | project-admin | may remove or withdraw | Pin the project to ontology releases, after a dry run. |
| `refresh_translations` | project-admin | overwrites | Move the project to the newest translation files on the server. |
| `publish_guideline` | project-admin | adds | Publish a new version of the project's annotation guideline. |
| `upload_texts` | import | adds | Stage texts or a proposal bundle and check them; imports nothing yet. |
| `get_upload` | import | reads | The state and check of one staged upload. |
| `list_uploads` | import | reads | The project's staged and committed uploads. |
| `commit_upload` | import | adds | Import a checked upload: texts, translations and proposals enter the project. |
| `discard_upload` | import | may remove or withdraw | Drop a staged upload that was not imported; imported texts stay. |
| `list_people` | read | reads | Project members with roles, languages and open tasks. |
| `list_users` | admin | reads | Every user account of the server with projects and languages. |
| `set_member_roles` | read, project-admin | may remove or withdraw | Set a person's roles in the project (adds the person if new). |
| `assign_texts` | project-admin | adds | Assign text versions to people, one task per row. |
| `distribute_texts` | read, project-admin | adds | Assign many texts of one language at once, after a dry run. |
| `update_work_plan` | read, project-admin | may remove or withdraw | Turn translation review and annotation on or off and set the annotation mode. |
| `project_overview` | read | reads | Where a project stands: settings, totals per stage, people and open decisions. |
| `get_progress` | read | reads | Assignment progress per text version and per person (open, in progress, submitted). |
| `working_time_summary` | read | reads | Recorded working time per annotation mode: texts, total and median per text. |
| `list_texts` | read | reads | The project's texts with IDs, stage, assigned people and final result. |
| `agreement_summary` | read | reads | Agreement of the submitted annotations per text, as the lead's panel shows it. |
| `start_consolidation` | read, project-admin | adds | Start a consolidation of a text's submissions by a consolidator. |
| `accept_agreeing_texts` | read, project-admin | adds | Accept the result of every text whose annotations agree in full. |
| `final_export_check` | read | reads | What a final export would contain now: accepted results, warnings, omissions. |
| `start_export` | export | adds | Start an export job of the project; download it with download_export. |
| `get_job` | read or import or export | reads | The state of an import or export job: queued, running, succeeded or failed. |
| `download_export` | export | writes a local file | Download the file of a finished export job to a local path. |
| `export_project_archive` | admin | adds | Start the archive of one complete project; fetch it with download_project_archive. |
| `download_project_archive` | admin | writes a local file | Download the ZIP of a finished project archive job to a local path. |

Useful token sets: a project token with `read`, `import`, `export` and `project-admin` covers everything a lead does; `read` is enough for status, `export` alone for exports and downloads; ontology uploads, new projects, the user list and project archives need a system token with `admin` (and `read`).

### Resources

| URI | Content | Scope |
| --- | --- | --- |
| `ontotator://projects/{project}/settings` | The project's settings, task profile and pins (JSON). | read |
| `ontotator://projects/{project}/guideline` | The text of the current annotation guideline. | read |
| `ontotator://jobs/{job_id}/readme` | `README.txt` of a finished final export, which explains every file and column. | export |

### Errors

A refusal of the API becomes a tool error with the HTTP status, the API's code and text, and what to do. The common codes:

| Code | Meaning |
| --- | --- |
| `TOKEN_INVALID` | The token is unknown, expired or revoked. |
| `TOKEN_SCOPE_MISSING` | The token lacks the scope the route needs; the message names it. |
| `TOKEN_NOT_ALLOWED` | A browser-only route, or a project token outside its project. |
| `NOT_ALLOWED`, `ADMIN_REQUIRED` | The token's owner lacks the role. |
| `PROJECT_BUSY` | The project is busy and nothing changed; try again. |
| `REVISION_CONFLICT` | Someone changed the same thing meanwhile; read again and repeat. |

## Worked example: a Phentrieve proposals project

This example sets up an HPO annotation project in which annotators check the HPO terms that [Phentrieve](https://github.com/halbritter-lab/phentrieve) proposed for a set of clinical texts. It assumes an Ontotator instance at `https://ontotator.example.org`, an Ontospan bundle `phentrieve-bundle.zip` holding the texts and Phentrieve's proposals (written with the Ontospan tools), and an HPO release `hp.json` with its German translation `hp-de.babelon.tsv`, all in `~/ontotator` with `ONTOTATOR_MCP_FILES_DIR=~/ontotator`. The prompts are what you type into the client; the tools it calls are named after each.

1. **Ontology and project** (system token with `read` and `admin`).
   *"Upload ~/ontotator/hpo/hp.json and ~/ontotator/hpo/hp-de.babelon.tsv to Ontotator, then create the project `phentrieve-pilot` named 'Phentrieve pilot' with the HPO template, languages en and de, pinned to the HP release you just uploaded."*
   `upload_ontology_files`, `list_project_templates`, `create_project`. You become the project's lead. Upload translations before anyone works in the project: its first term search freezes the translations it uses.
2. **Switch to a project token.** In Settings › People › **Project API tokens**, create a token for `phentrieve-pilot` with `read`, `import`, `export` and `project-admin`, and restart the client with it.
3. **Settings, guideline and people.**
   *"Set two annotators per text, publish ~/ontotator/pilot/guideline.md as the guideline, and give alice and bob the annotator role and carla the consolidator role."*
   `update_project_settings` (`{"annotations_per_text": 2}`), `publish_guideline`, `set_member_roles` (consolidator is the role `adjudicator`).
4. **Import the proposals.**
   *"Check ~/ontotator/pilot/phentrieve-bundle.zip as an Ontospan bundle and show me the result."* `upload_texts` stages and checks the bundle: cases, texts, proposals, problems and the planned work. *"Import it."* `commit_upload` imports exactly what was checked.
5. **Work plan and assignments.**
   *"Annotate the English texts from the proposals and give every text to alice and bob. Show me the dry run first."*
   `update_work_plan` (`annotation_mode: proposals`) and `distribute_texts` (`mode: each`), each first without and then with `confirm`.
6. **Annotation** happens in the browser: alice and bob confirm, change or reject each proposal.
7. **Status.** *"How far is phentrieve-pilot, and where do alice and bob disagree?"* `project_overview`, `get_progress`, `agreement_summary`.
8. **Results.** *"Accept every text where both agree; show me the list first. Start a consolidation by carla for the others."* `accept_agreeing_texts` (dry run, then `confirm`) and `start_consolidation` per text. Carla consolidates in the browser, and the lead accepts the consolidations on the Documents page.
9. **Export.** *"Check the final export, then export it and save it to ~/ontotator/pilot/final.zip."* `final_export_check`, `start_export` (`kind: final`; warnings and texts without a result must be acknowledged), `download_export`. The archive holds `index.csv`, the selected results as Ontospan bundles and the tables `findings.csv`, `agreement.csv` (agreement of every two annotators per text), `agreement-summary.csv` and `proposals.csv` (how each tool's proposals fared). Its README is the resource `ontotator://jobs/{job_id}/readme`. The same accepted results as GA4GH Phenopackets (derived, lossy) are `kind: phenopackets`. The edit log (`kind: edit_log`), the working time (`kind: work_time`) and the translation reviews (`kind: translation_reviews`) export the same way.

## Not reachable with a token

Routes a token may not call (`session` in the contract), so no tool can offer them:

- Lead corrections of translations (`POST .../documents/{doc}/lead-correction`), and annotation, review and translation review work in general.
- Marking a guideline version as read, a problem report as seen, and a visit of the Documents page.
- Creating, listing and revoking tokens.
- Undo, redo and reset in the editor, and importing a project archive (it creates a project and accounts).

Limits of the token kinds:

- A project token reaches only routes with its project in the path (and the job routes), so `whoami`, `list_projects`, `list_ontologies` and `list_project_templates` need a personal or system token.
- Creating a project needs the `admin` scope, so a system token: a lead cannot create a project with a token.
- The API gives agreement per text (the lead's comparison panel) but no project-wide figure; `agreement_summary` sums the panels.

Left to the web interface on purpose, although a token could call the route: choosing a final result among differing submissions or confirming one after a change (`PUT .../final-selections`; `accept_agreeing_texts` covers full agreement only), handling problem reports, reopening, reassigning and revoking single tasks, and changing the annotation mode of a text that already has work, which discards its submissions.

## Development

```bash
cd mcp
uv sync --locked
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run pytest
```

The unit tests answer every route with a fake API whose bodies follow the committed contract (`../contracts/openapi.json`), and check that each tool names exactly the scopes (`x-ontotator-scope`) of the routes it calls. The integration test starts the real application in the main project's environment against a throwaway PostgreSQL server and runs a project through setup, import, status and exports:

```bash
ONTOTATOR_TEST_PG_URL=postgresql+psycopg://postgres@127.0.0.1:5432/postgres uv run pytest -m integration
```

It is skipped without `ONTOTATOR_TEST_PG_URL`. It creates and drops only its own databases.
