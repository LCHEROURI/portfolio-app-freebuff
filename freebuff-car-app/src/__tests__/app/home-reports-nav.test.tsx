import { render, screen } from '@testing-library/react';
import HomePage from '@/app/page';
import { SAVED_REPORTS_KEY } from '@/lib/savedReports';

describe('home page navigation to /reports', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('links “My saved reports” from the header nav to the /reports page', () => {
    render(<HomePage />);
    const link = screen.getByTestId('nav-my-reports');
    expect(link).toHaveAttribute('href', '/reports');
    expect(link).toHaveTextContent('My saved reports');
  });

  it('shows a view-all link to /reports when more reports are saved than the teaser lists', async () => {
    const reports = Array.from({ length: 9 }, (_, i) => ({
      id: `nav-r${i}`,
      savedAt: `2026-09-0${i + 1}T12:00:00.000Z`,
      title: `Report ${i}`,
      state: { step: 11 },
    }));
    window.localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(reports));
    render(<HomePage />);
    // The library hydrates from localStorage in an effect, so wait for it.
    const viewAll = await screen.findByRole('link', { name: /view all saved reports/i });
    expect(viewAll).toHaveAttribute('href', '/reports');
  });
});
