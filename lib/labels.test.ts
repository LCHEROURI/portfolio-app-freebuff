import { describe, expect, it } from 'vitest';

import { MODEL_LABELS, modelLabel } from './labels';

describe('modelLabel — OpenRouter model id → friendly label', () => {
  it('maps known model ids to their friendly labels', () => {
    expect(modelLabel('deepseek/deepseek-chat')).toBe('DeepSeek Chat');
    expect(modelLabel('anthropic/claude-3.5-sonnet')).toBe('Claude 3.5 Sonnet');
    expect(modelLabel('openai/gpt-4o')).toBe('GPT-4o');
    expect(modelLabel('google/gemini-2.5-pro')).toBe('Gemini 2.5 Pro');
  });

  it('every entry in MODEL_LABELS resolves through modelLabel', () => {
    for (const [id, label] of Object.entries(MODEL_LABELS)) {
      expect(modelLabel(id)).toBe(label);
    }
  });

  it('falls back to the raw id for unknown models', () => {
    expect(modelLabel('some-vendor/unknown-model')).toBe('some-vendor/unknown-model');
    expect(modelLabel('deepseek/deepseek-chat-v3-1234')).toBe('deepseek/deepseek-chat-v3-1234');
  });

  it('returns an empty string for null or undefined', () => {
    expect(modelLabel(null)).toBe('');
    expect(modelLabel(undefined)).toBe('');
  });
});
