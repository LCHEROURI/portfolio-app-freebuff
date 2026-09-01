import { render, screen, fireEvent } from '@testing-library/react';
import IntakeForm, { type IntakeState, type CreditRange } from '@/components/advisor/IntakeForm';

describe('IntakeForm', () => {
  it('renders all required inputs', () => {
    render(<IntakeForm />);
    expect(screen.getByLabelText(/monthly budget/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/desired down payment/i)).toBeInTheDocument();
    expect(screen.getByText(/credit score range/i)).toBeInTheDocument();
  });

  it('shows validation errors when submitted empty', () => {
    render(<IntakeForm />);
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));
    expect(screen.getByText(/monthly budget is required/i)).toBeInTheDocument();
    expect(screen.getByText(/down payment is required/i)).toBeInTheDocument();
    expect(screen.getByText(/credit range is required/i)).toBeInTheDocument();
  });

  it('clears field error on edit', () => {
    render(<IntakeForm />);
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));
    expect(screen.getByText(/monthly budget is required/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/monthly budget/i), { target: { value: '5000' } });
    expect(screen.queryByText(/monthly budget is required/i)).not.toBeInTheDocument();
  });

  it('shows success after valid submission', () => {
    render(<IntakeForm />);
    fireEvent.change(screen.getByLabelText(/monthly budget/i), { target: { value: '4500' } });
    fireEvent.change(screen.getByLabelText(/desired down payment/i), { target: { value: '5000' } });
    const goodRadio = screen.getByLabelText('Good');
    fireEvent.click(goodRadio);
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));
    expect(screen.getByText(/got it — your budget is set/i)).toBeInTheDocument();
    expect(screen.getByText(/monthly budget:/i)).toBeInTheDocument();
    expect(screen.getByText('$4,500')).toBeInTheDocument();
    expect(screen.getByText(/Down payment:/i)).toBeInTheDocument();
    expect(screen.getByText('$5,000')).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
  });

  it('rejects monthly budget of zero', () => {
    render(<IntakeForm />);
    fireEvent.change(screen.getByLabelText(/monthly budget/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/desired down payment/i), { target: { value: '1000' } });
    fireEvent.click(screen.getByLabelText('Good'));
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));
    expect(screen.getByText(/must be greater than zero/i)).toBeInTheDocument();
  });

  it('rejects empty monthly budget', () => {
    render(<IntakeForm />);
    fireEvent.change(screen.getByLabelText(/monthly budget/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/desired down payment/i), { target: { value: '1000' } });
    fireEvent.click(screen.getByLabelText('Good'));
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));
    expect(screen.getByText(/monthly budget is required/i)).toBeInTheDocument();
  });
});

describe('IntakeState shape', () => {
  it('has the expected shape', () => {
    const state: IntakeState = {
      monthlyBudget: '4500',
      downPayment: '5000',
      creditRange: 'good' as CreditRange,
      phase: 1,
    };
    expect(state.monthlyBudget).toBe('4500');
    expect(state.creditRange).toBe('good');
  });
});
