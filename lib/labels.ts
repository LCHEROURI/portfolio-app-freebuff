import type { QueueRule } from '@/lib/engine';

export const QUEUE_RULE_LABELS: Record<QueueRule, string> = {
  PROD_FAILURE: 'Production failure',
  UNPUSHED: 'Unpushed work',
  OVERDUE_TASK: 'Overdue task',
  BLOCKED: 'Blocked',
  MISSING_REPO: 'Missing repository',
  MISSING_DEPLOYMENT: 'Missing deployment',
  NO_NEXT_TASK: 'No next task',
  STALE: 'Stale project',
};

export const PROVIDER_LABELS: Record<string, string> = {
  vercel: 'Vercel', firebase: 'Firebase', apphosting: 'App Hosting', cloud_run: 'Cloud Run', replit: 'Replit',
  netlify: 'Netlify', railway: 'Railway', render: 'Render', lovable: 'Lovable',
  ai_studio: 'AI Studio', other: 'Other',
  github: 'GitHub', bitbucket: 'Bitbucket', gitlab: 'GitLab',
};

// OpenRouter model id → friendly display label for AI-generated content badges
// (Top Three briefing, Reports executive summary, winner recommendations).
// Unknown model ids fall back to the raw id via modelLabel().
export const MODEL_LABELS: Record<string, string> = {
  'deepseek/deepseek-chat': 'DeepSeek Chat',
  'deepseek/deepseek-reasoner': 'DeepSeek Reasoner',
  'anthropic/claude-3.5-sonnet': 'Claude 3.5 Sonnet',
  'anthropic/claude-3.5-haiku': 'Claude 3.5 Haiku',
  'anthropic/claude-3.7-sonnet': 'Claude 3.7 Sonnet',
  'openai/gpt-4o': 'GPT-4o',
  'openai/gpt-4o-mini': 'GPT-4o mini',
  'openai/gpt-4.1': 'GPT-4.1',
  'openai/gpt-4.1-mini': 'GPT-4.1 mini',
  'google/gemini-1.5-pro': 'Gemini 1.5 Pro',
  'google/gemini-1.5-flash': 'Gemini 1.5 Flash',
  'google/gemini-2.0-flash': 'Gemini 2.0 Flash',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
  'google/gemini-2.5-flash': 'Gemini 2.5 Flash',
  'meta-llama/llama-3.3-70b-instruct': 'Llama 3.3 70B',
  'moonshotai/kimi-k2-instruct': 'Kimi K2',
  'mistralai/mistral-large': 'Mistral Large',
};

/** Friendly label for an OpenRouter model id, falling back to the raw id. */
export const modelLabel = (modelId: string | null | undefined): string =>
  modelId ? (MODEL_LABELS[modelId] ?? modelId) : '';

export const BUILDER_COLORS: Record<string, string> = {
  Codex: 'text-sky-600 dark:text-sky-300',
  'Google AI Studio': 'text-blue-600 dark:text-blue-300',
  Gemini: 'text-blue-600 dark:text-blue-300',
  FreeBuff: 'text-tomato-600 dark:text-tomato-300',
  Lovable: 'text-eggplant-600 dark:text-eggplant-300',
  DeepSeek: 'text-pepper-600 dark:text-pepper-300',
  Replit: 'text-turmeric-600 dark:text-turmeric-300',
  'Anti-Gravity': 'text-basil-600 dark:text-basil-300',
  Claude: 'text-molasses-500 dark:text-molasses-300',
};
