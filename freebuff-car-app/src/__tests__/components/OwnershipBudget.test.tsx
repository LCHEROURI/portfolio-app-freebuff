import { render, screen, fireEvent, act } from '@testing-library/react';
import OwnershipBudget from '@/components/advisor/OwnershipBudget';

function monthlyLoanInput() {
  return screen.getByRole('spinbutton', { name: /monthly payment \(loan\)\*/i });
}

function insuranceInput() {
  return screen.getByRole('spinbutton', { name: /insurance \(est\.\)\*/i });
}

function fuelInput() {
  return screen.getByRole('spinbutton', { name: /fuel \/ charging \(est\.\)\*/i });
}

function maintenanceInput() {
  return screen.getByRole('spinbutton', { name: /scheduled maintenance \(est\.\)\*/i });
}

function registrationInput() {
  return screen.getByRole('spinbutton', { name: /registration & tags \(est\.\)/i });
}

function parkingInput() {
  return screen.getByRole('spinbutton', { name: /parking & tolls \(est\.\)/i });
}

function taxesInput() {
  return screen.getByRole('spinbutton', { name: /taxes & fees \(est\.\)/i });
}

function otherInput() {
  return screen.getByRole('spinbutton', { name: /other ownership costs \(est\.\)/i });
}

describe('OwnershipBudget', () => {
  it('renders all 8 line-item inputs with labels', () => {
    render(<OwnershipBudget />);
    expect(monthlyLoanInput()).toBeInTheDocument();
    expect(insuranceInput()).toBeInTheDocument();
    expect(fuelInput()).toBeInTheDocument();
    expect(maintenanceInput()).toBeInTheDocument();
    expect(registrationInput()).toBeInTheDocument();
    expect(parkingInput()).toBeInTheDocument();
    expect(taxesInput()).toBeInTheDocument();
    expect(otherInput()).toBeInTheDocument();
  });

  it('renders default values matching the prompt defaults', () => {
    render(<OwnershipBudget />);
    expect(monthlyLoanInput()).toHaveValue(500);
    expect(insuranceInput()).toHaveValue(120);
    expect(fuelInput()).toHaveValue(150);
    expect(maintenanceInput()).toHaveValue(75);
    expect(registrationInput()).toHaveValue(30);
    expect(parkingInput()).toHaveValue(0);
    expect(taxesInput()).toHaveValue(40);
    expect(otherInput()).toHaveValue(0);
  });

  it('shows a live preview with monthly total', () => {
    render(<OwnershipBudget />);
    // Defaults sum: 500+120+150+75+30+0+40+0 = 915.
    expect(screen.getByText('$915.00')).toBeInTheDocument();
  });

  it('renders a calculate button', () => {
    render(<OwnershipBudget />);
    expect(screen.getByRole('button', { name: /calculate/i })).toBeInTheDocument();
  });

  it('validates required fields and shows errors on submit', () => {
    render(<OwnershipBudget />);
    act(() => {
      fireEvent.change(monthlyLoanInput(), { target: { value: '' } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    });
    expect(screen.getByText('Required.')).toBeInTheDocument();
  });

  it('rejects zero or negative monthly payment', () => {
    const onComplete = jest.fn();
    render(<OwnershipBudget onComplete={onComplete} />);
    // userEvent.type on a JSDOM number input strips the leading '-', so set
    // the value directly with fireEvent.change.
    act(() => {
      fireEvent.change(monthlyLoanInput(), { target: { value: '-100' } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByText(/must be greater than zero/i)).toBeInTheDocument();
  });

  it('requires a monthly payment', () => {
    render(<OwnershipBudget />);
    act(() => {
      fireEvent.change(monthlyLoanInput(), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    });
    expect(screen.getByText('Required.')).toBeInTheDocument();
  });

  it('shows affordability result on successful submit', () => {
    render(<OwnershipBudget />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    });
    expect(screen.getByText(/Your monthly ownership cost is ready/i)).toBeInTheDocument();
    // Default: payment $500 > other costs $415 → payment dominates
    expect(screen.getByText('Payment dominates budget')).toBeInTheDocument();
  });

  it('reports Payment affordable when payment is less than other ownership costs', () => {
    render(<OwnershipBudget />);
    // Non-loan costs = 120+150+75+30+0+40+0 = 415.
    // Set payment below that to get "Payment affordable".
    act(() => {
      fireEvent.change(monthlyLoanInput(), { target: { value: '200' } });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    });
    expect(screen.getByText('Payment affordable')).toBeInTheDocument();
  });

  it('calls onComplete when submitted successfully', () => {
    const onComplete = jest.fn();
    render(<OwnershipBudget onComplete={onComplete} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
