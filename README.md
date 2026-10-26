# sprepo
# 🧠 Brain — Productivity Voice AI

### 🎙️ An AI assistant that can listen, reason, retrieve knowledge, coordinate agents and speak back.

**Brain** is an experimental, voice-enabled AI productivity assistant built inside Microsoft Outlook.

What started as a simple chatbot has evolved into a **multi-agent AI application** combining local Large Language Models (LLMs), intelligent orchestration, Retrieval-Augmented Generation (RAG), editable AI skills, human-in-the-loop workflows and two-way voice interaction.

The objective is simple: **move AI beyond answering questions towards understanding context, coordinating tasks and helping users get work done — directly within their existing workflow.**

Built hands-on using **OpenAI Codex, React, TypeScript, Node.js, Office.js and locally running AI models**.

## ✨ What Can Brain Do?

### 🤖 1. Understand Requests and Delegate to Specialist AI Agents

Brain uses an LLM-powered Orchestrator to understand natural-language requests and decide which specialist agent should handle them.

- **Task Agent:** Converts conversational instructions into structured tasks, identifies deadlines and dependencies, and requests approval before simulated task creation.
- **Meeting Agent:** Handles calendar questions, identifies important meetings and supports meeting-preparation workflows.
- **Research Agent:** Answers general questions and retrieves information from uploaded documents.
- **Lab Agent:** Converts user requests and email context into structured, editable prompts for business analysis or slide-deck creation.

The Orchestrator can coordinate multiple agents when a request involves more than one capability.

**Example:** "Show me tomorrow's meetings and create a task to prepare for the first one."

Brain identifies the relevant agents, retrieves the simulated meeting information and proposes a task for approval.

### 🧩 2. Skill-Driven AI — Instructions Separate from Code

Agent behaviour is guided by editable Markdown skill files.

Rather than embedding all AI instructions directly in TypeScript, skills define how agents interpret requests, extract information, apply rules and generate outputs.

This allows experimentation with agent behaviour without rewriting the application logic.

### 📚 3. Private Knowledge Retrieval Using RAG

Brain can answer questions using documents uploaded into its local knowledge base.

The workflow:

**Document → Text extraction → Chunking → Embeddings → LanceDB → Semantic search → LLM answer**

- Supports document upload and indexing.
- Uses Ollama embedding models to convert text into numerical vectors.
- Stores vectors, text passages and metadata in LanceDB.
- Retrieves relevant passages when users ask questions.
- Supplies retrieved context to Llama to generate grounded answers with source references.

This demonstrates how an AI assistant can use private information **without retraining the underlying LLM**.

### 📧 4. AI Inside Microsoft Outlook

Brain operates as an Outlook Add-in, allowing users to interact with AI without leaving their email workflow.

Capabilities include:

- Reading and summarising the currently opened email.
- Recognising special Priority Digest emails.
- Extracting meetings and priorities using dedicated skills.
- Proposing meeting-preparation actions.
- Interpreting client requests and preparing Lab analysis or slide-creation briefs.

The application also supports browser-based testing independently of Outlook.

### 🎙️ 5. Two-Way Voice AI — Speak to Brain and Hear It Respond

The latest enhancement introduces **fully local speech-to-text and text-to-speech**.

**Voice input — Whisper.cpp**

Click the microphone, speak naturally and have your speech converted into a text prompt.

**Voice output — Piper TTS**

Brain converts its responses into spoken audio, allowing users to listen rather than read.

**End-to-end flow:**

🎤 Voice → Whisper.cpp → Text → Orchestrator → Specialist Agent → Llama → Response → Piper → 🔊 Voice

**Example interaction:**

**User speaks:** "Create a task to follow up with James about the revenue report tomorrow."

**Brain:** Interprets the request, invokes Task Agent, generates a task proposal and asks for approval.

**Brain speaks:** "I've prepared a follow-up task for tomorrow. Please review and approve it."

Voice is not a separate chatbot. It is another interface to the same AI intelligence and agent workflows.

The voice pipeline has been tested successfully in both a browser and the Classic Outlook Add-in.

### 🧠 6. Local LLM Inference

Brain uses **Ollama to run Meta's Llama model locally**.

The application explores:
- LLM-based intent recognition and agent routing.
- Prompt engineering and structured responses.
- Local model inference through HTTP APIs.
- Multi-turn conversational context.
- Combining retrieved knowledge with LLM reasoning.
- Separation of application logic, skills, models and tools.

### ⚡ 7. Human-in-the-Loop AI

Brain is designed to propose actions rather than blindly execute them.

Users can review and approve:
- Task creation.
- Meeting-preparation requests.
- Lab analysis requests.
- Slide-deck creation prompts.

External systems such as Planner, Calendar and Lab are represented by mock services in this prototype.

This allows agent reasoning, delegation and approval workflows to be tested without performing real enterprise actions.

## 🏗️ Architecture

**React / Outlook Add-in / Voice UI**

↓

**Brain Orchestrator — Llama + Markdown Skills**

↓

**Task Agent | Meeting Agent | Research Agent | Lab Agent**

↓

**Tools and Services — RAG / LanceDB / Mock Planner / Mock Calendar / Mock Lab**

↓

**Brain Response — Text and Optional Speech**

The application separates user interaction, orchestration, agent responsibilities, knowledge retrieval, reasoning and tool execution.

## 🛠️ Technology Stack

**Application:** React · TypeScript · Node.js · Vite · Microsoft Office.js

**AI & Reasoning:** Ollama · Meta Llama · Prompt Engineering · Structured Outputs

**Agentic AI:** Custom Orchestrator · Specialist Agents · Markdown Skills · Human-in-the-Loop

**Knowledge & Retrieval:** LanceDB · Vector Embeddings · Semantic Search · RAG

**Voice AI:** Whisper.cpp (Speech-to-Text) · Piper (Text-to-Speech)

**Development:** VS Code · OpenAI Codex · PowerShell · Git · GitHub

## 🔬 What This Project Demonstrates

This project is a practical exploration of several core AI engineering concepts:

- Designing and implementing a multi-agent AI architecture.
- Using LLM reasoning for intent detection and specialist-agent delegation.
- Separating natural-language skills from executable code.
- Building local RAG pipelines with embeddings and vector databases.
- Understanding the difference between model knowledge, conversation memory and retrieved context.
- Integrating speech recognition and speech synthesis into an AI application.
- Building human approval into agentic workflows.
- Connecting AI capabilities to real desktop productivity software.
- Developing and iterating an application using AI-assisted coding with Codex.

## 🚧 Project Status

**Working experimental prototype — not a production deployment.**

- LLM inference, document retrieval and speech processing run locally.
- Outlook email interaction and two-way voice have been tested.
- Planner, Calendar, meeting preparation and Lab execution use simulated services.
- Real enterprise authentication, permissions, security hardening and production deployment are outside the current prototype.

## 🚀 The Bigger Idea

**The next generation of AI productivity tools won't just be chatbots.**

They will understand what users want, retrieve relevant knowledge, coordinate specialised capabilities, suggest actions and work naturally across text, voice and existing applications.

Brain is my hands-on experiment in bringing those building blocks together.

**GitHub project:** [Productivity-VoiceAI](https://github.com/sspisback/sprepo/tree/main/Productivity-VoiceAI)

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
