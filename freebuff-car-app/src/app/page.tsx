import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-ink-50">
      {/* Header */}
      <header className="sticky top-0 z-30 w-full border-b border-ink-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            {/* Headshot placeholder — Larry's initials on a navy circle */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-900 text-white font-semibold text-sm shadow-sm ring-2 ring-white">
              LS
            </div>
            <div>
              <p className="text-sm font-semibold text-navy-900">Buy Smart with Larry</p>
              <p className="text-xs text-ink-500">Independent car purchase advisor · v1.1</p>
            </div>
          </div>
          <nav className="flex items-center gap-4 text-sm font-medium text-ink-600">
            <Link
              href="/advisor"
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-blue-700 hover:bg-blue-50 hover:text-blue-800 transition-colors"
            >
              Start Your Deal Analysis
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-4xl px-4 pt-12 sm:px-6 sm:pt-20 pb-24 sm:pb-32 lg:px-8">
        <section className="mb-12 rounded-2xl border border-ink-200 bg-white/80 p-6 sm:p-10 shadow-sm">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
            {/* Headshot placeholder block */}
            <div className="flex shrink-0 items-center justify-center self-start rounded-full bg-navy-900 px-5 py-3 text-white font-semibold text-lg shadow-lg ring-2 ring-white/20">
              Larry
            </div>
            <div>
              <h1 className="text-3xl font-bold leading-tight text-navy-900 sm:text-4xl">
                Buy your next car with confidence.
              </h1>
              <p className="mt-4 text-lg leading-relaxed text-ink-600">
                I am an independent advisor — not a dealership, not a lender, not a lease broker.
                I help you compare vehicles, run the real financing and lease math, audit dealer quotes
                for hidden fees, and walk into the negotiation with a plan.
              </p>
              {/* Primary action */}
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/advisor"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                >
                  Start Your Deal Analysis
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                <span className="text-xs text-ink-500">Takes about 5 minutes</span>
              </div>
            </div>
          </div>
        </section>

        {/* Disclosure — prominent but not overwhelming */}
        <section className="mb-10 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <div className="flex gap-3">
            <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-amber-900">Important disclosure</p>
              <p className="mt-1 text-sm text-amber-800 leading-relaxed">
                Buy Smart with Larry is an educational and decision-support tool. It does not arrange financing,
                lease, or insurance, and it is not affiliated with any manufacturer, dealership, lender,
                or lease company. The numbers shown are estimates based on the inputs you provide; always
                confirm final terms in writing with the seller before signing.
              </p>
            </div>
          </div>
        </section>

        {/* Three-step explanation */}
        <section className="mb-12">
          <h2 className="mb-6 text-center text-xl font-semibold text-navy-900">How the advisor works</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                1
              </div>
              <h3 className="font-semibold text-navy-900">Tell me your priorities</h3>
              <p className="mt-2 text-sm text-ink-600 leading-relaxed">
                Share your budget, down payment, credit range, and what matters most — monthly payment,
                total cost, fuel economy, safety, technology, or something else.
              </p>
            </div>
            <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                2
              </div>
              <h3 className="font-semibold text-navy-900">Compare your options</h3>
              <p className="mt-2 text-sm text-ink-600 leading-relaxed">
                We test new, lease, and used scenarios side by side, run the financing math, and flag
                dealer fees that are higher than they should be.
              </p>
            </div>
            <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                3
              </div>
              <h3 className="font-semibold text-navy-900">Get your negotiation plan</h3>
              <p className="mt-2 text-sm text-ink-600 leading-relaxed">
                You end with a Deal Score, a plain-language explanation, and a D.R.I.V.E. script tailored
                to what matters most to you.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
