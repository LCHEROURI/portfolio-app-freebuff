import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModelBadge } from './Badge';

describe('ModelBadge — friendly model label with raw id tooltip', () => {
  it('renders the friendly label with the raw id as the hover title', () => {
    render(<ModelBadge model="deepseek/deepseek-chat" />);
    const badge = screen.getByText('DeepSeek Chat');
    expect(badge).toBeInTheDocument();
    expect(badge.closest('span')).toHaveAttribute('title', 'deepseek/deepseek-chat');
  });

  it('falls back to the raw id for unknown models', () => {
    render(<ModelBadge model="some-vendor/unknown-model" />);
    const badge = screen.getByText('some-vendor/unknown-model');
    expect(badge.closest('span')).toHaveAttribute('title', 'some-vendor/unknown-model');
  });

  it('renders nothing when the model is missing', () => {
    const { container } = render(<ModelBadge model={null} />);
    expect(container.firstChild).toBeNull();
  });
});
