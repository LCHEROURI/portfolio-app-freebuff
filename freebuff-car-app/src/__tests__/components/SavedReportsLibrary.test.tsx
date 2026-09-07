import { render, screen, fireEvent } from '@testing-library/react';
import SavedReportsLibrary from '@/components/SavedReportsLibrary';
import { SAVED_REPORTS_KEY, type SavedReport } from '@/lib/savedReports';
import type { AdvisorState } from '@/hooks/useAdvisorState';

function seed(id: string, title: string, savedAt: string, state?: Partial<AdvisorState>): void {
  const raw = window.localStorage.getItem(SAVED_REPORTS_KEY);
  const existing: SavedReport[] = raw ? (JSON.parse(raw) as SavedReport[]) : [];
  existing.push({ id, title, savedAt, state: { step: 11, ...state } });
  window.localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(existing));
}

describe('SavedReportsLibrary', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders nothing when no reports are saved', () => {
    const { container } = render(<SavedReportsLibrary />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists saved reports newest first with their metadata', () => {
    seed('old', 'Old deal', '2026-08-01T10:00:00.000Z', {
      intake: { monthlyBudget: '400' },
    });
    seed('new', 'Toyota Camry vs Subaru Outback', '2026-09-07T12:00:00.000Z', {
      dealScore: { input: {}, result: { score: 72, breakdown: [] } },
    });
    const { container } = render(<SavedReportsLibrary />);

    expect(screen.getByTestId('saved-reports-library')).toBeInTheDocument();
    expect(screen.getByText(/2 saved reports/i)).toBeInTheDocument();
    const rows = container.querySelectorAll('li[data-testid^="saved-report-"]');
    expect(rows).toHaveLength(2);
    // Newest first: the Camry report row precedes the old one.
    expect(rows[0].textContent).toContain('Toyota Camry vs Subaru Outback');
    expect(rows[0].textContent).toContain('Deal score 72');
    expect(rows[1].textContent).toContain('Old deal');
    expect(rows[1].textContent).not.toContain('Deal score');
  });

  it('links Open report into the advisor with the report id', () => {
    seed('r1', 'Honda Civic', '2026-09-07T12:00:00.000Z');
    render(<SavedReportsLibrary />);
    const link = screen.getByTestId('saved-report-open-r1');
    expect(link).toHaveAttribute('href', '/advisor?report=r1');
    expect(link).toHaveTextContent('Open report');
  });

  it('offers re-download for both formats per report', () => {
    seed('r1', 'Honda Civic', '2026-09-07T12:00:00.000Z');
    render(<SavedReportsLibrary />);
    expect(screen.getByTestId('saved-report-download-r1-md')).toBeInTheDocument();
    expect(screen.getByTestId('saved-report-download-r1-txt')).toBeInTheDocument();
  });

  it('deletes only after inline confirmation, and cancelling keeps the report', () => {
    seed('r1', 'Honda Civic', '2026-09-07T12:00:00.000Z');
    seed('r2', 'Toyota RAV4', '2026-09-08T12:00:00.000Z');
    render(<SavedReportsLibrary />);

    fireEvent.click(screen.getByTestId('saved-report-delete-r1'));
    expect(screen.getByTestId('saved-report-delete-confirm-r1')).toBeInTheDocument();
    expect(screen.getByText(/delete this saved report\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('saved-report-delete-cancel-r1'));
    expect(screen.queryByTestId('saved-report-delete-confirm-r1')).not.toBeInTheDocument();
    expect(screen.getByTestId('saved-report-r1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('saved-report-delete-r1'));
    fireEvent.click(screen.getByTestId('saved-report-delete-confirm-r1'));
    expect(screen.queryByTestId('saved-report-r1')).not.toBeInTheDocument();
    expect(screen.getByTestId('saved-report-r2')).toBeInTheDocument();
    expect(screen.getByText(/1 saved report/i)).toBeInTheDocument();

    const raw = window.localStorage.getItem(SAVED_REPORTS_KEY) ?? '[]';
    const list = JSON.parse(raw) as SavedReport[];
    expect(list.map((r) => r.id)).toEqual(['r2']);
  });
});

describe('SavedReportsLibrary /reports page variant', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders an empty state with a CTA when nothing is saved', () => {
    render(<SavedReportsLibrary variant="page" />);
    expect(screen.getByTestId('saved-reports-empty')).toBeInTheDocument();
    expect(screen.getByText(/no saved reports yet/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /start your deal analysis/i });
    expect(cta).toHaveAttribute('href', '/advisor');
  });

  it('lists every saved report (no home teaser cap)', () => {
    // 9 reports: past the home teaser's 8-row cap, but the page shows all.
    for (let i = 0; i < 9; i++) {
      seed(`r${i}`, `Report ${i}`, `2026-09-0${i + 1}T12:00:00.000Z`);
    }
    const { container } = render(<SavedReportsLibrary variant="page" />);
    expect(screen.getByText(/9 saved reports/i)).toBeInTheDocument();
    const rows = container.querySelectorAll('li[data-testid^="saved-report-"]');
    expect(rows).toHaveLength(9);
    expect(screen.queryByText(/showing the/i)).not.toBeInTheDocument();
  });

  it('uses the page heading level (h1) for the standalone page', () => {
    seed('r1', 'Honda Civic', '2026-09-07T12:00:00.000Z');
    render(<SavedReportsLibrary variant="page" />);
    const heading = screen.getByText('My saved reports');
    expect(heading.tagName).toBe('H1');
  });
});

describe('SavedReportsLibrary home teaser', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('links to the full /reports page when more reports exist than the teaser shows', () => {
    for (let i = 0; i < 9; i++) {
      seed(`t${i}`, `Report ${i}`, `2026-09-0${i + 1}T12:00:00.000Z`);
    }
    render(<SavedReportsLibrary />);
    const viewAll = screen.getByRole('link', { name: /view all saved reports/i });
    expect(viewAll).toHaveAttribute('href', '/reports');
  });

  it('omits the view-all link when every report fits on the home page', () => {
    seed('r1', 'Honda Civic', '2026-09-07T12:00:00.000Z');
    render(<SavedReportsLibrary />);
    expect(screen.queryByRole('link', { name: /view all saved reports/i })).not.toBeInTheDocument();
  });
});
