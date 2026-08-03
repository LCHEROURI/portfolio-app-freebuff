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
  vercel: 'Vercel', firebase: 'Firebase', cloud_run: 'Cloud Run', replit: 'Replit',
  netlify: 'Netlify', railway: 'Railway', render: 'Render', lovable: 'Lovable',
  ai_studio: 'AI Studio', other: 'Other',
  github: 'GitHub', bitbucket: 'Bitbucket', gitlab: 'GitLab',
};

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
