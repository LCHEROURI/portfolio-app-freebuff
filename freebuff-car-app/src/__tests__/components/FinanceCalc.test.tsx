import { render, screen, fireEvent } from '@testing-library/react';
import FinanceCalc from '@/components/advisor/FinanceCalc';

describe('FinanceCalc', () => {
  it('renders all required inputs', () => {
    render(<FinanceCalc />);
    expect(screen.getByLabelText(/vehicle price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/down payment/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/apr/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/loan term/i)).toBeInTheDocument();
  });

  it('shows validation errors when submitted empty', () => {
    render(<FinanceCalc />);
    fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    expect(screen.getByText(/vehicle price is required/i)).toBeInTheDocument();
    expect(screen.getByText(/down payment is required/i)).toBeInTheDocument();
    expect(screen.getByText(/apr is required/i)).toBeInTheDocument();
  });

  it('rejects down payment greater than vehicle price', () => {
    render(<FinanceCalc />);
    fireEvent.change(screen.getByLabelText(/vehicle price/i), { target: { value: '20000' } });
    fireEvent.change(screen.getByLabelText(/down payment/i), { target: { value: '25000' } });
    fireEvent.change(screen.getByLabelText(/apr/i), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    expect(screen.getByText(/down payment cannot exceed vehicle price/i)).toBeInTheDocument();
  });

  it('clears field error on edit', () => {
    render(<FinanceCalc />);
    fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    expect(screen.getByText(/vehicle price is required/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/vehicle price/i), { target: { value: '30000' } });
    expect(screen.queryByText(/vehicle price is required/i)).not.toBeInTheDocument();
  });

  it('shows success with monthly payment after valid submission', () => {
    render(<FinanceCalc />);
    fireEvent.change(screen.getByLabelText(/vehicle price/i), { target: { value: '30000' } });
    fireEvent.change(screen.getByLabelText(/down payment/i), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/apr/i), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(/loan term/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    expect(screen.getByText(/your financing numbers are ready/i)).toBeInTheDocument();
    expect(screen.getByText('$25,000')).toBeInTheDocument();
    expect(screen.getByText('$483.32')).toBeInTheDocument();
  });

  it('handles 0% APR correctly', () => {
    render(<FinanceCalc />);
    fireEvent.change(screen.getByLabelText(/vehicle price/i), { target: { value: '24000' } });
    fireEvent.change(screen.getByLabelText(/down payment/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/apr/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/loan term/i), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: /calculate/i }));
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
  });

  it('shows live preview updating as values change', () => {
    render(<FinanceCalc />);
    fireEvent.change(screen.getByLabelText(/vehicle price/i), { target: { value: '30000' } });
    fireEvent.change(screen.getByLabelText(/down payment/i), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/apr/i), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(/loan term/i), { target: { value: '60' } });
    expect(screen.getByText(/live preview/i)).toBeInTheDocument();
    expect(screen.getByText('$25,000')).toBeInTheDocument();
    expect(screen.getByText('$483.32')).toBeInTheDocument();
  });

  it('shows term options', () => {
    render(<FinanceCalc />);
    const select = screen.getByLabelText(/loan term/i) as HTMLSelectElement;
    expect(select.options).toHaveLength(6);
    expect(screen.getByText('24 months (2 years)')).toBeInTheDocument();
    expect(screen.getByText('84 months (7 years)')).toBeInTheDocument();
  });
});
