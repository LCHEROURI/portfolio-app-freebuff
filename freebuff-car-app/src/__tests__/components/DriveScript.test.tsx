import { render, screen } from '@testing-library/react';
import DriveScript from '@/components/advisor/DriveScript';

describe('DriveScript', () => {
  it('renders the negotiation script header', () => {
    render(<DriveScript />);
    expect(screen.getByText(/negotiation/i)).toBeInTheDocument();
  });

  it('renders dialogue-tree objection guidance', () => {
    render(<DriveScript />);
    expect(screen.getAllByText(/if the salesperson/i).length).toBeGreaterThan(0);
  });

  it('renders at least one objection entry', () => {
    render(<DriveScript />);
    const entries = screen.getAllByText(/you say/i);
    expect(entries.length).toBeGreaterThan(0);
  });
});
