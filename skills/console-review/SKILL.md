---
name: console-review
description: Use the migration-eval-app console to submit a capstone package, follow a graded run, read what a check's mark means, and answer the items it hands to a person. Use when someone asks "how do I upload a submission", "how do I check on a run", "what does this mark mean", "how do I answer this", or needs the reviewer's side of grading rather than the operator's `submission-intake` command. Covers the four screens in order: starting a submission, checking status, reading marks, and answering open items — and what a reviewer may not do.
---

# Console Review

Live at **https://migration-eval-app.wf.app**, behind Webflow SSO. This is the console's
own copy of `USAGE.md`, kept here so the reviewer-facing half of the tooling is findable
the same way the operator-facing half already is — see `submission-intake/`, its sibling.

The console also renders this same text at `/usage`, from
`migration-eval-app/src/content/usage.md`. That file is the one to edit; this one is the
one to keep in sync with it.

---

## What this tool is for

When a partner delivers the capstone for the AI assisted migration course, the console
grades it against the program's standard and issues assessments for every gate.

```
  the partner's live build ─┐
                            ├─►  an agent grades what it can
  the submission files ─────┘                   │
                                                │
                     ┌──────────────────────────┴──────────────────────────┐
                     ▼                                                     ▼
     settled without human involvement                     human is looped in when necessary
                     │                                                     │
                     └──────────────────────────┬──────────────────────────┘
                                                ▼
                                      Pass or Fail, with a
                                     written basis behind it
```

The goal is to reduce the amount of time and subject matter expertise needed to grade
partner's submissions, allowing us to certify more partners.

---

## 1 · Start a submission

Go to **New submission**.

Please note: the assumption is made that the agency transferred the site to
diego.rangel@webflow.com, where it is then added to the AI migrations Webflow Workspace,
prior to the steps below.

**The package.** Drag in the folder the partner delivered.

**The agency.** Type the agency name and click **Find the site**. It is matched against
the site names in the workspace. If the name does not match, you get the list to pick
from.

**The upload.** Click **Upload the documents**. Files go up in batches and the manifest is
written last. Nothing is being graded yet, and if the upload stops partway it is safe to
just run it again.

**What the package establishes.** The tool reads the uploaded package back and lists which
of the eleven required artifacts it found. Check this before continuing:

- Anything listed as **unclassified** will not be read by any check. Usually a naming
  problem. You can rename and re-upload, or start anyway and accept it.
- If artifacts are missing, the run will stop at completeness and hand the package back
  **unreviewed**. Nothing gets graded.

Leave the rubric commit as prefilled unless you have a reason to pin an older one, then
click **Start the run**.

Grading can take up to an hour and runs in the background, you can close the tab.

The CLI route to the same result is `submission-intake/`, which does this from a terminal
in one command instead.

---

## 2 · Check the status of a run

| Page | Answers |
| --- | --- |
| **Dashboard** | How is each agency doing? One row per agency, showing the latest attempt |
| **Review queue** | What needs me right now? Every open item across every run |
| **Runs** | Where is a specific run? Every run across all partners will be shown here |

The number badge next to **Review queue** in the top nav is how many items are waiting on
a person. When it is empty, nothing needs you.

The dashboard tabs filter on the attempt the row is showing, so the tab you clicked and
the badge on the row always agree:

- **Errored** — the run stopped or was terminated due to an issue with the tool
- **Waiting on a person** — an item is open and requires human attention
- **Running** — the agent is still working
- **Complete** — the run finished
- **Returned unreviewed** — handed back at completeness, nothing graded

---

## 3 · Read the marks

Every check returns a mark, and the run page has a **Reading the marks** panel with these
same definitions if you need them in context.

| Mark | Label | Means |
| --- | --- | --- |
| green fill | Satisfied | The agent concluded the requirement is met |
| red fill | Not satisfied | The agent concluded the requirement is not met |
| green fill | Answered by the agent | The agent answered every question here itself. No person read it |
| green fill | Answered by a reviewer | A person answered, with their name on the record |
| orange ring | Needs a ruling | Readable more than one way. Only a person may choose |
| grey ring | Needs access | The agent could not reach the evidence |
| blue | Running | Being worked on now |
| grey | Not run | Not reached yet |

Two things worth knowing about these:

**Green does not always mean the build is good.** *Answered by the agent* means a question
got closed without a person — it fixes how the check is read and claims nothing about the
partner's work. *Satisfied* is the one that says the requirement is met.

**Orange is not an error.** It means the evidence supports more than one reading and
picking between them is a judgment call, which is yours to make. Grey means the agent
could not get at the evidence at all — that is usually about access or a missing file, not
about the submission being bad.

A run has four steps: completeness, then the four critical gates, then the five domains,
then the result. Step one gates everything. If the package is incomplete, nothing after it
runs.

---

## 4 · Answer what the run is waiting on

Open the run. Links at the top of the page jump straight to each thing that needs you. Each
one is a card headed **The run is waiting on this**.

Read these in order:

1. **The subject and question.** What is being asked, and about which check.
2. **To unblock.** The one instruction — the single action that clears this. If it says to
   fetch or supply something, that is the whole job and you may not need to make a judgment
   at all.
3. **Under review.** Links to the partner's Designer and live build, where they exist. Open
   them. You are ruling on their work, not on the text of the question.

Then fill in two fields:

**What this answer records.** Pick the sentence that is true of the submission. These are
claims, not yes/no — "the submission meets what this check asks for", not "yes". That is
deliberate: the questions are generated per run and their wording flips, so an answer that
was assent would mean different things on different runs.

**Why.** Your reasoning. Stored word for word and read by whoever audits the run later. It
does not have to answer the question in the question's own words.

A **Result** dropdown appears only on the last open item, once nothing else on the run is
outstanding. You cannot issue a Pass or Fail while other items are still open.

**Submit answer** records it under your SSO identity — there is no name field, because a
typed name is not evidence of who typed it. The page then moves you to the next open item,
or shows you the finished verdict if that was the last one.

---

## Things you cannot do, on purpose

- **Re-answer what the agent settled.** Those are closed. If you think one was read wrong,
  that is a calibration finding, not a re-answer.
- **Set a precedent.** If a partner did something novel and no earlier ruling covers it,
  the run hands it to a person rather than deciding. Your ruling on it becomes the
  precedent for everyone after.
- **Issue a result early.** The control is not offered until the run has nothing else open.

## When something looks wrong

Use the **Help** page. It reports console problems, sends feedback, and asks how a grading
rule should be applied. If you came from a run, the reference is carried over for you.

If a check looks wrong rather than the console, say so through Help rather than answering
around it — a grading rule that is miscalibrated should be fixed once for everybody, not
worked around on each run.
