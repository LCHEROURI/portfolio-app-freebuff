# freebuff-car-app — 12 Prompt Progressive Build Sequence

Do not start the next prompt until the current one is verified, committed, and passes build + tests.

## Prompt 1 — Foundations & Design System

**Scope:** Tailwind config, design tokens, global styles, layout, homepage shell.

**Deliverables:**
- `tailwind.config.ts` with navy/blue/white palette + restrained green action color
- `src/styles/globals.css` with Tailwind directives and CSS token mapping
- `src/app/layout.tsx` with metadata + global styles import
- `src/app/page.tsx` with header (headshot placeholder), disclosure banner, 3-step explanation, start button
- `src/app/advisor/` scaffold with layout
- `jest.config.js`, `src/setupTests.ts`

**Verification:**
- `npx next build` — green
- `npx jest` — all tests pass

---

## Prompt 2 — Brand Header & Homepage Assembly

**Scope:** Polish homepage — headshot placeholder, disclosure prominence, three-step explanation, start action routing.

**Deliverables:**
- Refined header with Larry initials headshot placeholder
- Disclosure banner styled and prominent
- Three-step explanation cards
- "Start Your Deal Analysis" button routes to `/advisor`

**Verification:**
- `npx next build` — green
- Manual: open `localhost:3000`, click Start, lands on advisor page

---

## Prompt 3 — Customer Intake & Priority Wizard

**Scope:** Intake form — monthly budget, down payment, credit range, Discover questions, priority ranking sliders.

**Deliverables:**
- `src/components/advisor/IntakeForm.tsx`
- `src/components/advisor/PriorityRanker.tsx`
- `src/hooks/useAdvisorState.ts`
- Validation: prevents impossible/empty required values

**Tests:**
- Intake state saves in the expected structure
- Validation rejects impossible values

---

## Prompt 4 — Vehicle Selection & Needs Analysis

**Scope:** Compare 2-3 vehicles against non-negotiable needs.

**Deliverables:**
- `src/components/advisor/VehicleNeeds.tsx`
- `public/vehicles-mock-data.json` with sample vehicles
- Non-negotiable needs checklist (AWD, seating, etc.)
- Responsive comparison layout

**Tests:**
- Vehicle data loads from mock file
- Needs checklist filters vehicles correctly

---

## Prompt 5 — Detailed Financial & Loan Calculator

**Scope:** Vehicle price, APR, term, down payment, monthly payment and interest logic.

**Deliverables:**
- `src/components/advisor/FinanceCalc.tsx`
- Uses `src/utils/financeCalculators.ts` — no math in component
- Graceful 0% APR handling
- Validation: down payment cannot exceed vehicle price

**Tests:**
- Monthly loan payment including 0% APR (existing tests cover this)
- Down payment > vehicle price rejected
- Total interest and total cost computed correctly

---

## Prompt 6 — Buy vs. Lease vs. Used Comparison

**Scope:** Side-by-side trade-off and long-term cost matrix.

**Deliverables:**
- `src/components/advisor/LeaseMatrix.tsx`
- Comparison of buying new, leasing, buying used
- Long-term cost display

**Tests:**
- Comparison renders all three options
- Cost calculations match utility functions

---

## Prompt 7 — Trade-In Analysis

**Scope:** Valuation, payoff, positive/negative equity.

**Deliverables:**
- `src/components/advisor/TradeEvaluator.tsx`
- Trade value and payoff inputs
- Net equity display with positive/negative distinction
- Upside-down/rollover warning state

**Tests:**
- Positive equity, zero equity, negative equity
- Upside-down detection

---

## Prompt 8 — Dealer Quote & Out-the-Door Fee Auditor

**Scope:** Itemized fees, add-ons, markups, red-flag warnings.

**Deliverables:**
- `src/components/advisor/FeeAuditor.tsx`
- Itemized dealer quote inputs
- Flags excessive doc fees (> $150 threshold)
- Flags unnecessary/high-margin add-ons (paint/fabric protection, nitrogen tires, glass etching)

**Tests:**
- Doc fee above $150 flagged
- Add-ons flagged (existing tests cover this)
- Clean quote returns no flags

---

## Prompt 9 — Deal Score Engine

**Scope:** Weighted 0-100 score and explanation.

**Deliverables:**
- `src/components/advisor/DealScoreCard.tsx`
- Uses `src/utils/dealScoreEngine.ts`
- Visible breakdown of weighted components
- Plain-language explanation of points earned/lost

**Tests:**
- Deal Score totals exactly 0-100
- Follows the weight table (Financing 25, Add-ons 20, Doc fee 20, Priority 20, Equity 15)
- Existing tests cover this

---

## Prompt 10 — D.R.I.V.E. Negotiation Script Builder

**Scope:** Tailored negotiation scripts and objection handling.

**Deliverables:**
- `src/components/advisor/DriveScript.tsx`
- Negotiation strategy tied to priorities gathered earlier
- Dialogue trees: "If the salesperson says X, you say Y"
- Friendly, practical coaching voice
- No invented financial numbers — references calculated facts in state

**Tests:**
- Script references actual deal data
- Dialogue tree renders for common objections

---

## Prompt 11 — Car Purchase Intelligence Report

**Scope:** Printable PDF-friendly final advisory report.

**Deliverables:**
- `src/components/advisor/IntelligenceReport.tsx`
- Complete summary: priorities, vehicles, financing, trade equity, fees, score, negotiation strategy
- Mandatory consent checkbox before saving/generating report
- Print-friendly `@media print` rules
- Browser print preview hides web navigation, produces clean paper layout
- localStorage persistence

**Tests:**
- Consent gate blocks report generation until checked
- Print CSS does not show app navigation
- localStorage restores session

---

## Prompt 12 — State Integration, Routing & Final Polish

**Scope:** Connect steps, localStorage, consent, routing, final verification.

**Deliverables:**
- `src/hooks/useAdvisorState.ts` with localStorage persistence
- Route flow: home → intake → vehicles → finance → trade → fee auditor → deal score → D.R.I.V.E. → report
- Final responsive and accessibility checks

**Tests:**
- localStorage restores the session
- Full flow navigation works
- All previous tests still pass

---

## Progress rule

Finish one prompt, verify it locally, commit it, and only then move to the next prompt. If Prompt 4 is broken, do not start Prompt 5.
