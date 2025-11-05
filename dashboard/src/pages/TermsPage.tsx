export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-10">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.4em] text-cyan-300">End User Agreement</p>
          <h1 className="text-3xl font-semibold text-white">Heyloo Voice Labs</h1>
          <p className="text-sm text-slate-300">
            Plain-language terms for brands integrating Heyloo with their POS stack.
          </p>
        </header>

        <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">1. Relationship</h2>
          <p className="text-sm text-slate-200">
            You grant Heyloo permission to act as an AI assistant for inbound restaurant calls,
            collect orders, send SMS confirmations, and sync with your connected POS. You maintain
            full ownership of your menus, customer relationships, and branding.
          </p>
        </section>

        <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">2. Acceptable use</h2>
          <ul className="space-y-2 text-sm text-slate-200">
            <li>No unlawful, discriminatory, or deceptive content during AI interactions.</li>
            <li>
              You will provide accurate menu data and notify Heyloo if allergens or restricted items
              change.
            </li>
            <li>
              Access tokens for Toast, Clover, and Square must be rotated if staff suspect a breach.
            </li>
          </ul>
        </section>

        <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">3. Fees & cancellation</h2>
          <p className="text-sm text-slate-200">
            Subscriptions are billed monthly via Stripe. You may cancel with 7 days’ notice; access
            to dashboards and transcripts remains available for 30 days for export.
          </p>
        </section>

        <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">4. Liability</h2>
          <p className="text-sm text-slate-200">
            Heyloo is provided “as is.” Our total liability is limited to the fees paid in the prior
            three months. We maintain $5M cyber liability coverage and follow SOC 2-aligned controls
            that satisfy Toast, Clover, and Square partner audits.
          </p>
        </section>

        <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <h2 className="text-xl font-semibold text-white">5. Contact</h2>
          <p className="text-sm text-slate-200">
            Questions?{' '}
            <a href="mailto:legal@heyloo.ai" className="text-cyan-300 underline">
              legal@heyloo.ai
            </a>{' '}
            · +1 (415) 555-1024
          </p>
        </section>
      </div>
    </div>
  );
}
