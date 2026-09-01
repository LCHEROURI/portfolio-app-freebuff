import { render, screen } from '@testing-library/react';
import LeaseMatrix from '@/components/advisor/LeaseMatrix';

describe('LeaseMatrix', () => {
  it('renders all three option sections', () => {
    render(<LeaseMatrix />);
    // Buy New appears as legend (form) and table cell — both present
    expect(screen.getAllByText('Buy New')).toHaveLength(2);
    // Lease appears as legend and table cell — use getAll
    expect(screen.getAllByText('Lease')).toHaveLength(2);
    // Buy Used appears as legend and table cell
    expect(screen.getAllByText('Buy Used')).toHaveLength(2);
  });

  it('renders the comparison table', () => {
    render(<LeaseMatrix />);
    expect(screen.getByText('Side-by-side comparison')).toBeInTheDocument();
    expect(screen.getByText('Option')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
    expect(screen.getByText('Total cost')).toBeInTheDocument();
  });

  it('renders default values for buy new', () => {
    render(<LeaseMatrix />);
    expect(screen.getByDisplayValue('30000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5000')).toBeInTheDocument();
    expect(screen.getByLabelText(/apr/i, { selector: '#newApr' })).toHaveValue(6);
  });

  it('renders default values for lease', () => {
    render(<LeaseMatrix />);
    expect(screen.getByLabelText('Monthly payment *')).toHaveValue(400);
    expect(screen.getByLabelText('Due at signing *')).toHaveValue(2500);
    expect(screen.getByLabelText('Lease term *')).toHaveValue('36');
  });

  it('renders default values for buy used', () => {
    render(<LeaseMatrix />);
    expect(screen.getByDisplayValue('20000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3000')).toBeInTheDocument();
    expect(screen.getByLabelText(/apr/i, { selector: '#usedApr' })).toHaveValue(7);
  });

  it('shows cheapest monthly and total with ▼ marker', () => {
    render(<LeaseMatrix />);
    const cells = screen.getAllByText(/▼/);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('has reset button', () => {
    render(<LeaseMatrix />);
    expect(screen.getByRole('button', { name: /reset to defaults/i })).toBeInTheDocument();
  });

  it('has save comparison button', () => {
    render(<LeaseMatrix />);
    expect(screen.getByRole('button', { name: /save comparison/i })).toBeInTheDocument();
  });
});
