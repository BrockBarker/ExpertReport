# Expert Report

A Mac app for arborist expert reports. Each case is a real folder that holds its photos, emails, documents, notes and reports. A case can carry a tree appraisal (9th or 10th edition of the Guide for Plant Appraisal), a tree risk assessment and tree preservation recommendations, and the report itself is written in the app: a first version is built from the case (optionally drafted by Claude from the photos, emails and notes), edited on a page in the Report tab, and exported as a PDF or opened in Pages.

## How a case is laid out on disk

    <cases folder>/<case name>/
        Photos/  Emails/  Documents/  Field notes/  Notes/  Reports/   the user's own files; the app copies files in and never alters them
        Case data/case.json                                           the app's record of the case
        Case data/appraisal-<id>.json                                 an appraisal filed in the case
        Case data/report.json                                         the written report (the document, the version before the last rebuild, questions from the draft)
        Removed files/                                                where a file goes when it is removed in the app

The user chooses the cases folder the first time they start a case. Anything dropped into a case folder in Finder shows up in the app.

## Where things are

- `app/` the app itself: one page with plain scripts, so it runs from a file, a local server or the Mac wrapper.
  - `js/engine.js` the appraisal math (no screen code). `js/report.js` tables, method wording, checks, CSV. `js/docx.js` the Word file writer.
  - `js/ui.js` the screens. `js/host.js` the bridge to the Mac app or the preview server. `js/seed.js` is generated; do not edit it.
  - `js/cases.js` case list and case tabs. `js/risk.js` the risk matrices. `js/zones.js` protection zone arithmetic. `js/preserve.js` the Preservation tab and its recommendations. `js/casereport.js` the report as a document: the starting outline, the blocks that come from other tabs (cover, tables, signatures, photo pages), the checks, the Word export, and the page that is printed to a PDF, including the step that cuts it into pages. `js/write.js` the Report tab: the editor, drafting with Claude, the exports and the key settings.
- `data/` the checked source data: Louisiana species factors and nursery price sheets. `dev/make-seed.py` turns these into `app/js/seed.js`.
- `mac/` the Mac wrapper (`main.swift`), its icon and `build.sh`.
- `dev/` the preview server (which stands in for Claude with a made-up draft and sends nothing), the math tests and their fixtures, and `test-ai-client.py`, which runs the app's drafting client against a stand-in for the Claude API on this Mac.
- `prototype/` and `handoff-test/` the first Pages hand-off experiments.

## Build, run, test

    ExpertReport/mac/build.sh                         # builds ExpertReport/build/Expert Report.app
    open "ExpertReport/build/Expert Report.app"

    # install or update the copy in Applications (quit the app first)
    ditto "ExpertReport/build/Expert Report.app" "/Applications/Expert Report.app"

    # math tests (93 checks, including a 143-row hand-worked table)
    /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc \
        ExpertReport/app/js/engine.js ExpertReport/dev/fixtures/vestal-prelim-table.js ExpertReport/dev/test-engine.js

    # the Mac app's own checks; neither touches real data or the clipboard
    "ExpertReport/build/Expert Report.app/Contents/MacOS/ExpertReport" --selftest
    EXPERT_REPORT_DATA_DIR=/some/temp/folder EXPERT_REPORT_CASES_DIR=/some/temp/cases EXPERT_REPORT_TEST_FILES=ExpertReport/dev/fixtures/sample-files \
        "ExpertReport/build/Expert Report.app/Contents/MacOS/ExpertReport" --uitest /some/output/folder

    # risk and protection zone arithmetic (65 checks)
    /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc \
        ExpertReport/app/js/risk.js ExpertReport/app/js/zones.js ExpertReport/dev/test-case-engines.js

    # the same trees under each edition and method (19 checks)
    /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc \
        ExpertReport/app/js/engine.js ExpertReport/app/js/report.js ExpertReport/dev/test-compare.js

    # the drafting client, against a stand-in server on this Mac (30 checks; no key, nothing leaves the machine)
    python3 ExpertReport/dev/test-ai-client.py

Preview in a browser with the `expert-report` launch configuration (`python3 ExpertReport/dev/serve.py 8830`). The preview keeps its data in `dev/.data`, separate from the real app.

## Drafting with Claude

The Report tab can ask Claude for a first draft. The request goes straight from the Mac app to the Anthropic Messages API over HTTPS (`mac/main.swift`, `AIClient`; there is no official Swift SDK, so it is a plain streaming request). The user's API key is typed into Settings and kept in the login keychain (service `com.davidbarker.ExpertReport`), never in the app's files. The page describes what to send; the Mac side reads the photos and PDFs itself, and only from inside the open case folder. Before anything is sent the user sees a list of exactly what will go.

The request uses structured output (letter, one text per section, photo captions, field note transcriptions, questions), effort `high`, and `fallbacks: "default"` so that a request a safety filter declines on the chosen model is retried on another in the same call; an account without that feature is retried without it. The instructions tell the model to write only what the case material supports, to leave the arborist's observations and opinions as [bracketed gaps] with matching questions, and to cite nothing that is not in the material. The live call has only been tested against the stand-in server, never against the real service.

## Comparing editions and methods, and reading trees from field notes

An appraisal's Results tab can tick any of four approaches (9th edition Trunk Formula Method and Replacement Cost Method, 10th edition Trunk Formula Technique and direct replacement). `Engine.compare` values every tree under each from the same measurements without changing the appraisal; the report gets a comparison table (`compare:<id>` block) and a full worksheet for each approach in the appendix. While a comparison is ticked, the Trees tab shows the other edition's rating columns too.

On a case's Appraisal tab, "Read the trees from field notes and photos" sends the field note pages, typed notes and photos to Claude and puts the trees it lists (number, species, diameter, any written condition rating, remarks) into an appraisal table. It is told never to estimate a trunk diameter or height from a photograph, and doubtful readings are marked in the Note column. Ratings the notes do not give are guessed and flagged (see the next section).

## Trees table, location rating and base price

The 9th edition trees table shows Species %, Condition % and one Location % that is typed in directly. The species rating belongs to the species, so editing it in any row changes it for every tree of that species (the cell sits in a `data-scope="species"` cell inside the tree row). Appraisals made when the location rating was the average of site, contribution and placement are converted the first time the app loads them (`migrate` in `ui.js`, `Engine.oneLocation(a, true)`): the average goes into the location rating at full precision, so no value changes, the three figures stay in the file, and `locOne` marks the appraisal as done. Setup can still switch an appraisal back to the three columns.

On the Species and costs tab each replacement tree shows its price per square inch, and "Choose from a price sheet" lists the price sheet rows with their price per square inch and a "Use as base price" button. The base price is the replacement row marked `base` (the largest when none is marked); it sets the unit cost and, in the 9th edition, the installed replacement cost in the basic tree cost.

## Method options and the automatic first appraisal

A new appraisal works out at once. `addSpecies` in `ui.js` fills a species with every price sheet row that names exactly that species (`sheetMatches`: every word of the common or scientific name must appear in the row's name and category) and marks the largest size not flagged limited as the base. New appraisals start with condition and location at 70% (`START`), recorded in `a.guess`; the field-note reader also returns `condition_guess`, `location_guess` and `rating_basis` for each tree, stored on the tree with `t.guess`. Guessed cells are shaded on the Trees tab, listed in the checks, and become the arborist's own when typed over or kept ("Keep these as my ratings"). A trunk diameter is still never estimated from a photograph.

The "Method options" tab shows, for each species, what its trees total under each choice (`Engine.options`): replacement cost with every tree at one listed size (`r<i>`), trunk formula with that size as the base price (`f<i>`), the mixed rule (`auto`), nearest listed size (`near`) and trunk formula from a typed-in unit cost (`fm`). Clicking a figure calls `Engine.choose`, which sets `sp.method` and the `base` or `fixed` flag on the replacement row. A tree left on Auto follows its species; a tree with its own method keeps it. A species no price sheet lists gets a list of comparable trees instead (`comparables`: priced trees sharing a word with its name or category, such as the other oaks for a water oak, or every priced tree when nothing is shared). On the Method options tab each one shows what the trees would come to, and clicking a figure adds that tree to the species and uses it (`opt-adopt`); the Species and costs tab shows the same list with "Use as base price". The method statement changes its wording when a method or base price was chosen instead of the usual rule.

## The assistant

`js/agent.js` is a panel (the "Assistant" button in the corner) with a text box. Each request runs a tool-use loop against the Messages API: the page sends the whole conversation and its tool list through the `aiTurn` host call, the Mac side streams the answer and hands back the message's content blocks exactly as sent (thinking blocks with their signatures included, so they can be passed back unchanged on the next turn), and the page runs the tools Claude asked for. The tools read the case (`look`, `read_file`, `view_image`) and change it (`update_case`, `update_file`, `update_trees`, `remove_trees`, `update_appraisal`, `update_species`, `update_costs`, `write_section`, `update_risk`, `update_preservation`, `go_to`). It cannot delete files, export, change settings or reach anything outside the app. Tool inputs are checked against their schemas before they run; every change is listed in the panel, and the changes from the last request can be undone in one step (a snapshot of the case, its appraisals and the report taken before the request). The preview answers with a rule-based stand-in.

The panel can be dragged by its title bar (double-click the bar to send it back to the corner). Its place is kept while the app is open, and the title bar cannot leave the window.

The panel can also leave the main window. The button beside Close in its title bar opens a second Mac window (`AssistantWindow` in `mac/main.swift`, a floating panel that stays above the main window, hides while another app is in front, and remembers where it was left) showing `assistant.html`. That page (`js/assistant.js`) only draws and listens: `agent.js` in the main window stays in charge, sends it what to show through the `agentWindow` host call (`paint`, `live`, `value`, `focus` messages), and gets back what was clicked or typed through `window.__agentRemote`. Dragging the panel by its title bar until the pointer reaches the edge of the main window does the same thing: the page passes where the panel was being held (`grab`), and the Mac side keeps the new window under the pointer, held by its title bar, until the mouse button is let go (`follow`, a timer that reads the pointer). "Put back in the main window" docks it again; closing the window with its own close button closes the assistant. The choice is kept in the settings (`agentOut`), so the Assistant button opens the separate window next time. In the preview the two pages talk over a BroadcastChannel and the window is a browser window. The UI test opens the real window off screen and types, sends, docks and closes through it.

The panel also has a microphone button. The Mac side (`Dictation` in `mac/main.swift`) uses Apple's Speech framework: on-device where the Mac supports it, otherwise through Apple's servers, which the panel says the first time. Words appear in the text box as they are heard; listening ends after about three seconds of silence or a second click, and nothing is sent to the assistant until the user presses Send. `Info.plist` carries the microphone and speech recognition usage descriptions. None of this can be exercised by the automated tests, which only check the text-box behaviour with made-up speech.

## The PDF

"Export PDF" prints the report page to Letter paper from an off-screen web view and then stamps the logo, the short title and "Page X of Y" on every page. The print engine does not keep headings with their text or table rows in one piece, so the page cuts itself into pages first (`paginate` in `casereport.js`): long tables split between rows with the header repeated, lists between items, paragraphs between lines. The export reports both the pages it planned and the pages printed; they should always match.

## Data

The app keeps everything in `~/Library/Application Support/Expert Report`: one file per appraisal, the price sheets, the species ratings and settings. Deleting something in the app moves its file to a `Removed` folder there instead of erasing it.

## Method notes

The formulas are the published ones and the wording is original. Nothing here reproduces text from the Guide, and the on-screen worksheet asks the user to check each step against their own copy.
