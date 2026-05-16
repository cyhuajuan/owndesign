# HJDesign

HJDesign is a local-first design agent tool for managing design projects and agent conversations. It exists to help a user organize project work, run design-oriented conversations, and persist working state on the local machine.

## Language

**Workspace**:
Root local storage for all HJDesign data under `~/.hjdesign`.
_Avoid_: data dir, app folder, cache

**Project**:
A design project container that groups related conversations and project-level state.
_Avoid_: folder, workspace, chat group

**Conversation**:
A single agent conversation thread that belongs to exactly one Project.
_Avoid_: session, standalone chat, tab

**Active Conversation**:
The one Conversation currently in focus inside a Project.
_Avoid_: open tab, selected chat without semantics

**Conversation Title**:
The human-readable label for a Conversation, auto-generated from the first user message unless manually edited.
_Avoid_: fixed slug, opaque id

**Message**:
A single utterance inside a Conversation.
_Avoid_: event, chunk, run item

**Settings**:
Workspace-level user preferences and AI configuration shared by all Projects and Conversations.
_Avoid_: project config, conversation-only preference, env-only config

**Interface Language**:
The user-selected language used by HJDesign interface chrome and settings UI.
_Avoid_: model output language, locale inferred only from browser

**Supported Interface Language**:
An allowed Interface Language value. First version supports `zh-CN` and `en-US`.
_Avoid_: free-form locale string, untranslated placeholder locale

**AI Model Configuration**:
One reusable provider-backed model entry stored in Settings, including provider, model, base URL, and API key.
_Avoid_: one-off request override, project-scoped secret

**AI Model Label**:
The display text shown for an AI Model Configuration in first version. It uses the configuration's `model` value directly.
_Avoid_: separate custom nickname, provider-only label

**AI Provider**:
The provider type of an AI Model Configuration. First version supports `deepseek` and `openai-compatible`.
_Avoid_: hidden SDK import detail, arbitrary unchecked string

**Active Model**:
The AI Model Configuration currently selected in the Composer for sending the next message.
_Avoid_: global immutable default, project-only binding

**Default Model**:
The persisted model selection restored into a new Composer from Settings when HJDesign starts again.
_Avoid_: globally executing model, session-only picker state

**Send Model**:
The AI Model Configuration chosen by one Composer for one send action.
_Avoid_: process-wide singleton selection, inferred backend default

**Provider Options**:
Provider-specific execution options sent with one message request, such as DeepSeek thinking toggle and thinking effort.
_Avoid_: hidden backend-only defaults, provider-agnostic fake fields

**AI Model Configuration ID**:
The stable identifier for one AI Model Configuration, used for editing, deletion, and Active Model selection.
_Avoid_: provider-model tuple key, mutable display field

**Project Directory**:
The filesystem directory that stores one Project and its related Conversation files.
_Avoid_: indexed record, shared bucket

**Project ID**:
The stable identifier used as a Project directory name.
_Avoid_: mutable project name, display slug

**Conversation ID**:
The stable identifier used as a Conversation file name.
_Avoid_: mutable title, display slug

**Project Updated Time**:
The timestamp used to sort Projects by most recent activity.
_Avoid_: name sort, filesystem order

**Conversation Last Message Time**:
The timestamp used to sort Conversations by most recent activity.
_Avoid_: title sort, filesystem order

**Project Description**:
An optional short summary of a Project.
_Avoid_: full spec, configuration dump

**Composer**:
The input area where the user writes messages and accesses project and conversation switching or creation controls.
_Avoid_: toolbar, footer only

**Control Bar**:
A lightweight row above the Composer that contains project and conversation switching controls.
_Avoid_: full sidebar, separate settings page

**Preview Pane**:
The area that renders the current Project output beside the conversation workflow.
_Avoid_: inspector, static screenshot area

**Preview Header**:
The top bar of the Preview Pane that includes the control to collapse or expand the conversation pane.
_Avoid_: floating global chrome, detached toolbar

**Project Output**:
The shared code and rendered result that all Conversations in a Project modify together.
_Avoid_: conversation-specific branch, per-chat preview

**Project Output Type**:
The framework/runtime format for a Project Output. First version supports only `html`, with future expansion to formats such as React.
_Avoid_: file extension only, preview mode

**Project Workspace**:
The code directory inside a Project that stores the live files used for preview.
_Avoid_: global code pool, conversation workspace

**Deletion**:
A user delete action moves a Project or Conversation to the system recycle bin rather than permanently removing it immediately.
_Avoid_: hard delete, purge by default

## Relationships

- **Workspace** contains many **Projects**
- **Workspace** has one **Settings**
- A **Project** contains many **Conversations**
- A **Conversation** belongs to exactly one **Project**
- A **Project** has at most one **Active Conversation** at a time
- A **Conversation** contains many **Messages**
- **Settings** includes one **Interface Language**
- **Interface Language** must be one **Supported Interface Language**
- **Settings** contains many **AI Model Configurations**
- Every **AI Model Configuration** has one **AI Provider**
- Every **AI Model Configuration** exposes one **AI Model Label**
- **Settings** stores one **Default Model**
- **AI Model Configurations** are identified by **AI Model Configuration ID**
- The **Composer** restores its initial selection from **Default Model**
- One send action uses one **Send Model**
- One send action includes **Provider Options**
- A **Project** is stored in one **Project Directory**
- A **Project Directory** is named by **Project ID**
- A **Conversation** file is named by **Conversation ID**
- **Projects** are sorted by **Project Updated Time** descending
- **Conversations** are sorted by **Conversation Last Message Time** descending
- The **Composer** includes controls for project and conversation switching and creation
- The **Control Bar** sits above the **Composer**
- The **Preview Pane** sits beside conversation workflow in the main screen
- The **Preview Header** sits at the top of the **Preview Pane**
- The **Preview Pane** reflects **Project Output**
- A **Project** has exactly one **Project Output Type**
- All **Conversations** in one **Project** modify same **Project Output**
- **Project Output** is stored in **Project Workspace**
- **Deletion** applies to both **Projects** and **Conversations**

## Example dialogue

> **Dev:** "If user starts new design effort, should that create a new **Project** or a new **Conversation**?"
> **Domain expert:** "Create new **Project** when work is a separate design initiative; create new **Conversation** when it belongs to same **Project**."

> **Dev:** "Can a **Conversation** exist before user chooses a **Project**?"
> **Domain expert:** "No. Every **Conversation** must be created inside one **Project**."

> **Dev:** "When user deletes a **Project**, is data gone forever?"
> **Domain expert:** "No. Delete first sends **Project** and **Conversation** data to system recycle bin."

> **Dev:** "Do we need a separate execution record in first version?"
> **Domain expert:** "No. First version models only **Project**, **Conversation**, and **Message**."

> **Dev:** "Can a **Project** have multiple live conversations at same time?"
> **Domain expert:** "No. A **Project** has one **Active Conversation** at a time, with other conversations available as history."

> **Dev:** "What happens when user creates a new **Project**?"
> **Domain expert:** "A new **Project** automatically creates its first **Conversation** and opens it as the **Active Conversation**."

> **Dev:** "How should a new **Conversation** get its title?"
> **Domain expert:** "Use user-provided **Project** name, but auto-generate **Conversation Title** from first user message and allow manual edits later."

> **Dev:** "Where should app-wide preferences and provider credentials live?"
> **Domain expert:** "Store them in one **Settings** record at the **Workspace** level so every **Project** and **Conversation** can reuse them."

> **Dev:** "Should AI provider setup belong to a Project?"
> **Domain expert:** "No. **AI Model Configuration** is shared workspace-wide, not duplicated per **Project**."

> **Dev:** "How does user choose which model sends next message?"
> **Domain expert:** "Use the **Composer** to select one **Send Model** from saved **AI Model Configurations** before sending."

> **Dev:** "Should the current model choice survive app restart?"
> **Domain expert:** "Yes. Persist one **Default Model** in **Settings** and restore it when the app starts."

> **Dev:** "How should one saved model entry be referenced?"
> **Domain expert:** "Give each one an **AI Model Configuration ID** and persist the **Default Model** by that id rather than by mutable provider or model fields."

> **Dev:** "Can DeepSeek use custom endpoints and keys, or only the official default?"
> **Domain expert:** "Allow both supported providers to use explicit `model`, `baseUrl`, and `apiKey` values from **Settings** so proxied and compatible endpoints work too."

> **Dev:** "What happens if user deletes the current model selection?"
> **Domain expert:** "If another **AI Model Configuration** remains, switch the **Default Model** to one remaining entry. If none remain, clear the **Default Model** and block sending until user adds a new configuration."

> **Dev:** "Which interface languages should first version support?"
> **Domain expert:** "Support two **Supported Interface Language** values in first version: `zh-CN` and `en-US`."

> **Dev:** "How should provider API keys be stored in first version?"
> **Domain expert:** "Store `apiKey` inside **Settings** in the local Workspace file for now, with explicit UI messaging that it is saved locally on disk."

> **Dev:** "Should first version support a separate display name for one model entry?"
> **Domain expert:** "No. Use the configuration `model` value as the **AI Model Label** in first version."

> **Dev:** "Can multiple saved model entries show the same model label?"
> **Domain expert:** "Yes. First version may keep duplicate **AI Model Label** values without extra disambiguation text."

> **Dev:** "If multiple HJDesign windows are open, should backend read one global current model from Settings?"
> **Domain expert:** "No. **Default Model** only restores a Composer's initial choice. Real execution uses the per-request **Send Model** and **Provider Options** sent by the frontend."

> **Dev:** "How should provider-specific options such as DeepSeek thinking behave?"
> **Domain expert:** "Store default values in **Settings**, let the Composer change them through model-picker submenus, and send the final **Provider Options** with each message request."

> **Dev:** "What shape should DeepSeek provider options use?"
> **Domain expert:** "Match the SDK shape: `thinking` is an object with `type`, and `reasoningEffort` is a separate field. Store defaults in **Settings**, but execute only from request-scoped **Provider Options** sent by the frontend."

> **Dev:** "Which DeepSeek thinking options should first version expose?"
> **Domain expert:** "Use only `thinking.type` values `enabled` and `disabled`, and only `reasoningEffort` values `high` and `max`. When thinking is disabled, omit `reasoningEffort`. This product does not need old-model compatibility options."

> **Dev:** "Should project and conversation lists be maintained in separate index files?"
> **Domain expert:** "No. Store each **Project** in its own **Project Directory**, and store each **Conversation** as its own file inside that project."

> **Dev:** "Should filesystem names use human-readable titles or stable ids?"
> **Domain expert:** "Use stable **Project ID** and **Conversation ID** for directory and file names, and keep editable display names inside JSON content."

> **Dev:** "What should a Project directory look like?"
> **Domain expert:** "Store `project.json` at Project root and store Conversation files under a `conversations/` subdirectory."

> **Dev:** "How should lists be sorted without index files?"
> **Domain expert:** "Sort **Projects** by most recent update and sort **Conversations** by most recent message, falling back to creation time when needed."

> **Dev:** "How is the main screen laid out?"
> **Domain expert:** "Use a two-pane layout: left pane for conversation messages and **Composer**, right pane for live design preview. The left pane can be fully collapsed."

> **Dev:** "Does each Conversation have its own preview state?"
> **Domain expert:** "No. The **Preview Pane** follows the **Project**, and all **Conversations** in that **Project** modify the same **Project Output**."

> **Dev:** "When user sends a message in an older Conversation, does it act on old code or current code?"
> **Domain expert:** "Every Conversation acts on the current latest **Project Output** rather than restoring an old code snapshot."

> **Dev:** "Where does the shared project code live on disk?"
> **Domain expert:** "Store shared project code in a `workspace/` directory inside each Project."

> **Dev:** "What output format should the first design agent write?"
> **Domain expert:** "Use **Project Output Type** `html` for the first version and write the generated page into the **Project Workspace** for iframe preview."

> **Dev:** "What belongs in first-version Project management?"
> **Domain expert:** "First version supports creating, renaming, switching, deleting, and viewing basic info for a Project, without grouping, labels, favorites, or advanced filtering."

> **Dev:** "Where do project and conversation controls live in the chat UI?"
> **Domain expert:** "Place a lightweight **Control Bar** above the **Composer** with Project switching, Conversation switching, and New Conversation actions; put New Project inside the Project switcher rather than as a persistent primary button."

> **Dev:** "When the conversation pane is collapsed, where does the restore control live?"
> **Domain expert:** "Put the collapse and expand toggle in the leftmost part of the **Preview Header**, and remember pane state at the application level rather than per Project."

> **Dev:** "How should Project and Conversation switching work in the Control Bar?"
> **Domain expert:** "Use searchable dropdown switchers for both Project and Conversation selection, with creation actions embedded in those controls."

> **Dev:** "What metadata belongs in a first-version Project record?"
> **Domain expert:** "Store only Project ID, name, optional Project Description, created time, and updated time."

> **Dev:** "What metadata belongs in a first-version Conversation record?"
> **Domain expert:** "Store only Conversation ID, Project ID, title, created time, updated time, optional last message time, and the message list."

## Flagged ambiguities

- "workspace" could mean app storage root or design project; resolved: **Workspace** means only the app storage root, while **Project** is the design work container.
- Message role taxonomy is intentionally deferred even though real model integration exists.
- Preview ownership was clarified: preview is project-scoped, not conversation-scoped.
- Preview runtime for first design-agent MVP is resolved: **Project Output Type** `html` is served from **Project Workspace** and rendered in the **Preview Pane** via iframe.
- Draft preservation across project or conversation switching is intentionally out of scope for the first version.
