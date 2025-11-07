import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center gap-4 mb-4">
            <Link to="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors">
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Link>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">End User License Agreement</h1>
            <p className="text-slate-600">Heyloo Technologies · ms@eduflixai.com</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="space-y-8">
          <div className="text-sm text-slate-500 mb-8">
            Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">1. Agreement to Terms</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                By accessing or using Heyloo's AI voice assistant services for restaurants, you agree to be bound by this End User License Agreement ("EULA"). 
                If you do not agree to these terms, do not use our services.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">2. License Grant</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                Subject to your compliance with this EULA, Heyloo grants you a limited, non-exclusive, non-transferable license to:
              </p>
              <ul className="text-slate-700 space-y-2 ml-6">
                <li>Use our AI voice assistant service to handle customer calls and process orders</li>
                <li>Integrate our service with your POS system (Square, Toast, Clover, or other supported systems)</li>
                <li>Access and use our dashboard and analytics features</li>
              </ul>
              <p className="text-slate-700 leading-relaxed mt-4">
                You maintain full ownership of your menu data, customer information, and business operations. 
                This license is revocable and terminates automatically if you violate any terms of this agreement.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">3. Acceptable Use</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                You agree to use our services only for lawful purposes and in accordance with this EULA:
              </p>
              <ul className="text-slate-700 space-y-2 ml-6">
                <li>You will not use the service for any unlawful, discriminatory, or deceptive purposes</li>
                <li>You will provide accurate menu data and notify us of any changes to allergens, restricted items, or menu availability</li>
                <li>You will maintain the security of your POS integration credentials and rotate access tokens if you suspect a security breach</li>
                <li>You will not attempt to reverse engineer, modify, or interfere with our service</li>
                <li>You will not use the service in a way that could damage, disable, or impair our systems</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">4. Fees and Payment</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                Our services are provided on a subscription basis. Fees are billed monthly in advance through our payment processor (Stripe). 
                You may cancel your subscription at any time with 7 days' written notice. Upon cancellation, your access to dashboards and 
                historical data will remain available for 30 days for data export purposes.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">5. Service Availability and Modifications</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                We strive to maintain high service availability but do not guarantee uninterrupted service. We may modify, suspend, or 
                discontinue features of our service at any time with reasonable notice. We are not liable for any downtime or service 
                interruptions.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">6. Intellectual Property</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                All rights, title, and interest in and to the Heyloo service, including all intellectual property rights, remain the 
                exclusive property of Heyloo Technologies. This EULA does not grant you any rights to use our trademarks, logos, or 
                other brand features.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">7. Limitation of Liability</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, HEYLOO PROVIDES THE SERVICE "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, 
                EXPRESS OR IMPLIED. Our total liability for any claims arising from or related to this EULA or the service shall not exceed 
                the fees you paid to us in the three (3) months preceding the claim.
              </p>
              <p className="text-slate-700 leading-relaxed mt-4">
                We are not liable for any indirect, incidental, special, or consequential damages, including lost profits or revenue, 
                even if we have been advised of the possibility of such damages.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">8. Indemnification</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                You agree to indemnify and hold harmless Heyloo from any claims, damages, losses, or expenses (including legal fees) 
                arising from your use of the service, violation of this EULA, or infringement of any third-party rights.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">9. Termination</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                Either party may terminate this agreement at any time with 7 days' written notice. We may terminate or suspend your 
                access immediately if you breach this EULA. Upon termination, your right to use the service ceases immediately, and we 
                may delete your account data after the 30-day export period.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">10. Governing Law</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                This EULA is governed by the laws of the State of California, United States, without regard to conflict of law principles. 
                Any disputes shall be resolved in the state or federal courts located in California.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">11. Changes to This Agreement</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                We may update this EULA from time to time. We will notify you of material changes by email or through our service. 
                Your continued use of the service after such changes constitutes acceptance of the updated terms.
              </p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">12. Contact Information</h2>
            <div className="prose prose-slate max-w-none">
              <p className="text-slate-700 leading-relaxed">
                If you have questions about this EULA, please contact us:
              </p>
              <div className="bg-slate-50 p-4 rounded-lg mt-4">
                <p className="text-slate-700 font-medium">Heyloo Technologies</p>
                <p className="text-slate-600">Email: legal@heyloo.com</p>
                <p className="text-slate-600">Support: support@heyloo.com</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
