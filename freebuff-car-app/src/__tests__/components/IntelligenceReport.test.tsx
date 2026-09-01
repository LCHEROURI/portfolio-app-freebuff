import { render, screen, fireEvent } from '@testing-library/react';
import IntelligenceReport from '@/components/advisor/IntelligenceReport';

describe('IntelligenceReport', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  it('blocks report generation until consent is checked', () => {
    render(<IntelligenceReport />);
    const button = screen.getByRole('button', { name: /generate report/i });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/educational guidance/i));
    expect(button).toBeEnabled();
  });

  it('generates the report after consent', () => {
    render(<IntelligenceReport />);
    fireEvent.click(screen.getByLabelText(/educational guidance/i));
    fireEvent.click(screen.getByRole('button', { name: /generate report/i }));
    expect(screen.getByText(/Car Purchase Intelligence Report/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print report/i })).toBeInTheDocument();
  });

  it('renders all five score components', () => {
    render(<IntelligenceReport />);
    fireEvent.click(screen.getByLabelText(/educational guidance/i));
    fireEvent.click(screen.getByRole('button', { name: /generate report/i }));
    expect(screen.getByText(/Financing affordability/i)).toBeInTheDocument();
    expect(screen.getByText(/No unnecessary add-ons/i)).toBeInTheDocument();
    expect(screen.getByText(/Reasonable doc fee/i)).toBeInTheDocument();
    expect(screen.getByText(/Priorities matched/i)).toBeInTheDocument();
    expect(screen.getByText(/Trade equity/i)).toBeInTheDocument();
  });
});
