import { render, screen, fireEvent, act } from '@testing-library/react';
import FeeAuditor from '@/components/advisor/FeeAuditor';

function docFeeInput() {
  return screen.getByRole('spinbutton', { name: /documentation fee \*/i });
}

function titleRegInput() {
  return screen.getByRole('spinbutton', { name: /title & registration \*/i });
}

function addOnsInput() {
  return screen.getByLabelText(/add-ons \(comma-separated\)/i);
}

describe('FeeAuditor', () => {
  it('renders inputs with labels and defaults', () => {
    render(<FeeAuditor />);
    expect(docFeeInput()).toBeInTheDocument();
    expect(titleRegInput()).toBeInTheDocument();
    expect(addOnsInput()).toBeInTheDocument();
    expect(docFeeInput()).toHaveValue(129);
    expect(titleRegInput()).toHaveValue(345);
  });

  it('flags doc fee above $150', () => {
    render(<FeeAuditor />);
    act(() => {
      fireEvent.change(docFeeInput(), { target: { value: '250' } });
      fireEvent.change(addOnsInput(), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /audit quote/i }));
    });
    expect(screen.getByText(/1 red flag detected/i)).toBeInTheDocument();
    expect(screen.getAllByText(/above the \$150 reference threshold/i)).toHaveLength(2);
  });

  it('flags high-margin add-ons', () => {
    render(<FeeAuditor />);
    act(() => {
      fireEvent.change(docFeeInput(), { target: { value: '99' } });
      fireEvent.click(screen.getByRole('button', { name: /audit quote/i }));
    });
    // Default add-ons: Fabric Protection, Nitrogen Tires, Glass Etching — 3 flags
    expect(screen.getByText(/3 red flags detected/i)).toBeInTheDocument();
    expect(screen.getByText(/High-margin add-on detected: "fabric protection"/i)).toBeInTheDocument();
    expect(screen.getByText(/High-margin add-on detected: "nitrogen tires"/i)).toBeInTheDocument();
    expect(screen.getByText(/High-margin add-on detected: "glass etching"/i)).toBeInTheDocument();
  });

  it('returns no flags for a clean quote', () => {
    render(<FeeAuditor />);
    act(() => {
      fireEvent.change(docFeeInput(), { target: { value: '99' } });
      fireEvent.change(addOnsInput(), { target: { value: 'Extended Warranty' } });
      fireEvent.click(screen.getByRole('button', { name: /audit quote/i }));
    });
    expect(screen.getByText('Clean quote — no red flags detected')).toBeInTheDocument();
  });

  it('requires doc fee and title/registration', () => {
    render(<FeeAuditor />);
    act(() => {
      fireEvent.change(docFeeInput(), { target: { value: '' } });
      fireEvent.change(titleRegInput(), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /audit quote/i }));
    });
    expect(screen.getAllByText('Required.').length).toBe(2);
  });

  it('clears field errors on edit', () => {
    render(<FeeAuditor />);
    act(() => {
      fireEvent.change(docFeeInput(), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /audit quote/i }));
    });
    expect(screen.getAllByText('Required.').length).toBeGreaterThan(0);
    act(() => {
      fireEvent.change(docFeeInput(), { target: { value: '99' } });
    });
    expect(screen.queryByText('Required.')).not.toBeInTheDocument();
  });
});
