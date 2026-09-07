import { Mail, MessageCircle, PhoneCall, BookOpen, Calendar } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-slate-950 px-6 py-16 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-12">
        <header className="space-y-3 text-center">
          <p className="text-sm uppercase tracking-[0.4em] text-cyan-300">Support Hub</p>
          <h1 className="text-3xl font-semibold text-white">We keep hospitality human</h1>
          <p className="text-sm text-slate-300">
            Reach the Heyloo concierge team 24/7 for live menu help, compliance documentation, or
            incident response.
          </p>
        </header>

        <section className="grid gap-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur md:grid-cols-3">
          <div className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-6">
            <PhoneCall className="h-6 w-6 text-cyan-300" />
            <h2 className="text-lg font-semibold text-white">Urgent line</h2>
            <p className="text-sm text-slate-300">Instant escalation for outages or VIP guest issues.</p>
            <a href="tel:+14155551024" className="text-cyan-300 underline">
              +1 (415) 555-1024
            </a>
          </div>
          <div className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-6">
            <Mail className="h-6 w-6 text-cyan-300" />
            <h2 className="text-lg font-semibold text-white">Hospitality desk</h2>
            <p className="text-sm text-slate-300">Menu sync tweaks, branding requests, call reviews.</p>
            <a href="mailto:support@heyloo.ai" className="text-cyan-300 underline">
              support@heyloo.ai
            </a>
          </div>
          <div className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-6">
            <Calendar className="h-6 w-6 text-cyan-300" />
            <h2 className="text-lg font-semibold text-white">Schedule a strategy session</h2>
            <p className="text-sm text-slate-300">
              Quarterly business reviews with AI dining architects.
            </p>
            <Link to="/onboarding" className="text-cyan-300 underline">
              Book a call
            </Link>
          </div>
        </section>

        <section className="grid gap-8 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur lg:grid-cols-[1.5fr,1fr]">
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-white">Guides & policies</h2>
            <ul className="space-y-3 text-sm text-slate-300">
              <li>
                <a href="/privacy" className="text-cyan-300 underline">
                  Privacy policy
                </a>{' '}
                · SOC 2-aligned privacy controls & data retention windows.
              </li>
              <li>
                <a href="/terms" className="text-cyan-300 underline">
                  End user agreement
                </a>{' '}
                · Clear responsibilities for POS marketplace approval.
              </li>
              <li>
                <Link to="/onboarding" className="text-cyan-300 underline">
                  Implementation playbook
                </Link>{' '}
                · Step-by-step launch tasks for Toast, Square, and Clover.
              </li>
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/40 p-6 text-sm text-slate-300">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
              <BookOpen className="h-5 w-5 text-cyan-300" />
              Knowledge library
            </h3>
            <p>
              Access pattern playbooks for peak dining nights, SMS templates, and AI prompt updates
              in our partner portal. Request an invite at{' '}
              <a href="mailto:partner@heyloo.ai" className="text-cyan-300 underline">
                partner@heyloo.ai
              </a>
              .
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-600/30 via-blue-600/20 to-purple-600/30 p-8 text-center backdrop-blur">
          <div className="mx-auto max-w-2xl space-y-4">
            <MessageCircle className="mx-auto h-8 w-8 text-white" />
            <h2 className="text-2xl font-semibold text-white">Need white-glove onboarding?</h2>
            <p className="text-sm text-slate-200">
              Our architects will audit your IVR flows, train staff on AI escalations, and ship a
              Clover/Toast compliance packet tailored to your locations.
            </p>
            <Link
              to="/onboarding"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-semibold text-slate-900 shadow-lg"
            >
              Request concierge deployment
              <ArrowRightIcon />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M13.172 12 8.222 7.05 9.636 5.636l6.364 6.364-6.364 6.364-1.414-1.414z" />
    </svg>
  );
}
