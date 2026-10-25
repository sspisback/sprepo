# sprepo

# 🧠 Brain — Agentic AI Productivity Assistant

### 🚀 From a simple Outlook Add-in to a multi-agent AI assistant with local LLMs, RAG, skills and autonomous workflows.

**Brain** is a hands-on experiment in building an **agentic AI productivity assistant** that lives inside Microsoft Outlook — combining conversational AI, specialist agents, private knowledge retrieval and human-in-the-loop workflows.

Built using **React, TypeScript, Node.js, Office.js and Ollama**, Brain explores how AI can move beyond answering questions to understanding intent, retrieving context, coordinating agents and proposing actions.

The interesting part? **The AI runs locally.** No cloud LLM API is required for the prototype.

## ✨ What's Under the Hood?

### 🤖 Multi-Agent Orchestration

A custom-built Orchestrator uses an LLM to interpret natural-language requests and delegate work to specialist agents:

- **Task Agent** — Extracts actionable tasks, identifies dependencies and deadlines, and proposes tasks for approval.
- **Meeting Agent** — Handles meeting queries, calendar context and preparation workflows.
- **Research Agent** — Answers general questions and retrieves relevant knowledge from uploaded documents.
- **Lab Agent** — Transforms emails and instructions into structured requests for analysis or slide creation.

Supports multi-agent routing, contextual follow-ups and shared conversation state.

### 🧩 Skill-Driven AI

Agent behaviour is controlled through **editable Markdown skill files**, separating natural-language instructions from application code.

Skills define how agents interpret requests, summarise emails, identify tasks, extract meetings and generate prompts.

Change a skill → change the agent's behaviour — without rewriting the underlying TypeScript logic.

### 📚 Private Knowledge with RAG

Brain uses **Retrieval-Augmented Generation (RAG)** to answer questions using locally stored documents.

- Upload PDF, Word and text files.
- Extract and chunk document content.
- Generate embeddings locally using Ollama.
- Store searchable vectors and text in **LanceDB**.
- Retrieve relevant passages using semantic similarity search.
- Supply retrieved context to the LLM and display source references.

No model retraining required. Knowledge remains separate from model weights.

### 🧠 Local LLM Inference

Powered by **Ollama + Llama**, with a modular architecture designed to support alternative local models.

- Local reasoning and inference.
- LLM-based intent classification.
- Structured output and task extraction.
- Multi-turn conversational context.
- Graceful mock-service fallback when the LLM is unavailable.

### 📧 Outlook-Native AI

Built as a Microsoft Outlook Office.js Add-in with an embedded chat interface.

Capabilities include:

- Reading the currently opened email.
- AI-generated email summaries.
- Automatic recognition of special Priority Digest emails.
- Skill-driven extraction of meetings and priorities.
- Contextual recommendations and meeting-preparation actions.

### ⚡ Human-in-the-Loop Agent Workflows

Brain doesn't blindly execute actions.

It proposes, explains and waits for approval.

- Convert free-text instructions into structured task plans.
- Review and edit tasks before simulated Planner creation.
- Identify meetings and request preparation.
- Generate editable prompts for AI analysis or slide creation.
- Approve requests before mock service execution.

Calendar, Planner, meeting preparation and Lab integrations are currently simulated through modular mock services.

## 🏗️ Architecture

**React Chat UI → LLM Orchestrator → Specialist Agents → Skills + Tools → LLM → User**

Supporting components:

- **Ollama / Llama:** Local model inference and reasoning.
- **LanceDB:** Local vector storage and semantic retrieval.
- **Markdown Skills:** Editable agent instructions.
- **Office.js:** Outlook email integration.
- **Mock Services:** Simulated external system interactions.
- **Node.js / TypeScript:** Agent execution and service orchestration.

## 🛠️ Tech Stack

**Frontend:** React · TypeScript · Vite · CSS

**Backend:** Node.js · TypeScript

**AI:** Ollama · Llama · Prompt Engineering · Structured Outputs

**Agentic Architecture:** Custom Orchestrator · Specialist Agents · Skill-Driven Routing · Human-in-the-Loop

**Knowledge:** LanceDB · Embeddings · Vector Search · RAG

**Integration:** Microsoft Office.js · Mock Microsoft Planner / Calendar · Mock Lab Services

## 🧪 What I'm Experimenting With

This project is a practical exploration of:

- How LLMs can orchestrate specialist agents.
- How natural-language skills influence agent behaviour.
- How private knowledge can be retrieved without retraining models.
- How conversation memory differs from persistent knowledge.
- How AI agents can combine reasoning, retrieval and tool execution.
- How human approval can be embedded into agentic workflows.
- How existing desktop productivity tools can become AI-powered interfaces.

## 🔬 Project Status

**Experimental prototype / AI engineering playground**

Built iteratively using VS Code and OpenAI Codex, with a focus on understanding and testing agentic AI architecture rather than building a production-ready system.

Real enterprise integrations are intentionally mocked where appropriate.

---

### 💡 The Big Idea

**AI becomes significantly more useful when it can understand intent, retrieve relevant knowledge, coordinate specialist capabilities and help users take action — not just generate text.**

Brain is my experiment in making that happen, one agent, skill and tool at a time.

## Brain Outlook Add-in — AI Productivity Assistant

An experimental Microsoft Outlook Add-in built with React, TypeScript and Office.js.

**Key capabilities:**
- AI-powered email summarisation using locally running Llama models through Ollama.
- Skill-driven Orchestrator with Task, Meeting and General Research Agents.
- Editable Markdown skill files controlling agent behaviour.
- Mock Calendar and Planner services for testing agent workflows.
- Priority Digest recognition and proactive meeting-preparation suggestions.
- Local AI inference without requiring cloud LLM APIs.

**Technology:** React, TypeScript, Node.js, Office.js, Ollama and Llama.

**Purpose:** Experiment with AI agents, skills, orchestration and integration within Outlook.

See the `outlook-addin/` folder for the application source code.

## [`simple-web-app/`](simple-web-app/) — Flask student dashboard

A two-page Flask app: a login page and a student dashboard showing year group,
class, class teacher, attendance (authorised vs unauthorised absence), current
grades against target, and per-subject notes on where to improve. Sessions
gate the dashboard; logging out clears them.

```bash
cd simple-web-app
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/python app.py      # http://127.0.0.1:5000
```

Demo logins are in `users.txt`, each with its own student record in
`students.json`:

| Username | Password | Student | Year | Attendance |
|---|---|---|---|---|
| `alice` | `wonderland` | Alice Nakamura | 9 | 97.4% — above target |
| `admin` | `admin123` | Sam Okafor | 10 | 88.9% — persistent absence |
| `harry` | `potter` | Harry Potter | 7 | 92.6% — below target |
| `james` | `cameron` | James Cameron | 11 | 99.5% — above target |
| `issac` | `newton` | Isaac Newton | 8 | 96.8% — above target |

Passwords are stored in plaintext — it is a demo, not a pattern to copy.

## [`pm-job-agent-2/`](pm-job-agent-2/) — SerpApi job agent

Polls Google Jobs via SerpApi for Product Manager roles posted in the last 24
hours, stores them in SQLite, and prints only what it hasn't seen before.
Full setup and options in [its README](pm-job-agent-2/README.md).

```bash
cd pm-job-agent-2
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
cp .env.example .env          # add your SERPAPI_KEY
./venv/bin/python job_agent.py
```

## Note

Both projects need a virtual environment, which is not committed. On Debian or
Ubuntu builds where `python3 -m venv` fails with "ensurepip is not available",
see the bootstrap workaround in `pm-job-agent-2/README.md`.
