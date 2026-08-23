"""Search sources and keyword vocabularies for the Reddit AI-lead generator.

Everything here is data, not logic, so the tuning knobs live in one place.
"""

# --- Where to look -----------------------------------------------------------
# Reddit's public JSON API is read-only and needs no account, no app
# registration and no OAuth token: every listing page also answers on `.json`.

# Subreddits where people hire / post paid gigs.
GIG_SUBREDDITS = [
    "forhire",
    "jobbit",
    "hiring",
    "freelance_forhire",
    "RemoteJobs",
    "remotejs",
    "WorkOnline",
    "b2bforhire",
]

# Subreddits about AI/automation where "I need someone to build X" shows up.
AI_SUBREDDITS = [
    "AI_Agents",
    "n8n",
    "LLMDevs",
    "MachineLearningJobs",
    "automation",
    "LocalLLaMA",
    "PromptEngineering",
    "AutoGenAI",
]

# Queries run against the gig subreddits (subreddit-restricted search).
# Reddit search supports OR, so a few broad queries cover the same ground as a
# long list of single-word ones while making far fewer requests.
GIG_QUERIES = [
    "AI OR LLM OR GPT",
    "machine learning OR deep learning OR NLP",
    "chatbot OR automation OR n8n OR prompt engineer",
]

# Queries run against AI subreddits, aimed at hiring intent.
AI_QUERIES = [
    "hiring OR recruiting OR vacancy",
    "freelancer OR contractor OR paid OR budget",
]

# Site-wide searches, to catch subreddits not on the lists above.
GLOBAL_QUERIES = [
    "hiring AI engineer remote",
    "hiring LLM developer remote",
    "looking for AI developer remote paid",
    "hiring machine learning engineer remote",
    "need AI automation developer paid remote",
    "hiring prompt engineer remote",
    "AI chatbot developer needed remote",
    "remote AI contract work",
]

# Subreddits that are remote-only by their own rules. A post from one of these
# counts as remote even when the author never types the word.
REMOTE_BY_DEFAULT_SUBREDDITS = {
    "remotejobs",
    "remotejs",
    "workonline",
    "jobbit",
    "digitalnomadjobs",
    "remotework",
}

# --- What counts as AI work --------------------------------------------------
# Weighted: strong terms are unambiguous, weak terms only count as AI when
# something else on the post already looks like AI work.
AI_TERMS_STRONG = [
    "artificial intelligence", "machine learning", "deep learning",
    "large language model", "llm", "llms", "genai", "generative ai",
    "gpt", "gpt-4", "gpt-5", "chatgpt", "openai", "anthropic", "claude",
    "gemini", "llama", "mistral", "huggingface", "hugging face",
    "langchain", "langgraph", "llamaindex", "crewai", "autogen",
    "rag", "retrieval augmented", "vector database", "pinecone", "weaviate",
    "qdrant", "chromadb", "embeddings", "embedding model",
    "chatbot", "chat bot", "voice agent", "voice ai", "conversational ai",
    "nlp", "natural language processing", "computer vision",
    "prompt engineer", "prompt engineering", "fine-tune", "fine tune",
    "fine-tuning", "finetuning", "stable diffusion", "comfyui", "midjourney",
    "pytorch", "tensorflow", "scikit-learn", "mlops", "ml engineer",
    "ai engineer", "ai developer", "ai agent", "ai agents", "agentic",
    "whisper", "text to speech", "speech to text", "tts", "ocr",
    "recommendation engine", "predictive model", "data annotation",
    "computer-use agent", "ai automation", "ai workflow",
]

AI_TERMS_WEAK = [
    "ai", "a.i.", "automation", "automate", "n8n", "zapier", "make.com",
    "scraper", "scraping", "data pipeline", "python", "api integration",
    "model", "algorithm", "chat",
]

# --- What counts as someone with money to spend ------------------------------
HIRING_TERMS = [
    "[hiring]", "hiring", "we're hiring", "we are hiring", "now hiring",
    "looking for", "looking to hire", "seeking", "need someone",
    "need a developer", "need help", "want to hire", "in search of", "iso ",
    "job opening", "open position", "vacancy", "recruiting",
    "contract", "contractor", "freelance", "freelancer", "consultant",
    "budget", "paid", "will pay", "compensation", "salary", "rate",
    "apply", "send your portfolio", "dm me", "pm me",
]

# Posts where the author is selling their own services, not buying.
SELF_PROMO_TERMS = [
    "[for hire]", "[forhire]", "for hire", "[available]", "available for hire",
    "hire me", "i am available", "i'm available", "my portfolio",
    "offering my services", "i offer", "i can build", "i will build",
    "[task]", "[advert]", "[showcase]",
]

# Words that make a post a full-time-ish job rather than a one-off gig.
JOB_TERMS = [
    "full-time", "full time", "part-time", "part time", "salary", "salaried",
    "benefits", "position", "role", "employee", "w2", "annual", "per year",
    "/yr", "fte",
]

# --- Remote vs onsite --------------------------------------------------------
REMOTE_TERMS = [
    "remote", "fully remote", "100% remote", "remote-first", "remote only",
    "work from home", "work-from-home", "wfh", "telecommute",
    "anywhere in the world", "work from anywhere", "anywhere", "worldwide",
    "global", "any timezone", "any time zone", "distributed team",
    "async", "asynchronous", "location independent", "no location requirement",
    "online", "virtual",
]

# Any of these disqualifies the post unless it is negated ("no onsite").
ONSITE_TERMS = [
    "onsite", "on-site", "on site", "in-person", "in person",
    "in office", "in-office", "on premise", "on-premise", "on-prem",
    "hybrid", "must be located", "must be based", "must reside",
    "must live in", "must be local", "local only", "locals only",
    "local candidates", "relocate", "relocation", "willing to relocate",
    "commute", "commutable", "days in the office", "days in office",
    "come to the office", "our office", "office-based", "office based",
    "based in our", "report to the office",
]

# Negations that appear right before an onsite term and cancel it.
NEGATION_PREFIXES = [
    "no", "not", "non", "never", "zero", "without", "isn't", "is not",
    "aren't", "are not", "won't", "will not", "don't", "do not", "avoid",
    "instead of", "rather than", "free of", "0",
]

# --- Recency -----------------------------------------------------------------
DEFAULT_MAX_AGE_DAYS = 14
DEFAULT_LEAD_COUNT = 20

# --- HTTP --------------------------------------------------------------------
# Reddit asks for a descriptive, non-browser-impersonating User-Agent.
USER_AGENT = "python:reddit-ai-leads:1.0 (public JSON reader; no account)"
REQUEST_DELAY_SECONDS = 2.0
MAX_RETRIES = 4
