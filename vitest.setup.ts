import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// Testing Library's async-util default is a 1000ms budget for findBy* /
// waitFor retries — comfortable on an idle machine, but flaky when the suite
// shares CPU with other work (load spikes have made the render + effect +
// re-render cycle after a mocked fetch resolve exceed 1s, failing the
// CommandCenter AI-narration tests under parallel runs). Raise the budget so
// timing-sensitive component tests synchronize on the DOM with a margin that
// matches real contention instead of dying at the default. Absence assertions
// still fail correctly — they just retry longer.
configure({ asyncUtilTimeout: 5000 });

// With `globals: false`, testing-library can't auto-register its cleanup hook,
// so renders would leak across tests. Register it explicitly.
afterEach(() => {
  cleanup();
});
