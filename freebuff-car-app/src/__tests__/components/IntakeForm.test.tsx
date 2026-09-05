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
      zip: '60601',
      bodyStyle: 'suv',
      phase: 1,
    };
    expect(state.monthlyBudget).toBe('4500');
    expect(state.creditRange).toBe('good');
    expect(state.zip).toBe('60601');
    expect(state.bodyStyle).toBe('suv');
  });
});

describe('IntakeForm optional search fields', () => {
  it('renders optional ZIP and body-style inputs', () => {
    render(<IntakeForm />);
    expect(screen.getByLabelText(/zip code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/body style/i)).toBeInTheDocument();
  });

  it('rejects a malformed ZIP', () => {
    render(<IntakeForm />);
    fireEvent.change(screen.getByLabelText(/monthly budget/i), { target: { value: '4500' } });
    fireEvent.change(screen.getByLabelText(/desired down payment/i), { target: { value: '5000' } });
    fireEvent.click(screen.getByLabelText('Good'));
    fireEvent.change(screen.getByLabelText(/zip code/i), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));
    expect(screen.getByText(/zip must be 5 digits/i)).toBeInTheDocument();
  });

  it('accepts a valid ZIP and body style and shows them in the summary', () => {
    render(<IntakeForm />);
    fireEvent.change(screen.getByLabelText(/monthly budget/i), { target: { value: '4500' } });
    fireEvent.change(screen.getByLabelText(/desired down payment/i), { target: { value: '5000' } });
    fireEvent.click(screen.getByLabelText('Good'));
    fireEvent.change(screen.getByLabelText(/zip code/i), { target: { value: '60601' } });
    fireEvent.change(screen.getByLabelText(/body style/i), { target: { value: 'suv' } });
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));
    expect(screen.getByText(/got it/i)).toBeInTheDocument();
    expect(screen.getByText('60601')).toBeInTheDocument();
    expect(screen.getByText('suv')).toBeInTheDocument();
  });

  it('passes the full intake state to onSaveData', () => {
    const onSaveData = jest.fn();
    render(<IntakeForm onSaveData={onSaveData} />);
    fireEvent.change(screen.getByLabelText(/monthly budget/i), { target: { value: '4500' } });
    fireEvent.change(screen.getByLabelText(/desired down payment/i), { target: { value: '5000' } });
    fireEvent.click(screen.getByLabelText('Good'));
    fireEvent.change(screen.getByLabelText(/zip code/i), { target: { value: '60601' } });
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));
    expect(onSaveData).toHaveBeenCalledTimes(1);
    const payload = onSaveData.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.monthlyBudget).toBe('4500');
    expect(payload.zip).toBe('60601');
  });
});

describe('IntakeForm live price-ceiling preview', () => {
  function typeBudget(value: string) {
    fireEvent.change(screen.getByLabelText(/monthly budget/i), { target: { value } });
  }
  function typeDown(value: string) {
    fireEvent.change(screen.getByLabelText(/desired down payment/i), { target: { value } });
  }
  function pickCredit(range: string) {
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(range, 'i') }));
  }

  it('appears once a budget is typed and updates as every input changes', () => {
    render(<IntakeForm />);
    expect(screen.queryByTestId('ceiling-panel')).toBeNull();

    typeBudget('500');
    expect(screen.getByTestId('ceiling-panel')).toHaveTextContent('roughly $23,300');

    typeDown('5000');
    expect(screen.getByTestId('ceiling-panel')).toHaveTextContent('roughly $27,900');

    pickCredit('excellent');
    expect(screen.getByTestId('ceiling-panel')).toHaveTextContent('roughly $28,700');

    typeBudget('600');
    // Still at excellent credit from the previous pick.
    expect(screen.getByTestId('ceiling-panel')).toHaveTextContent('roughly $33,600');
  });

  it('falls back to good-credit APR while no tier is chosen and says so', () => {
    render(<IntakeForm />);
    typeBudget('500');
    typeDown('5000');
    expect(screen.getByTestId('ceiling-panel')).toHaveTextContent('roughly $27,900');
    expect(screen.getByTestId('ceiling-panel')).toHaveTextContent('Assumes good credit for now');
  });

  it('names the chosen credit tier in the assumptions line', () => {
    render(<IntakeForm />);
    typeBudget('500');
    typeDown('5000');
    pickCredit('fair');
    expect(screen.getByTestId('ceiling-panel')).toHaveTextContent('60-month loan at fair credit');
  });

  it('is honest when the budget is too small to estimate', () => {
    render(<IntakeForm />);
    typeBudget('2');
    expect(screen.getByTestId('ceiling-panel')).toHaveTextContent('too small to estimate');
  });

  it('updates live before any submit', () => {
    render(<IntakeForm />);
    typeBudget('500');
    typeDown('5000');
    // No submit clicked — the panel already reflects the typed values.
    expect(screen.getByTestId('ceiling-panel')).toBeInTheDocument();
    expect(screen.getByText(/save & continue/i)).toBeInTheDocument();
  });
});
