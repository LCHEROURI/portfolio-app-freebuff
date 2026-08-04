import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// With `globals: false`, testing-library can't auto-register its cleanup hook,
// so renders would leak across tests. Register it explicitly.
afterEach(() => {
  cleanup();
});
