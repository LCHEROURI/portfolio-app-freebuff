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

  it('shows the dealer contact sheet with a valid ZIP and winning vehicle', () => {
    render(<DriveScript zip="94103" vehicleLabel="Toyota Camry" />);
    expect(screen.getByText(/nearby dealers/i)).toBeInTheDocument();
    expect(screen.getByText(/toyota camry/i)).toBeInTheDocument();
    // Demo placeholders are clearly labeled.
    expect(screen.getByText(/demo dealers/i)).toBeInTheDocument();
    // Five dealer cards, each with a Directions link.
    expect(screen.getAllByText(/directions/i).length).toBe(5);
  });

  it('prompts for a ZIP when none is saved on Step 1', () => {
    render(<DriveScript zip="" vehicleLabel={null} />);
    expect(screen.getByText(/enter a 5-digit zip on step 1/i)).toBeInTheDocument();
    expect(screen.queryByText(/directions/i)).not.toBeInTheDocument();
  });
});
