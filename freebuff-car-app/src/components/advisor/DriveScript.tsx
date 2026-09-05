'use client';

interface Objection {
  if: string;
  say: string;
}

/**
 * D.R.I.V.E. negotiation script.
 *
 * Dialogue trees keyed to the most common dealer tactics. Scripts reference
 * facts the user calculated in earlier steps — no invented numbers.
 */
const OBJECTIONS: Objection[] = [
  {
    if: '"This price is only good today."',
    say: 'A deal that expires today is not a deal — it is pressure. I will buy when the numbers work, and the numbers do not change because the calendar does.',
  },
  {
    if: '"You will never get this payment anywhere else."',
    say: 'The payment is not the price. Let\'s talk total cost, out-the-door, in writing — then I can compare it line by line.',
  },
  {
    if: '"Let me run your credit first."',
    say: 'Not yet. First we agree on the out-the-door price. Financing is a separate conversation, and I already know my budget.',
  },
  {
    if: '"The doc fee is mandatory, everyone pays it."',
    say: 'Mandatory for you is not mandatory for the deal. If it exceeds the state norm, I will take my business to a dealer that prices honestly.',
  },
  {
    if: '"You need the protection package."',
    say: 'I do not need paint protection, nitrogen tires, or glass etching. Those are high-margin add-ons, not requirements. Remove them from the worksheet.',
  },
  {
    if: '"Your trade-in is only worth X."',
    say: 'Then I am happy to sell it privately — I know its market value. If you want it in the deal, the price has to reflect it.',
  },
];

interface Props {
  onComplete?: () => void;
}

export default function DriveScript({ onComplete }: Props = {}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-navy-900">D.R.I.V.E. — Your Negotiation Script</h2>
        <p className="mt-1 text-ink-600">
          Dealers are trained with scripts. Here is yours. When you hear the line on the left, respond
          with the line on the right — calmly, and without apologizing.
        </p>
      </div>

      <div className="space-y-3">
        {OBJECTIONS.map((o) => (
          <div key={o.if} className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-navy-900">If the salesperson says {o.if}</p>
            <p className="mt-2 rounded-lg bg-good-50 px-3 py-2 text-sm text-ink-800">
              <span className="font-semibold text-good-700">You say: </span>
              {o.say}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h3 className="font-semibold text-navy-900">Ground rules</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-700">
          <li>Negotiate the out-the-door price first — payments last.</li>
          <li>Get every number in writing before you discuss financing.</li>
          <li>Walking away is your strongest move, and it costs nothing.</li>
        </ul>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onComplete?.()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          Continue to deal score
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
