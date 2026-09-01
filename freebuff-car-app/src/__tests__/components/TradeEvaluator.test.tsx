import { render, screen, fireEvent, act } from '@testing-library/react';
import TradeEvaluator from '@/components/advisor/TradeEvaluator';

function tradeValueInput() {
  return screen.getByRole('spinbutton', { name: /trade-in value \*/i });
}

function payoffInput() {
  return screen.getByRole('spinbutton', { name: /outstanding payoff \*/i });
}

describe('TradeEvaluator', () => {
  it('renders both inputs with labels', () => {
    render(<TradeEvaluator />);
    expect(tradeValueInput()).toBeInTheDocument();
    expect(payoffInput()).toBeInTheDocument();
  });

  it('defaults payoff to 0 and requires trade value', () => {
    render(<TradeEvaluator />);
    expect(payoffInput()).toHaveValue(0);
    expect(tradeValueInput()).toHaveValue(null);
  });

  it('shows required errors on empty submit', () => {
    render(<TradeEvaluator />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /analyze trade/i }));
    });
    expect(screen.getByText('Required.')).toBeInTheDocument();
  });

  it('shows positive equity for trade above payoff', () => {
    const onComplete = jest.fn();
    render(<TradeEvaluator onComplete={onComplete} />);
    act(() => {
      fireEvent.change(tradeValueInput(), { target: { value: '8000' } });
      fireEvent.change(payoffInput(), { target: { value: '3000' } });
      fireEvent.click(screen.getByRole('button', { name: /analyze trade/i }));
    });
    expect(screen.getByText('You have positive equity')).toBeInTheDocument();
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('shows even position when equity is within tolerance', () => {
    render(<TradeEvaluator />);
    act(() => {
      fireEvent.change(tradeValueInput(), { target: { value: '5000' } });
      fireEvent.change(payoffInput(), { target: { value: '5000' } });
      fireEvent.click(screen.getByRole('button', { name: /analyze trade/i }));
    });
    expect(screen.getByText('Your trade is even')).toBeInTheDocument();
  });

  it('shows negative equity and upside-down warning', () => {
    render(<TradeEvaluator />);
    act(() => {
      fireEvent.change(tradeValueInput(), { target: { value: '3000' } });
      fireEvent.change(payoffInput(), { target: { value: '8000' } });
      fireEvent.click(screen.getByRole('button', { name: /analyze trade/i }));
    });
    expect(screen.getByText('You are upside down on your loan')).toBeInTheDocument();
    expect(screen.getByText(/Upside-down warning/i)).toBeInTheDocument();
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
  });

  it('clears field errors on edit', () => {
    render(<TradeEvaluator />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /analyze trade/i }));
    });
    expect(screen.getByText('Required.')).toBeInTheDocument();
    act(() => {
      fireEvent.change(tradeValueInput(), { target: { value: '4000' } });
    });
    expect(screen.queryByText('Required.')).not.toBeInTheDocument();
  });
});
