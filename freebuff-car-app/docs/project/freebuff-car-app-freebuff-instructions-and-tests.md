# freebuff-car-app — Freebuff Instructions and Test Blueprint

## System behavior

Freebuff works in small phases, tests changes, and opens or prepares a pull request before merge.

### Every prompt cycle

1. Confirm repo: freebuff-car-app (inside portfolio-app-freebuff)
2. Confirm branch: use or create `freebuff/pXX-...`
3. Paste one prompt only
4. Inspect before editing — read relevant files, tests, current implementation
5. Plan briefly — state which files to change and which tests to add/update
6. Implement — edit the repo, not disconnected snippets
7. Run tests — relevant unit/component tests
8. Run build — `npm run build` at minimum; run lint/typecheck if configured
9. Open local preview — check `localhost:3000` and click through the feature
10. Fix errors before proceeding — copy browser/terminal errors back into Freebuff and require a verified fix
11. Update log — write the result into `docs/project/IMPLEMENTATION_LOG.md`
12. Commit and PR checkpoint — save the completed phase. Do not merge unless explicitly approved

### Never use this instruction

Avoid "keep going and implement every suggestion" as a blanket project command. For this app, every suggestion must stay inside the current prompt scope and pass the same tests and governance rules.

## Test blueprint

### Financial math (authoritative)

The math utilities in `src/utils/` are the source of truth. Tests for them must pass before any UI that wraps them is considered done.

- Monthly loan payment, including 0% APR
- Down payment greater than vehicle price should be rejected
- Positive and negative trade equity
- Deal Score totals exactly 0-100 and follows the weight table
- Doc fee / add-on red flags
- Intake state saves in the expected structure
- localStorage restores the session
- Consent gate blocks report generation until checked
- Print CSS does not show app navigation in the report

### Component tests

- Each advisor component renders with realistic mock data
- Validation prevents impossible values from silently passing
- Responsive layout stacks vertically on small screens
- Real-time state updates as sliders move (PriorityRanker)

### Integration

- Full advisor flow navigation works
- localStorage persistence survives refresh
- Report generation blocked without consent

## Mock data coverage

Mock data in `public/vehicles-mock-data.json` should cover:
- Sample vehicles with MSRP/invoice-style price fields and realistic financing/lease inputs
- Trade-ins with positive equity, zero loan balance, and negative equity
- Dealer quotes with document fees, title/registration, and add-ons
- End-to-end scenarios with both high and poor Deal Scores
