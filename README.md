# Building Products. Experimenting with AI. Learning by Doing.

**Product leadership meets hands-on engineering** | Agentic AI · Local LLMs · RAG · MCP · Voice AI · Vibe Coding

I'm a product leader who likes to go beyond product strategy, roadmaps and requirements. These projects are my practical experiments in **designing, building and testing software with AI-assisted coding**, primarily using **OpenAI Codex in VS Code**.

The goal isn't to claim to be a full-time software engineer. It's to understand the moving parts well enough to make better product and architecture decisions: what the model should do, what deterministic code should do, where context comes from, and how to validate the outcome.

## Projects at a glance

| Project | What I explored | Core technologies |
|---|---|---|
| [SmartCompanion — Productivity AI](Productivity-App/) | Outlook assistant with agent orchestration, skills, mock workflows and RAG | React, TypeScript, Office.js, Ollama, Llama, LanceDB |
| [SmartCompanion — Voice AI](Productivity-VoiceAI/) | Two-way voice added to the Outlook assistant using local speech engines | Whisper.cpp, Piper, Python, TypeScript, Office.js |
| [PriceScout](PriceScout/) | Retail price intelligence, local AI search and an MCP server reusable by AI clients | React, TypeScript, SQLite, Ollama, MCP SDK, Zod |
| [Student Dashboard](simple-web-app/) | Small authenticated web app with per-student information | Python, Flask |
| [PM Job Agent](pm-job-agent-2/) | Automated job discovery with duplicate tracking | Python, SerpApi, SQLite |

---

## 1. SmartCompanion — Productivity AI Inside Outlook

**From a chat panel to a skill-driven, multi-agent productivity assistant.**

[Explore the productivity project](Productivity-App/)

### The product idea

An assistant should help people **act on their work in context**, not just answer generic questions. SmartCompanion is an experimental Microsoft Outlook Add-in that keeps AI assistance alongside the email being read.

### What I built

- **Orchestrator:** A TypeScript layer interprets natural-language intent, loads relevant context and routes requests to specialist agents.
- **Network of agents:** Task Agent proposes tasks and deadlines; Meeting Agent handles calendar questions and preparation; Research Agent handles questions and document retrieval; External Productivity Agent prepares editable requests for analysis or slide creation.
- **Editable Markdown skills:** Separate natural-language instructions guide email summaries, task extraction and priority-digest interpretation without hardwiring every behaviour into TypeScript.
- **Outlook-native workflows:** Summarise the open email, recognise priority digests, extract meetings and suggest next actions inside the task pane.
- **RAG and local knowledge:** Ollama-hosted embeddings and LanceDB retrieve relevant uploaded-document passages for Llama to use as context, without retraining the model.
- **Human-in-the-loop design:** Users review proposals before simulated Planner, Calendar or external productivity service actions.

### Architecture

```text
Outlook / React UI → TypeScript Orchestrator → Skills + context
                                  ↓
              Task | Meeting | Research | External Productivity agents
                                  ↓
                 Ollama / Llama + LanceDB retrieval
                                  ↓
                   Mock services → User approval
```

**Tech:** React · TypeScript · Node.js · Vite · Office.js · Ollama / Llama · LanceDB · Codex

**Status:** Working local productivity prototype. Enterprise service actions remain mocked.

---

## 2. SmartCompanion — Voice AI in Outlook

**Same assistant. A more natural interface: speak a request and hear the answer.**

[Explore the voice-enabled project](Productivity-VoiceAI/)

### The product idea

Typing isn't always the best way to interact with an assistant. I extended the Outlook experience with **two-way voice**, keeping speech processing local and routing spoken prompts through the existing productivity architecture.

### What I built

- **Speech-to-text:** Whisper.cpp converts microphone recordings into text prompts, which can follow the same agent workflows as typed requests.
- **Text-to-speech:** Piper generates spoken responses locally, with playback controls in the chat interface.
- **Local installation and integration:** Python 3.12 supports the Piper environment; Whisper.cpp runs as a native executable; the Node.js backend invokes both engines through configured paths.
- **End-to-end workflow:** Voice input → transcription → Orchestrator / specialist agent → Llama response → speech output.
- **Real Outlook testing:** Verified microphone input and spoken responses both in the browser and the Classic Outlook Add-in.

### Architecture

```text
Microphone → Whisper.cpp → Text prompt → SmartCompanion agents
                                              ↓
                                       Ollama / Llama
                                              ↓
Speaker ← Piper TTS ← Text response ←──────────┘
```

**Tech:** Whisper.cpp · Piper TTS · Python 3.12 · Node.js / TypeScript · Ollama / Llama · Office.js · Codex

**Status:** Working local voice-enabled prototype, tested in Classic Outlook. It builds on the productivity assistant rather than replacing it.

---

## 3. PriceScout — AI-Powered Price Intelligence & MCP Server

**From vibe coding to a real purchase. Literally.**

[Explore the code and detailed MCP documentation](PriceScout/)

### The product idea

Could I build my own UK retailer price tracker, keep a trustworthy price history, ask questions in natural language, and expose the same functionality to other AI applications?

**A rather satisfying bit of product validation:** While experimenting with PriceScout, I spotted an **Amazon price drop on the iPhone 17e — and ordered one**. Sometimes your first customer is you. 📱

### What I built

- **Retail monitoring:** Retailer-specific adapters check supported UK sellers for comparable phone offers, with product links, prices, timestamps and explicit failure states.
- **Automated and ad hoc scanning:** A Node.js scheduler runs daily at **18:00 Europe/London** while the local backend and laptop are running; the web UI can also trigger scans on demand.
- **Price intelligence:** **SQLite** preserves price observations, scan history and detected reductions; React dashboards show results and trends.
- **Local AI search:** **Ollama / Llama** interprets natural-language requests into structured intent. **Zod** validates inputs; TypeScript performs queries, calculations and scanning. The model does **not** invent prices or execute arbitrary SQL.
- **MCP interoperability:** A standalone **Model Context Protocol server** exposes `get_price_history`, `get_price_drops`, `compare_retailers` and `search_prices` to compatible AI clients, reusing the same backend services and database.

### The interesting architectural choice

```text
React web UI -----------------> TypeScript services ----> SQLite
                                      |
                             Retailer adapters
                                      ^
External AI client --> MCP server ----+

Optional local Ollama --> structured search intent --> validated services
```

**MCP isn't another LLM:** It is the discoverable interface through which an external AI client can call PriceScout tools. The client supplies the reasoning; PriceScout supplies the verified data and bounded operations.

**Tech:** React · Vite · TypeScript · Node.js · SQLite · Ollama / Llama · MCP TypeScript SDK · Zod · Codex

**Status:** Local-first experimental app. Coverage depends on retailer accessibility; scheduled checks need an awake machine. The MCP server runs locally over stdio.

---

## 4. Student Dashboard — A Small Full-Stack Web Experiment

**A simple Flask app for practising end-to-end web application development.**

[Explore the project](simple-web-app/)

### What I built

- A login screen and student-specific dashboard.
- Views for attendance, current versus target grades, class information and subject notes.
- Basic session handling to gate access and clear sessions on logout.
- Fictional student records for demonstration and testing.

**Tech:** Python · Flask · HTML / web templates · local data files

**Status:** Learning/demo application. Its example credentials are stored in plaintext, so **it is not suitable for production or real student data**.

---

## 5. PM Job Agent — Automating a Repetitive Search

**A focused automation experiment: find newly posted Product Manager roles without seeing the same result repeatedly.**

[Explore the project and setup](pm-job-agent-2/)

### What I built

- Queries Google Jobs through **SerpApi** for Product Manager openings posted in the previous 24 hours.
- Stores results in **SQLite** and checks whether each job has already been seen.
- Reports newly discovered opportunities instead of repeating the entire search history.

**Tech:** Python · SerpApi · SQLite

**Status:** Local automation prototype; requires a configured SerpApi key.

---

## My approach to AI-assisted product building

I use **Codex as a coding collaborator**, not a substitute for product or engineering judgement. I define the problem, architecture and acceptance criteria; iterate on implementation; inspect errors and test real workflows; and keep a clear boundary between **LLM reasoning**, **retrieved knowledge**, **deterministic services** and **user approval**.

The most useful lesson across these experiments: **AI becomes valuable when it is connected to reliable data, carefully scoped tools and a user experience that helps someone make or execute a decision.**

*These are personal learning prototypes, not production-grade enterprise services. They use local models, mock integrations and explicit limitations where appropriate.*
