import { render, screen } from '@testing-library/react';
import ResumeSessionBanner from '@/components/ResumeSessionBanner';
import { STORAGE_KEY } from '@/hooks/useAdvisorState';

function saveSession(step: number) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ step }));
}

describe('ResumeSessionBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders nothing for a first-time visitor (empty storage)', () => {
    const { container } = render(<ResumeSessionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the saved step and label for a returning visitor', () => {
    saveSession(3);
    render(<ResumeSessionBanner />);
    expect(screen.getByTestId('resume-banner')).toBeInTheDocument();
    expect(screen.getByText(/Step 3 of 11: Run the financing math/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /resume where you left off/i });
    expect(link).toHaveAttribute('href', '/advisor');
  });

  it('renders nothing when the saved step is 1 (nothing to resume)', () => {
    saveSession(1);
    const { container } = render(<ResumeSessionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for corrupted storage', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    const { container } = render(<ResumeSessionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the step is out of range', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: 99 }));
    const { container } = render(<ResumeSessionBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
