import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_OPENROUTER_MODEL,
  buildRecommendationMessages,
  buildSummaryMessages,
  buildTopThreeMessages,
  chatCompletion,
  getOpenRouterModel,
  isOpenRouterConfigured,
  narrateTopThree,
  parseJsonObject,
  recommendWinner,
  summarizeReport,
  withExecutiveSummary,
  withTopThreeNarration,
} from './openrouter';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockJson = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });

const setKey = (value?: string) => {
  if (value === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = value;
};

const setModel = (value?: string) => {
  if (value === undefined) delete process.env.OPENROUTER_MODEL;
  else process.env.OPENROUTER_MODEL = value;
};

beforeEach(() => {
  setKey('sk-test-123');
  setModel(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Config ──────────────────────────────────────────────────────────────────

describe('config', () => {
  it('is unconfigured when OPENROUTER_API_KEY is unset', () => {
    setKey();
    expect(isOpenRouterConfigured()).toBe(false);
  });

  it('is configured when OPENROUTER_API_KEY is set', () => {
    expect(isOpenRouterConfigured()).toBe(true);
  });

  it('defaults the model to deepseek/deepseek-chat', () => {
    expect(getOpenRouterModel()).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(DEFAULT_OPENROUTER_MODEL).toBe('deepseek/deepseek-chat');
  });

  it('honors OPENROUTER_MODEL override', () => {
    setModel('anthropic/claude-3.5-sonnet');
    expect(getOpenRouterModel()).toBe('anthropic/claude-3.5-sonnet');
  });
});

// ─── chatCompletion ──────────────────────────────────────────────────────────

describe('chatCompletion', () => {
  it('posts the OpenAI-compatible payload with the key and parses the reply', async () => {
    const fetchMock = vi.fn(async () =>
      mockJson({ choices: [{ message: { content: '  Focus on the failing deploy.  ' } }], model: 'deepseek/deepseek-chat' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await chatCompletion(
      [{ role: 'user', content: 'Summarize.' }],
      { temperature: 0.2, maxTokens: 120 },
    );

    expect(result).toEqual({ content: 'Focus on the failing deploy.', model: 'deepseek/deepseek-chat' });

    const callArgs = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = callArgs;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test-123');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek/deepseek-chat');
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(120);
    expect(body.messages).toEqual([{ role: 'user', content: 'Summarize.' }]);
  });

  it('honors a per-user model override over the env default', async () => {
    const fetchMock = vi.fn(async () =>
      mockJson({ choices: [{ message: { content: 'ok' } }], model: 'anthropic/claude-3.5-sonnet' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await chatCompletion([], { model: 'anthropic/claude-3.5-sonnet' });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe('anthropic/claude-3.5-sonnet');
  });

  it('falls back to the env default when the override is blank', async () => {
    setModel('env-model');
    const fetchMock = vi.fn(async () => mockJson({ choices: [{ message: { content: 'ok' } }], model: 'env-model' }));
    vi.stubGlobal('fetch', fetchMock);
    await chatCompletion([], { model: '   ' });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe('env-model');
  });

  it('throws when the key is missing', async () => {
    setKey();
    await expect(chatCompletion([])).rejects.toThrow('OPENROUTER_API_KEY');
  });

  it('throws on a non-ok provider response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    await expect(chatCompletion([])).rejects.toThrow('401');
  });

  it('throws when the reply has no usable content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockJson({ choices: [] })));
    await expect(chatCompletion([])).rejects.toThrow('no usable content');
  });

  it('throws when the reply JSON is unparseable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })));
    await expect(chatCompletion([])).rejects.toThrow('no usable content');
  });
});

// ─── summarizeReport (graceful degradation) ──────────────────────────────────

describe('summarizeReport', () => {
  const input = { kind: 'daily' as const, title: 'Daily Report', body: '# hello', attentionCount: 3 };

  it('returns null without calling the provider when unconfigured', async () => {
    setKey();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await summarizeReport(input);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the provider call fails (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(summarizeReport(input)).resolves.toBeNull();
  });

  it('returns the summary and model on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJson({ choices: [{ message: { content: 'Push the unpushed commits first.' } }], model: 'deepseek/deepseek-chat' }),
    ));
    const result = await summarizeReport(input);
    expect(result).toEqual({ summary: 'Push the unpushed commits first.', model: 'deepseek/deepseek-chat' });
  });

  it('passes a per-user model override through to the provider', async () => {
    const fetchMock = vi.fn(async () =>
      mockJson({ choices: [{ message: { content: 'Summary from claude.' } }], model: 'anthropic/claude-3.5-sonnet' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await summarizeReport({ ...input, model: 'anthropic/claude-3.5-sonnet' });
    expect(result?.model).toBe('anthropic/claude-3.5-sonnet');
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe('anthropic/claude-3.5-sonnet');
  });
});

// ─── buildSummaryMessages ────────────────────────────────────────────────────

describe('buildSummaryMessages', () => {
  it('embeds the report body and metadata in the user message', () => {
    const messages = buildSummaryMessages({
      kind: 'weekly', title: 'Weekly Report', body: '## Deployments\n- ok', attentionCount: 2,
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    const user = messages[1].content;
    expect(user).toContain('Report kind: weekly');
    expect(user).toContain('Title: Weekly Report');
    expect(user).toContain('Attention items: 2');
    expect(user).toContain('## Deployments');
  });
});

// ─── recommendWinner ─────────────────────────────────────────────────────────

describe('recommendWinner', () => {
  const input = {
    projectName: 'Weeknight Meal Planner',
    candidates: [
      {
        versionId: 'v-gemini', versionName: 'Gemini Build', builder: 'Google AI Studio', model: 'Gemini 1.5 Pro',
        overallScore: 8.2, scores: { UI: 8, Features: 9, Code: 8 },
      },
      {
        versionId: 'v-kimi', versionName: 'Kimi K3 Build', builder: 'Replit', model: 'Kimi K3',
        overallScore: 7.1, scores: { UI: 7, Features: 7, Code: 7 },
      },
    ],
  };

  it('returns null without calling the provider when unconfigured', async () => {
    setKey();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(recommendWinner(input)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the provider errors (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(recommendWinner(input)).resolves.toBeNull();
  });

  it('returns the recommendation with a validated version id on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJson({ choices: [{ message: { content: '{"recommendedVersionId": "v-gemini", "note": "Gemini wins on features and overall score."}' } }], model: 'deepseek/deepseek-chat' }),
    ));
    const result = await recommendWinner(input);
    expect(result).toEqual({
      recommendedVersionId: 'v-gemini',
      note: 'Gemini wins on features and overall score.',
      model: 'deepseek/deepseek-chat',
    });
  });

  it('falls back to null when the reply names an unknown version id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJson({ choices: [{ message: { content: '{"recommendedVersionId": "v-fake", "note": "pick this"}' } }] }),
    ));
    await expect(recommendWinner(input)).resolves.toBeNull();
  });

  it('falls back to null when the reply has no usable note', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJson({ choices: [{ message: { content: '{"recommendedVersionId": "v-gemini", "note": ""}' } }] }),
    ));
    await expect(recommendWinner(input)).resolves.toBeNull();
  });

  it('falls back to null when the reply is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJson({ choices: [{ message: { content: 'Gemini clearly wins because...' } }] }),
    ));
    await expect(recommendWinner(input)).resolves.toBeNull();
  });

  it('embeds the candidates with ids and scores in the prompt', () => {
    const messages = buildRecommendationMessages(input);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('Project: Weeknight Meal Planner');
    expect(messages[1].content).toContain('id=v-gemini');
    expect(messages[1].content).toContain('overall=8.2');
    expect(messages[1].content).toContain('UI=8');
  });
});

// ─── narrateTopThree ─────────────────────────────────────────────────────────

describe('narrateTopThree', () => {
  const input = {
    actions: [
      { priority: 1, title: 'Fix failed production deployment: meal-planner', description: 'Health check failed — 503.', projectId: 'p-meal', projectName: 'Weeknight Meal Planner' },
      { priority: 2, title: 'Push LCHEROURI/portfolio-app-freebuff', description: '3 unpushed commits.', projectId: 'p-meal', projectName: 'Weeknight Meal Planner' },
      { priority: 3, title: 'Complete overdue task: Ship onboarding', description: 'Project Weeknight Meal Planner — due 2 days ago.', projectId: 'p-meal', projectName: 'Weeknight Meal Planner' },
    ],
  };

  it('returns null without calling the provider when unconfigured', async () => {
    setKey();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(narrateTopThree(input)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the provider errors (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(narrateTopThree(input)).resolves.toBeNull();
  });

  it('returns the paragraph, model, and cited project ids on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJson({ choices: [{ message: { content: '  {"paragraph": "The failing production deploy is the priority today: fix it first, then push the unpushed work and close the overdue onboarding task.", "projectIds": ["p-meal"]}  ' } }], model: 'deepseek/deepseek-chat' }),
    ));
    const result = await narrateTopThree(input);
    expect(result).toEqual({
      paragraph: 'The failing production deploy is the priority today: fix it first, then push the unpushed work and close the overdue onboarding task.',
      model: 'deepseek/deepseek-chat',
      projectIds: ['p-meal'],
    });
  });

  it('returns null when the reply is not usable JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJson({ choices: [{ message: { content: 'The deploy is the priority, fix it first.' } }] }),
    ));
    await expect(narrateTopThree(input)).resolves.toBeNull();
  });

  it('returns null when the reply has an empty paragraph', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJson({ choices: [{ message: { content: '{"paragraph": "", "projectIds": []}' } }] }),
    ));
    await expect(narrateTopThree(input)).resolves.toBeNull();
  });

  it('drops invented project ids and keeps only ids present in the actions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJson({ choices: [{ message: { content: '{"paragraph": "Focus on the meal planner.", "projectIds": ["p-meal", "p-fake", "p-other"]}' } }] }),
    ));
    const result = await narrateTopThree(input);
    expect(result?.projectIds).toEqual(['p-meal']);
  });

  it('passes a per-user model override through to the provider', async () => {
    const fetchMock = vi.fn(async () =>
      mockJson({ choices: [{ message: { content: '{"paragraph": "Fix the deploy first.", "projectIds": []}' } }], model: 'anthropic/claude-3.5-sonnet' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await narrateTopThree({ ...input, model: 'anthropic/claude-3.5-sonnet' });
    expect(result?.model).toBe('anthropic/claude-3.5-sonnet');
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe('anthropic/claude-3.5-sonnet');
  });

  it('gives the JSON reply a generous token budget so it cannot truncate mid-parse', async () => {
    const fetchMock = vi.fn(async () =>
      mockJson({ choices: [{ message: { content: '{"paragraph": "Fix it.", "projectIds": []}' } }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await narrateTopThree(input);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.max_tokens).toBe(300);
  });

  it('embeds the ordered actions (with project ids) in the prompt', () => {
    const messages = buildTopThreeMessages(input);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('1. Fix failed production deployment: meal-planner');
    expect(messages[1].content).toContain('2. Push LCHEROURI/portfolio-app-freebuff');
    expect(messages[1].content).toContain('3. Complete overdue task: Ship onboarding');

    const withProject = buildTopThreeMessages({
      actions: [{ priority: 1, title: 'Fix deploy', description: '503', projectId: 'p-1', projectName: 'Takeout Voice 2' }],
    });
    expect(withProject[1].content).toContain('projectId=p-1 (Takeout Voice 2)');
  });
});

// ─── parseJsonObject ─────────────────────────────────────────────────────────

describe('parseJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(parseJsonObject('{"a": 1}')).toEqual({ a: 1 });
  });

  it('tolerates markdown code fences and surrounding prose', () => {
    expect(parseJsonObject('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('tolerates trailing prose even when it contains stray braces', () => {
    // A greedy brace-range match would swallow ' (see {note})' into the JSON and
    // fail to parse; the balanced extractor must stop at the object's own close.
    expect(parseJsonObject('{"a": 1} hope this helps {note}')).toEqual({ a: 1 });
    expect(parseJsonObject('{"paragraph": "Done.", "projectIds": []} — cheers')).toEqual({
      paragraph: 'Done.', projectIds: [],
    });
  });

  it('handles nested objects and braces inside string values', () => {
    expect(parseJsonObject('{"a": {"b": {"c": 3}}} trailing')).toEqual({ a: { b: { c: 3 } } });
    expect(parseJsonObject('{"msg": "a {brace} inside a string"}')).toEqual({ msg: 'a {brace} inside a string' });
  });

  it('returns null for non-object content', () => {
    expect(parseJsonObject('just words')).toBeNull();
    expect(parseJsonObject('[1, 2]')).toBeNull();
    expect(parseJsonObject('')).toBeNull();
    expect(parseJsonObject('no braces but { an unbalanced open')).toBeNull();
  });
});

// ─── withExecutiveSummary ────────────────────────────────────────────────────

describe('withExecutiveSummary', () => {
  it('returns the body unchanged when there is no summary', () => {
    expect(withExecutiveSummary('# body', null, null)).toBe('# body');
    expect(withExecutiveSummary('# body', '', 'deepseek/deepseek-chat')).toBe('# body');
  });

  it('prepends a headed summary when present', () => {
    const out = withExecutiveSummary('# body', 'Short summary.', 'deepseek/deepseek-chat');
    expect(out).toContain('## ✨ AI executive summary (DeepSeek Chat)');
    expect(out).toContain('Short summary.');
    expect(out).toContain('# body');
    expect(out.indexOf('Short summary.')).toBeLessThan(out.indexOf('# body'));
  });

  it('shows the raw model id in the heading when the id is unknown', () => {
    const out = withExecutiveSummary('# body', 'Short summary.', 'some-vendor/unknown-model');
    expect(out).toContain('## ✨ AI executive summary (some-vendor/unknown-model)');
  });

  it('appends the exact raw model id as a footer line for inbox traceability', () => {
    const out = withExecutiveSummary('# body', 'Short summary.', 'deepseek/deepseek-chat');
    // The friendly label is in the heading, the raw id survives in a footer line.
    expect(out).toContain('Model: `deepseek/deepseek-chat`');
    expect(out.indexOf('Model: `deepseek/deepseek-chat`')).toBeGreaterThan(out.indexOf('Short summary.'));
    expect(out.indexOf('Model: `deepseek/deepseek-chat`')).toBeLessThan(out.indexOf('# body'));
  });

  it('omits the footer line when no model is known', () => {
    const out = withExecutiveSummary('# body', 'Short summary.', null);
    expect(out).not.toContain('Model:');
  });
});

// ─── withTopThreeNarration ───────────────────────────────────────────────────

describe('withTopThreeNarration', () => {
  it('returns the body unchanged when there is no narration', () => {
    expect(withTopThreeNarration('# body', null, null)).toBe('# body');
    expect(withTopThreeNarration('# body', '', 'deepseek/deepseek-chat')).toBe('# body');
  });

  it('prepends a headed narration when present', () => {
    const out = withTopThreeNarration('# body', 'Fix the failing deploy first.', 'deepseek/deepseek-chat');
    expect(out).toContain('## 🎯 Why these three matter today (DeepSeek Chat)');
    expect(out).toContain('Fix the failing deploy first.');
    expect(out).toContain('# body');
    expect(out.indexOf('Fix the failing deploy first.')).toBeLessThan(out.indexOf('# body'));
  });

  it('shows the raw model id in the heading when the id is unknown', () => {
    const out = withTopThreeNarration('# body', 'Fix the failing deploy first.', 'some-vendor/unknown-model');
    expect(out).toContain('## 🎯 Why these three matter today (some-vendor/unknown-model)');
  });

  it('appends the exact raw model id as a footer line for inbox traceability', () => {
    const out = withTopThreeNarration('# body', 'Fix the failing deploy first.', 'deepseek/deepseek-chat');
    expect(out).toContain('Model: `deepseek/deepseek-chat`');
    expect(out.indexOf('Model: `deepseek/deepseek-chat`')).toBeGreaterThan(out.indexOf('Fix the failing deploy first.'));
    expect(out.indexOf('Model: `deepseek/deepseek-chat`')).toBeLessThan(out.indexOf('# body'));
  });

  it('omits the footer line when no model is known', () => {
    const out = withTopThreeNarration('# body', 'Fix the failing deploy first.', null);
    expect(out).not.toContain('Model:');
  });
});
