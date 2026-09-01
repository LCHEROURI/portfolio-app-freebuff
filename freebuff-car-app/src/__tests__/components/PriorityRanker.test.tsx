import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PriorityRanker, {
  getTopPriorities,
  prioritiesMetCount,
  type PriorityKey,
} from '@/components/advisor/PriorityRanker';

describe('PriorityRanker', () => {
  it('renders all priority sliders', () => {
    render(<PriorityRanker />);
    expect(screen.getByLabelText(/monthly payment/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/total cost/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fuel economy/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/safety/i)).toBeInTheDocument();
  });

  it('updates slider value in real time', () => {
    render(<PriorityRanker />);
    const safetySlider = screen.getByLabelText(/safety/i);
    const rangeInput = safetySlider.closest('div')?.querySelector('input[type=range]') as HTMLInputElement;
    expect(rangeInput?.value).toBe('4');
    fireEvent.input(rangeInput!, { target: { value: '5' } });
    const badge = screen.getByText('5/5');
    expect(badge).toBeInTheDocument();
  });

  it('shows top 3 priorities on save', () => {
    render(<PriorityRanker />);
    const safetySlider = screen.getByLabelText(/safety/i);
    const safetyRange = safetySlider.closest('div')?.querySelector('input[type=range]') as HTMLInputElement;
    fireEvent.input(safetyRange!, { target: { value: '5' } });
    const monthlySlider = screen.getByLabelText(/monthly payment/i);
    const monthlyRange = monthlySlider.closest('div')?.querySelector('input[type=range]') as HTMLInputElement;
    fireEvent.input(monthlyRange!, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /save priorities/i }));
    expect(screen.getByText(/your priorities are ranked/i)).toBeInTheDocument();
    expect(screen.getByText(/Top priorities:/i)).toBeInTheDocument();
    expect(screen.getByText(/Monthly payment/i)).toBeInTheDocument();
    expect(screen.getByText(/Safety/i)).toBeInTheDocument();
    expect(screen.getByText(/Total cost/i)).toBeInTheDocument();
  });
});

describe('getTopPriorities', () => {
  it('returns top 3 priorities by value', () => {
    const priorities: Record<PriorityKey, number> = {
      monthlyPayment: 5,
      totalCost: 4,
      fuelEconomy: 3,
      safety: 5,
      technology: 2,
      resaleValue: 1,
      comfort: 3,
      warranty: 2,
    };
    const top = getTopPriorities(priorities, 3);
    expect(top).toContain('monthlyPayment');
    expect(top).toContain('safety');
    expect(top).toContain('totalCost');
    expect(top).toHaveLength(3);
  });

  it('returns fewer if fewer priorities exist', () => {
    const priorities: Record<PriorityKey, number> = {
      monthlyPayment: 5,
      totalCost: 3,
      fuelEconomy: 1,
      safety: 2,
      technology: 1,
      resaleValue: 1,
      comfort: 1,
      warranty: 1,
    };
    const top = getTopPriorities(priorities, 5);
    expect(top).toHaveLength(5);
  });
});

describe('prioritiesMetCount', () => {
  it('counts matched priorities', () => {
    const priorities: Record<PriorityKey, number> = {
      monthlyPayment: 5,
      totalCost: 3,
      fuelEconomy: 4,
      safety: 5,
      technology: 1,
      resaleValue: 2,
      comfort: 3,
      warranty: 1,
    };
    const vehiclePriorities: Partial<Record<PriorityKey, boolean>> = {
      monthlyPayment: true,
      safety: true,
      fuelEconomy: false,
    };
    expect(prioritiesMetCount(priorities, vehiclePriorities)).toBe(2);
  });

  it('returns 0 when none match', () => {
    const priorities: Record<PriorityKey, number> = {
      monthlyPayment: 5,
      totalCost: 3,
      fuelEconomy: 4,
      safety: 5,
      technology: 1,
      resaleValue: 2,
      comfort: 3,
      warranty: 1,
    };
    const vehiclePriorities: Partial<Record<PriorityKey, boolean>> = {
      monthlyPayment: false,
      safety: false,
    };
    expect(prioritiesMetCount(priorities, vehiclePriorities)).toBe(0);
  });

  it('ignores priorities not in vehicle list', () => {
    const priorities: Record<PriorityKey, number> = {
      monthlyPayment: 5,
      totalCost: 3,
      fuelEconomy: 4,
      safety: 5,
      technology: 1,
      resaleValue: 2,
      comfort: 3,
      warranty: 1,
    };
    const vehiclePriorities: Partial<Record<PriorityKey, boolean>> = {
      monthlyPayment: true,
    };
    // Only monthlyPayment is in vehiclePriorities, and it's met.
    expect(prioritiesMetCount(priorities, vehiclePriorities)).toBe(1);
  });
});
