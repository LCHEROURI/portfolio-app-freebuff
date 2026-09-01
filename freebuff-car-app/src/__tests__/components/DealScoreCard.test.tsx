import { render, screen, fireEvent } from '@testing-library/react';
import DealScoreCard from '@/components/advisor/DealScoreCard';

function field(label: RegExp): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe('DealScoreCard', () => {
  it('renders all seven inputs', () => {
    render(<DealScoreCard />);
    expect(field(/monthly payment/i)).toBeInTheDocument();
    expect(field(/monthly budget/i)).toBeInTheDocument();
    expect(field(/documentation fee/i)).toBeInTheDocument();
    expect(field(/flagged add-ons/i)).toBeInTheDocument();
    expect(field(/priorities met/i)).toBeInTheDocument();
    expect(field(/total priorities/i)).toBeInTheDocument();
    expect(field(/trade-in equity/i)).toBeInTheDocument();
  });

  it('requires payment and budget', () => {
    render(<DealScoreCard />);
    fireEvent.click(screen.getByRole('button', { name: /score this deal/i }));
    expect(screen.getAllByText('Required.').length).toBe(2);
  });

  it('rejects zero monthly payment', () => {
    render(<DealScoreCard />);
    fireEvent.change(field(/monthly payment/i), { target: { value: '0' } });
    fireEvent.change(field(/monthly budget/i), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /score this deal/i }));
    expect(screen.getByText('Must be greater than zero.')).toBeInTheDocument();
  });

  it('rejects priorities met exceeding total', () => {
    render(<DealScoreCard />);
    fireEvent.change(field(/monthly payment/i), { target: { value: '400' } });
    fireEvent.change(field(/monthly budget/i), { target: { value: '500' } });
    fireEvent.change(field(/priorities met/i), { target: { value: '5' } });
    fireEvent.change(field(/total priorities/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /score this deal/i }));
    expect(screen.getByText('Cannot exceed total priorities.')).toBeInTheDocument();
  });

  it('scores a perfect deal at 100', () => {
    render(<DealScoreCard />);
    fireEvent.change(field(/monthly payment/i), { target: { value: '400' } });
    fireEvent.change(field(/monthly budget/i), { target: { value: '500' } });
    fireEvent.change(field(/documentation fee/i), { target: { value: '100' } });
    fireEvent.change(field(/flagged add-ons/i), { target: { value: '0' } });
    fireEvent.change(field(/priorities met/i), { target: { value: '3' } });
    fireEvent.change(field(/total priorities/i), { target: { value: '3' } });
    fireEvent.change(field(/trade-in equity/i), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: /score this deal/i }));
    expect(screen.getByTestId('deal-score')).toHaveTextContent('100');
  });

  it('penalizes over-budget payment, add-ons, doc fee, and negative equity', () => {
    render(<DealScoreCard />);
    // payment 600 vs budget 500 -> ratio 500/600 -> round(25*0.8333)=21
    // add-ons 2 -> 20-8=12; doc fee 300 -> 20-15=5; priorities 1/2 -> 10; equity -600 -> 15-3=12
    fireEvent.change(field(/monthly payment/i), { target: { value: '600' } });
    fireEvent.change(field(/monthly budget/i), { target: { value: '500' } });
    fireEvent.change(field(/documentation fee/i), { target: { value: '300' } });
    fireEvent.change(field(/flagged add-ons/i), { target: { value: '2' } });
    fireEvent.change(field(/priorities met/i), { target: { value: '1' } });
    fireEvent.change(field(/total priorities/i), { target: { value: '2' } });
    fireEvent.change(field(/trade-in equity/i), { target: { value: '-600' } });
    fireEvent.click(screen.getByRole('button', { name: /score this deal/i }));
    expect(screen.getByTestId('deal-score')).toHaveTextContent('60');
    const breakdown = screen.getByTestId('score-breakdown');
    expect(breakdown).toHaveTextContent('exceeds your budget');
    expect(breakdown).toHaveTextContent('2 high-margin add-on(s) detected.');
    expect(breakdown).toHaveTextContent('exceeds the $150 reference threshold');
    expect(breakdown).toHaveTextContent('1 of 2 non-negotiable priorities are met.');
    expect(breakdown).toHaveTextContent('upside-down by $600');
  });
});
