# Great Agency
[translated this  file to russian](./README_ru.md) 

## General Overview


Great Agency is an autonomous agent that operates a Chromium-based browser through Playwright. The agent receives natural-language tasks via the CLI terminal, plans and reasons autonomously, performs browser actions, observes outcomes, and iteratively works until the task is completed.

**Key feature:** The agent adaptively solves tasks.

## Core Functionality

### 1. Browser Automation
- **Playwright** with reliable actions  
- Dynamic selector synthesis based on LLM  
- Intelligent interaction with web elements considering semantics

### 2. Autonomy Cycle
- **Planner + Executor + Critic**  
- The critic performs self-reflection to detect loops  
- Short-term working memory

### 3. Context Management
- Observation compression  
- Maintaining a relevant history window  
- Summarizing available tools

### 4. Advanced Patterns
- Hierarchical planning with milestone breakdown  
- ReAct for step-by-step task solving  
- Interrupt mechanism for user input when required

### 5. Safety
- Navigation and action budget  
- Protection against infinite loops  
- Optional domain restrictions

## Technical Requirements

### Before You Start
1. **Node.js** version 18 or higher  
2. **Python** version 3.10 or higher

### Installation and Launch

#### Step 1: Clone the repository
```bash
git clone <repository-url>
cd your-great-agency
```

#### Step 2: Install dependencies
```bash
npm install
```

#### Step 3: Install Playwright browsers
```bash
npx playwright install --with-deps
```

#### Step 4: Configure environment variables
Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

Edit the `.env` file:
```env
# LLM settings (OpenAI-compatible API)
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL=gpt-4o-mini

# Optional: allowed domains (comma-separated)
ALLOWED_HOSTS=
```

### Local Model Setup
To use local models (e.g. Ollama):
```env
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=your-model
```

#### Step 5: Run

**Option 1: Web Interface (UI)**
```bash
npm run agent "Find and summarize 3 news articles about quantum computing from reputable sources."
```

## Project Structure

```
ai-browser-agent/
├── .env                     # Environment variable file
├── .env.example             # Example .env file
├── package.json             # Project dependencies and scripts
├── package-lock.json        # Dependency lockfile
├── tsconfig.json            # TypeScript configuration
├── playwright.config.ts     # Playwright configuration
├── src/                     # Source code
│   ├── index.ts             # Entry point, orchestrates UI server and agent
│   ├── agent/               # Agent logic
│   │   ├── core.ts          # Main agent loop (Planner/Executor/Critic)
│   │   ├── llm.ts           # LLM abstraction (OpenAI-compatible API)
│   │   ├── tools.ts         # Browser tools for the agent
│   │   ├── selectors.ts     # Dynamic selector detection and evaluation
│   │   └── memory.ts        # Context and memory management
│   ├── browser/             # Browser control
│   │   └── controller.ts    # Playwright wrapper for reliable interactions
│   └── server/              # Server-side module
│       ├── server.ts        # Fastify API + WebSocket log streaming
│       ├── vite.config.ts   # Vite configuration
│       └── ui/              # Client-side (Vite + Vanilla TS)
│           ├── index.html
│           ├── main.ts
│           └── style.css
└── dist/                    # Compiled code (created during build)
```

## LLM Configuration

The project uses an OpenAI-compatible HTTP API for language model interaction.

## Running Tests
```bash
npm run playwright
```

## Build Project
```bash
npm run build
```

